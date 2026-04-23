import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";

import express, { type NextFunction, type Request, type Response } from "express";

import {
  type BenchmarkId,
  getRuntimeConfig,
  resolveScenarioContext,
} from "./config.ts";
import { SQLiteBenchmarkAdapter } from "./database.ts";
import { renderBenchmarkPage, renderDashboard } from "./pages.ts";

const runtime = getRuntimeConfig();
const app = express();
const db = new SQLiteBenchmarkAdapter(runtime.dbPath);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

await fs.mkdir(runtime.tempDir, { recursive: true });
db.seed(1000, 128);

app.disable("x-powered-by");

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
    const entry = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      elapsedMs,
      contentLength: res.getHeader("content-length") ?? null,
    };
    console.log(JSON.stringify(entry));
  });

  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith("/bench") ||
    req.path.startsWith("/api/bench") ||
    req.path === "/" ||
    req.path === "/app.js" ||
    req.path === "/style.css"
  ) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
  }),
);

app.get("/", (_req: Request, res: Response) => {
  res.type("html").send(renderDashboard(runtime));
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/system/info", (_req: Request, res: Response) => {
  res.json({
    hostname: process.env.HOSTNAME ?? "unknown",
    nodeVersion: process.version,
    pid: process.pid,
    uptimeSeconds: process.uptime(),
    cwd: process.cwd(),
    runtime,
  });
});

app.get("/api/bench/config/:scenario", (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawScenario = Array.isArray(req.params.scenario) ? req.params.scenario[0] ?? "" : req.params.scenario ?? "";
    const scenario = parseScenario(rawScenario);
    const context = resolveScenarioContext(scenario, req.query as Record<string, unknown>, runtime);
    res.json({
      scenario,
      timestamp: new Date().toISOString(),
      effectiveConfig: context.values,
      fields: context.fields,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/bench/ping", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("ping", req, res, next);
});
app.get("/bench/page/basic", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("page-basic", req, res, next);
});
app.get("/bench/page/heavy", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("page-heavy", req, res, next);
});
app.get("/bench/file", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("file", req, res, next);
});
app.get("/bench/db", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("db", req, res, next);
});
app.get("/bench/js", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("js", req, res, next);
});
app.get("/bench/io", (req: Request, res: Response, next: NextFunction) => {
  renderScenarioPage("io", req, res, next);
});

