import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

export interface DatabaseRunConfig {
  mode: string;
  rowCount: number;
  payloadBytes: number;
}

export interface DatabaseRunResult {
  mode: string;
  rowCount: number;
  rowsReturned: number;
  serializedBytes: number;
  phases: Record<string, number>;
  totalMs: number;
}

export class SQLiteBenchmarkAdapter {
  private readonly db: DatabaseSync;
  private readonly filename: string;

  public constructor(filename: string) {
    this.filename = filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS bench_rows (
        id INTEGER PRIMARY KEY,
        bucket INTEGER NOT NULL,
        score INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bench_bucket ON bench_rows (bucket);
      CREATE INDEX IF NOT EXISTS idx_bench_score ON bench_rows (score);
    `);
  }

  public seed(targetRowCount: number, payloadBytes: number): number {
    const current = this.db.prepare("SELECT COUNT(*) AS count FROM bench_rows").get() as { count: number };
    if (current.count >= targetRowCount) {
      return current.count;
    }

    const insert = this.db.prepare(`
      INSERT INTO bench_rows (bucket, score, payload, created_at)
      VALUES (?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      for (let index = current.count; index < targetRowCount; index += 1) {
        const payload = buildPayload(payloadBytes, index);
        insert.run(index % 100, (index * 37) % 1000, payload, new Date(1_700_000_000_000 + index * 1000).toISOString());
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return targetRowCount;
  }

  public run(config: DatabaseRunConfig): DatabaseRunResult {
    this.seed(config.rowCount, config.payloadBytes);

    const phases: Record<string, number> = {};
    const overallStart = performance.now();
    let rowsReturned = 0;
    let serializedBytes = 0;

    const prepStart = performance.now();
    const statement = this.prepareStatement(config.mode, config.payloadBytes);
    phases.prepareMs = performance.now() - prepStart;

    const executeStart = performance.now();
    const result = statement();
    phases.executeMs = performance.now() - executeStart;

    const materializeStart = performance.now();
    const materialized = Array.isArray(result) ? result : [result];
    rowsReturned = materialized.length;
    phases.materializeMs = performance.now() - materializeStart;

    const serializeStart = performance.now();
    serializedBytes = Buffer.byteLength(JSON.stringify(materialized));
    phases.serializeMs = performance.now() - serializeStart;
    phases.totalMs = performance.now() - overallStart;

    return {
      mode: config.mode,
      rowCount: config.rowCount,
      rowsReturned,
      serializedBytes,
      phases,
      totalMs: phases.totalMs,
    };
  }

  private prepareStatement(mode: string, payloadBytes: number): () => unknown[] | unknown {
    switch (mode) {
      case "lookup": {
        const statement = this.db.prepare(`
          SELECT id, bucket, score, payload, created_at
          FROM bench_rows
          WHERE id = (SELECT MAX(id) FROM bench_rows) - 1
        `);
        return () => statement.get();
      }
      case "range": {
        const statement = this.db.prepare(`
          SELECT id, bucket, score, payload
          FROM bench_rows
          WHERE bucket BETWEEN 10 AND 30
          ORDER BY score DESC, id DESC
          LIMIT 120
        `);
        return () => statement.all();
      }
      case "aggregate": {
        const statement = this.db.prepare(`
          SELECT bucket, COUNT(*) AS count, AVG(score) AS avgScore, MAX(score) AS maxScore
          FROM bench_rows
          GROUP BY bucket
          ORDER BY avgScore DESC
          LIMIT 12
        `);
        return () => statement.all();
      }
      case "write-read": {
        return () => {
          const insert = this.db.prepare(`
            INSERT INTO bench_rows (bucket, score, payload, created_at)
            VALUES (?, ?, ?, ?)
          `);
          const read = this.db.prepare(`
            SELECT id, bucket, score, payload
            FROM bench_rows
            WHERE id = ?
          `);
          this.db.exec("BEGIN");
          try {
            const payload = buildPayload(payloadBytes, Date.now() % 1000);
            const inserted = insert.run(77, 777, payload, new Date().toISOString()) as { lastInsertRowid: number | bigint };
            const id = Number(inserted.lastInsertRowid);
            const fetched = read.get(id);
            this.db.prepare("DELETE FROM bench_rows WHERE id = ?").run(id);
            this.db.exec("COMMIT");
            return fetched;
          } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
          }
        };
      }
      default:
        throw new Error(`Unsupported DB mode: ${mode}`);
    }
  }
}

function buildPayload(bytes: number, seed: number): string {
  const base = `row-${seed.toString(16).padStart(4, "0")}-`;
  if (base.length >= bytes) {
    return base.slice(0, bytes);
  }
  return (base + "abcdefghijklmnopqrstuvwxyz0123456789".repeat(Math.ceil((bytes - base.length) / 36))).slice(0, bytes);
}