app.get("/api/bench/ping", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = resolveScenarioContext("ping", req.query as Record<string, unknown>, runtime);
    const payloadBytes = Number(context.values.payloadBytes);
    const serverDelayMs = Number(context.values.serverDelayMs);
    const start = performance.now();
    if (serverDelayMs > 0) {
      await sleep(serverDelayMs);
    }
    const responsePayload = buildBuffer(payloadBytes).toString("hex").slice(0, payloadBytes);
    const totalMs = Number((performance.now() - start).toFixed(2));
    res.json(
      envelope("ping", context.values, {
        echoBytes: responsePayload.length,
        echoedAt: Date.now(),
        payloadPreview: responsePayload.slice(0, 32),
      }, { totalMs }, res),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/bench/file", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = resolveScenarioContext("file", req.query as Record<string, unknown>, runtime);
    const mode = String(context.values.mode);
    const transferBytes = Number(context.values.transferBytes);
    const chunkBytes = Number(context.values.chunkBytes);
    const startedAt = performance.now();

    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("x-transfer-mode", mode);
    res.setHeader("x-transfer-bytes", String(transferBytes));

    if (mode === "download-stream") {
      res.setHeader("x-server-ms", "streamed");
      for (let written = 0; written < transferBytes; written += chunkBytes) {
        const chunk = buildBuffer(Math.min(chunkBytes, transferBytes - written));
        res.write(chunk);
        await sleep(0);
      }
      res.end();
      return;
    }

    const body = buildBuffer(transferBytes);
    res.setHeader("content-length", String(body.byteLength));
    res.setHeader("x-server-ms", String((performance.now() - startedAt).toFixed(2)));
    res.end(body);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/bench/file/raw",
  express.raw({ type: "*/*", limit: runtime.maxTransferBytes }),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = resolveScenarioContext("file", req.query as Record<string, unknown>, runtime);
      const startedAt = performance.now();
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      res.json(
        envelope("file", context.values, {
          uploadMode: "raw",
          receivedBytes: body.byteLength,
          checksum: checksum(body),
        }, { totalMs: Number((performance.now() - startedAt).toFixed(2)) }, res),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/bench/file/form", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = resolveScenarioContext("file", req.query as Record<string, unknown>, runtime);
    const startedAt = performance.now();
    const formData = await readFormData(req);
    const payload = formData.get("payload");
    const file =
      payload instanceof File
        ? Buffer.from(await payload.arrayBuffer())
        : Buffer.from(String(payload ?? ""));
    res.json(
      envelope("file", context.values, {
        uploadMode: "form",
        receivedBytes: file.byteLength,
        checksum: checksum(file),
      }, { totalMs: Number((performance.now() - startedAt).toFixed(2)) }, res),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/bench/db", (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = resolveScenarioContext("db", req.query as Record<string, unknown>, runtime);
    const result = db.run({
      mode: String(context.values.mode),
      rowCount: Number(context.values.rowCount),
      payloadBytes: Number(context.values.payloadBytes),
    });
    res.json(
      envelope("db", context.values, {
        mode: result.mode,
        rowCount: result.rowCount,
        rowsReturned: result.rowsReturned,
        serializedBytes: result.serializedBytes,
        phases: result.phases,
      }, { totalMs: Number(result.totalMs.toFixed(2)) }, res),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/bench/io", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = resolveScenarioContext("io", req.query as Record<string, unknown>, runtime);
    const result = await runIoBenchmark(
      String(context.values.mode),
      Number(context.values.fileBytes),
      runtime.tempDir,
    );
    res.json(envelope("io", context.values, result, { totalMs: result.totalMs }, res));
  } catch (error) {
    next(error);
  }
});

app.get("/api/bench/js/module.mjs", (req: Request, res: Response) => {
  const sizeBytes = boundedNumber(req.query.sizeBytes, 24 * 1024, 4096, runtime.maxJsBytes);
  const workUnits = boundedNumber(req.query.workUnits, 800, 1, 10000);
  res.type("application/javascript").send(buildModuleSource(sizeBytes, workUnits));
});

app.get("/api/bench/js/data.json", (req: Request, res: Response) => {
  const sizeBytes = boundedNumber(req.query.sizeBytes, 256 * 1024, 4096, runtime.maxJsonBytes);
  res.json(buildJsonPayload(sizeBytes));
});

app.get("/api/bench/assets/page-style.css", (req: Request, res: Response) => {
  const sizeBytes = boundedNumber(req.query.sizeBytes, 12 * 1024, 1024, runtime.maxHtmlBytes);
  const accent = typeof req.query.accent === "string" ? req.query.accent : "basic";
  res.type("text/css").send(buildPageStyle(sizeBytes, accent));
});

app.get("/api/bench/assets/page-script.js", (req: Request, res: Response) => {
  const sizeBytes = boundedNumber(req.query.sizeBytes, 20 * 1024, 1024, runtime.maxJsBytes);
  const workUnits = boundedNumber(req.query.workUnits, 400, 1, 10000);
  res.type("application/javascript").send(buildPageScript(sizeBytes, workUnits));
});

app.get("/api/bench/assets/image.svg", (req: Request, res: Response) => {
  const sizeBytes = boundedNumber(req.query.sizeBytes, 16 * 1024, 1024, runtime.maxTransferBytes);
  const label = typeof req.query.label === "string" ? req.query.label : "diag";
  const hue = boundedNumber(req.query.hue, 32, 10, 90);
  res.type("image/svg+xml").send(buildSvg(sizeBytes, label, hue));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({
    error: message,
    requestId: res.locals.requestId ?? null,
  });
});

app.listen(runtime.port, runtime.host, () => {
  console.log(`Diagnostic benchmark server listening on http://${runtime.host}:${runtime.port}`);
});

async function renderScenarioPage(
  scenario: BenchmarkId,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const context = resolveScenarioContext(scenario, req.query as Record<string, unknown>, runtime);
    if ("serverDelayMs" in context.values) {
      const delayMs = Number(context.values.serverDelayMs);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
    res.type("html").send(renderBenchmarkPage(context));
  } catch (error) {
    next(error);
  }
}

function parseScenario(value: string): BenchmarkId {
  const scenarios: BenchmarkId[] = ["ping", "page-basic", "page-heavy", "file", "db", "js", "io"];
  if (scenarios.includes(value as BenchmarkId)) {
    return value as BenchmarkId;
  }
  throw new Error(`Unknown scenario: ${value}`);
}

function envelope(
  scenario: string,
  effectiveConfig: Record<string, string | number>,
  data: unknown,
  serverTiming: Record<string, number>,
  res: Response,
) {
  return {
    scenario,
    timestamp: new Date().toISOString(),
    requestId: res.locals.requestId ?? null,
    effectiveConfig,
    serverTiming,
    data,
  };
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildBuffer(sizeBytes: number): Buffer {
  const chunk = Buffer.from("0123456789abcdef".repeat(1024));
  const parts: Buffer[] = [];
  let remaining = sizeBytes;
  while (remaining > 0) {
    const length = Math.min(remaining, chunk.byteLength);
    parts.push(chunk.subarray(0, length));
    remaining -= length;
  }
  return Buffer.concat(parts, sizeBytes);
}

function checksum(buffer: Buffer): string {
  return crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 16);
}

async function readFormData(req: Request): Promise<FormData> {
  const url = new URL(req.originalUrl, `${req.protocol}://${req.get("host")}`).toString();
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  const request = new Request(url, {
    method: req.method,
    headers,
    body: Readable.toWeb(req) as ReadableStream,
    duplex: "half",
  });
  return request.formData();
}

function buildModuleSource(sizeBytes: number, workUnits: number): string {
  const filler = "ZX".repeat(Math.max(1, Math.ceil((sizeBytes - 240) / 2)));
  return `
const payload = ${JSON.stringify(filler)};
const evaluationStart = performance.now();
let checksum = 0;
for (let index = 0; index < ${workUnits}; index += 1) {
  checksum = (checksum + payload.charCodeAt(index % payload.length) + index) % 1000003;
}
const evaluationMs = performance.now() - evaluationStart;
export default {
  metrics: {
    requestedBytes: ${sizeBytes},
    payloadBytes: payload.length,
    workUnits: ${workUnits},
    evaluationMs,
    checksum
  }
};
`.padEnd(sizeBytes, "/");
}

function buildJsonPayload(sizeBytes: number) {
  const payload = {
    meta: {
      requestedBytes: sizeBytes,
      generatedAt: new Date().toISOString(),
    },
    rows: [] as Array<{ id: number; label: string; score: number; payload: string }>,
  };

  let index = 0;
  while (Buffer.byteLength(JSON.stringify(payload)) < sizeBytes) {
    payload.rows.push({
      id: index,
      label: `row-${index.toString().padStart(4, "0")}`,
      score: (index * 31) % 1000,
      payload: `payload-${index}-` + "0123456789abcdef".repeat(8),
    });
    index += 1;
  }

  return payload;
}

function buildPageStyle(sizeBytes: number, accent: string): string {
  const base = `
:root {
  --accent-hue: ${accent === "heavy" ? 18 : 42};
}
.payload-surface {
  border-top: 1px solid color-mix(in srgb, var(--panel-border), transparent 35%);
}
.payload-card:nth-child(odd) {
  transform: translateY(6px);
}
.payload-card:nth-child(even) {
  transform: translateY(-4px);
}
.image-card img {
  filter: saturate(1.15) contrast(1.05);
}
`;
  return base.padEnd(sizeBytes, "/*bench-style*/");
}

function buildPageScript(sizeBytes: number, workUnits: number): string {
  const source = `
window.__pageLoadAssetMetrics = window.__pageLoadAssetMetrics || [];
(() => {
  const evaluationStart = performance.now();
  const payload = ${JSON.stringify("LM".repeat(Math.max(1, Math.ceil((sizeBytes - 280) / 2))))};
  let checksum = 0;
  for (let index = 0; index < ${workUnits}; index += 1) {
    checksum = (checksum + payload.charCodeAt(index % payload.length) + index) % 1000003;
  }
  window.__pageLoadAssetMetrics.push({
    payloadBytes: payload.length,
    workUnits: ${workUnits},
    evaluationMs: performance.now() - evaluationStart,
    checksum
  });
})();
`;
  return source.padEnd(sizeBytes, "/");
}

function buildSvg(sizeBytes: number, label: string, hue: number): string {
  const base = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
  <defs>
    <linearGradient id="g" x1="0%" x2="100%">
      <stop offset="0%" stop-color="hsl(${hue}, 86%, 60%)" />
      <stop offset="100%" stop-color="hsl(${hue + 22}, 72%, 45%)" />
    </linearGradient>
  </defs>
  <rect width="480" height="320" rx="24" fill="#181510" />
  <rect x="16" y="16" width="448" height="288" rx="18" fill="url(#g)" opacity="0.92" />
  <text x="32" y="58" fill="#fff8ea" font-size="22" font-family="Menlo, Consolas, monospace">${escapeSvg(label)}</text>
  <text x="32" y="92" fill="#fff8ea" font-size="14" font-family="Menlo, Consolas, monospace">Generated benchmark asset</text>
  <text x="32" y="124" fill="#fff8ea" font-size="14" font-family="Menlo, Consolas, monospace">${sizeBytes} bytes target</text>
</svg>
`;
  return base.padEnd(sizeBytes, " ");
}

function escapeSvg(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function runIoBenchmark(mode: string, fileBytes: number, tempDir: string) {
  const phases: Record<string, number> = {};
  const startedAt = performance.now();
  let bytesProcessed = 0;

  if (mode === "small-read" || mode === "large-read") {
    const fixture = path.join(tempDir, `fixture-${fileBytes}.bin`);
    const setupStart = performance.now();
    await ensureFixtureFile(fixture, fileBytes);
    phases.setupMs = Number((performance.now() - setupStart).toFixed(2));

    const readStart = performance.now();
    const buffer = await fs.readFile(fixture);
    bytesProcessed = buffer.byteLength;
    phases.readMs = Number((performance.now() - readStart).toFixed(2));
  } else if (mode === "write-read") {
    const fixture = path.join(tempDir, `run-${crypto.randomUUID()}.bin`);
    const payload = buildBuffer(fileBytes);

    const writeStart = performance.now();
    await fs.writeFile(fixture, payload);
    phases.writeMs = Number((performance.now() - writeStart).toFixed(2));

    const readStart = performance.now();
    const readBack = await fs.readFile(fixture);
    bytesProcessed = readBack.byteLength;
    phases.readMs = Number((performance.now() - readStart).toFixed(2));

    const cleanupStart = performance.now();
    await fs.rm(fixture, { force: true });
    phases.cleanupMs = Number((performance.now() - cleanupStart).toFixed(2));
  } else {
    throw new Error(`Unsupported I/O mode: ${mode}`);
  }

  const totalMs = Number((performance.now() - startedAt).toFixed(2));
  phases.totalMs = totalMs;
  return {
    mode,
    fileBytes,
    bytesProcessed,
    phases,
    totalMs,
  };
}

async function ensureFixtureFile(filename: string, sizeBytes: number) {
  try {
    const stat = await fs.stat(filename);
    if (stat.size === sizeBytes) {
      return;
    }
  } catch {
    // The file is created below when missing or mismatched.
  }

  await fs.writeFile(filename, buildBuffer(sizeBytes));
}
