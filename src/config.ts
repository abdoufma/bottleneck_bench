import path from "node:path";

export type BenchmarkId =
  | "ping"
  | "page-basic"
  | "page-heavy"
  | "file"
  | "db"
  | "js"
  | "io";

export type Preset = "small" | "medium" | "large" | "xlarge";

export type FieldType = "number" | "select";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  help: string;
  options?: SelectOption[];
}

export interface RuntimeConfig {
  host: string;
  port: number;
  maxIterations: number;
  maxTransferBytes: number;
  maxHtmlBytes: number;
  maxJsBytes: number;
  maxJsonBytes: number;
  maxDbRows: number;
  maxIoBytes: number;
  maxImageCount: number;
  maxServerDelayMs: number;
  dbPath: string;
  tempDir: string;
}

export interface ScenarioContext {
  id: BenchmarkId;
  title: string;
  subtitle: string;
  pagePath: string;
  endpoint?: string;
  mode: "request" | "navigation";
  primaryMetric: string;
  fields: FieldDefinition[];
  values: Record<string, number | string>;
  notes: string[];
}

type QueryInput = Record<string, unknown>;

const PRESET_OPTIONS: SelectOption[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "XLarge" },
];

const FILE_MODE_OPTIONS: SelectOption[] = [
  { value: "download-buffer", label: "Download / buffer" },
  { value: "download-stream", label: "Download / stream" },
  { value: "upload-raw", label: "Upload / raw binary" },
  { value: "upload-form", label: "Upload / multipart form" },
];

const DB_MODE_OPTIONS: SelectOption[] = [
  { value: "lookup", label: "Indexed lookup" },
  { value: "range", label: "Range scan" },
  { value: "aggregate", label: "Aggregate" },
  { value: "write-read", label: "Write + read" },
];

const IO_MODE_OPTIONS: SelectOption[] = [
  { value: "small-read", label: "Small read" },
  { value: "large-read", label: "Large read" },
  { value: "write-read", label: "Write + read" },
];

const PING_FIELDS = (runtime: RuntimeConfig): FieldDefinition[] => [
  {
    name: "preset",
    label: "Preset",
    type: "select",
    help: "Baseline latency profile.",
    options: PRESET_OPTIONS,
  },
  {
    name: "iterations",
    label: "Iterations",
    type: "number",
    min: 1,
    max: runtime.maxIterations,
    step: 1,
    help: "Number of client-side probes in a series.",
  },
  {
    name: "payloadBytes",
    label: "Payload bytes",
    type: "number",
    min: 16,
    max: runtime.maxTransferBytes,
    step: 16,
    help: "Size of the echo payload returned by the server.",
  },
  {
    name: "serverDelayMs",
    label: "Injected delay",
    type: "number",
    min: 0,
    max: runtime.maxServerDelayMs,
    step: 1,
    help: "Artificial delay added on the server before responding.",
  },
];

const PAGE_FIELDS = (runtime: RuntimeConfig): FieldDefinition[] => [
  {
    name: "preset",
    label: "Preset",
    type: "select",
    help: "Baseline navigation profile.",
    options: PRESET_OPTIONS,
  },
  {
    name: "htmlBytes",
    label: "HTML bytes",
    type: "number",
    min: 2048,
    max: runtime.maxHtmlBytes,
    step: 1024,
    help: "Approximate size of the server-rendered document body.",
  },
  {
    name: "styleBytes",
    label: "Stylesheet bytes",
    type: "number",
    min: 1024,
    max: runtime.maxHtmlBytes,
    step: 1024,
    help: "Size of the linked stylesheet payload.",
  },
  {
    name: "scriptBytes",
    label: "Script bytes",
    type: "number",
    min: 1024,
    max: runtime.maxJsBytes,
    step: 1024,
    help: "Size of the linked page-load script payload.",
  },
  {
    name: "imageCount",
    label: "Image count",
    type: "number",
    min: 0,
    max: runtime.maxImageCount,
    step: 1,
    help: "Number of generated SVG image assets to fetch.",
  },
  {
    name: "imageBytes",
    label: "Image bytes",
    type: "number",
    min: 1024,
    max: runtime.maxTransferBytes,
    step: 1024,
    help: "Approximate payload size of each generated image.",
  },
  {
    name: "serverDelayMs",
    label: "Injected delay",
    type: "number",
    min: 0,
    max: runtime.maxServerDelayMs,
    step: 1,
    help: "Artificial server-side delay before the HTML is sent.",
  },
];

const FILE_FIELDS = (runtime: RuntimeConfig): FieldDefinition[] => [
  {
    name: "preset",
    label: "Preset",
    type: "select",
    help: "Baseline transfer profile.",
    options: PRESET_OPTIONS,
  },
  {
    name: "mode",
    label: "Mode",
    type: "select",
    help: "Direction and transfer encoding.",
    options: FILE_MODE_OPTIONS,
  },
  {
    name: "iterations",
    label: "Iterations",
    type: "number",
    min: 1,
    max: runtime.maxIterations,
    step: 1,
    help: "Number of transfers in a series.",
  },
  {
    name: "transferBytes",
    label: "Transfer bytes",
    type: "number",
    min: 4096,
    max: runtime.maxTransferBytes,
    step: 4096,
    help: "Target upload or download payload size.",
  },
  {
    name: "chunkBytes",
    label: "Chunk bytes",
    type: "number",
    min: 1024,
    max: runtime.maxTransferBytes,
    step: 1024,
    help: "Chunk size used when streaming transfers.",
  },
];

const DB_FIELDS = (runtime: RuntimeConfig): FieldDefinition[] => [
  {
    name: "preset",
    label: "Preset",
    type: "select",
    help: "Baseline query profile.",
    options: PRESET_OPTIONS,
  },
  {
    name: "mode",
    label: "Query shape",
    type: "select",
    help: "Database workload to execute.",
    options: DB_MODE_OPTIONS,
  },
  {
    name: "iterations",
    label: "Iterations",
    type: "number",
    min: 1,
    max: runtime.maxIterations,
    step: 1,
    help: "Number of query runs in a series.",
  },
  {
    name: "rowCount",
    label: "Row count",
    type: "number",
    min: 100,
    max: runtime.maxDbRows,
    step: 100,
    help: "Seed size made available to the benchmark query.",
  },
  {
    name: "payloadBytes",
    label: "Payload bytes",
    type: "number",
    min: 32,
    max: 4096,
    step: 32,
    help: "Payload width stored per row in the benchmark dataset.",
  },
];

const JS_FIELDS = (runtime: RuntimeConfig): FieldDefinition[] => [
  {
    name: "preset",
    label: "Preset",
    type: "select",
    help: "Baseline script profile.",
    options: PRESET_OPTIONS,
  },
  {
    name: "iterations",
    label: "Iterations",
    type: "number",
    min: 1,
    max: runtime.maxIterations,
    step: 1,
    help: "Number of repeated import / parse cycles.",
  },
  {
    name: "moduleBytes",
    label: "Module bytes",
    type: "number",
    min: 4096,
    max: runtime.maxJsBytes,
    step: 1024,
    help: "Approximate size of the generated JavaScript module.",
  },
  {
    name: "dataBytes",
    label: "JSON bytes",
    type: "number",
    min: 4096,
    max: runtime.maxJsonBytes,
    step: 1024,
    help: "Approximate size of the generated JSON payload.",
  },
  {
    name: "workUnits",
    label: "Work units",
    type: "number",
    min: 1,
    max: 10000,
    step: 1,
    help: "Amount of synchronous work executed during module evaluation.",
  },
  {
    name: "domNodes",
    label: "DOM nodes",
    type: "number",
    min: 0,
    max: 3000,
    step: 10,
    help: "Number of nodes rendered after JSON parsing.",
  },
];

const IO_FIELDS = (runtime: RuntimeConfig): FieldDefinition[] => [
  {
    name: "preset",
    label: "Preset",
    type: "select",
    help: "Baseline filesystem profile.",
    options: PRESET_OPTIONS,
  },
  {
    name: "mode",
    label: "I/O mode",
    type: "select",
    help: "Filesystem access pattern.",
    options: IO_MODE_OPTIONS,
  },
  {
    name: "iterations",
    label: "Iterations",
    type: "number",
    min: 1,
    max: runtime.maxIterations,
    step: 1,
    help: "Number of repeated filesystem operations.",
  },
  {
    name: "fileBytes",
    label: "File bytes",
    type: "number",
    min: 1024,
    max: runtime.maxIoBytes,
    step: 1024,
    help: "Size of the file read or written during each run.",
  },
];

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: envNumber("PORT", 4321),
    maxIterations: envNumber("MAX_ITERATIONS", 24),
    maxTransferBytes: envNumber("MAX_TRANSFER_BYTES", 16 * 1024 * 1024),
    maxHtmlBytes: envNumber("MAX_HTML_BYTES", 640 * 1024),
    maxJsBytes: envNumber("MAX_JS_BYTES", 768 * 1024),
    maxJsonBytes: envNumber("MAX_JSON_BYTES", 4 * 1024 * 1024),
    maxDbRows: envNumber("MAX_DB_ROWS", 20000),
    maxIoBytes: envNumber("MAX_IO_BYTES", 16 * 1024 * 1024),
    maxImageCount: envNumber("MAX_IMAGE_COUNT", 18),
    maxServerDelayMs: envNumber("MAX_SERVER_DELAY_MS", 2000),
    dbPath: process.env.BENCH_DB_PATH ?? path.join(process.cwd(), ".data", "bench.sqlite"),
    tempDir: process.env.BENCH_TEMP_DIR ?? path.join(process.cwd(), ".tmp"),
  };
}

export function benchmarkCards() {
  return [
    {
      href: "/bench/ping",
      title: "Ping / Pong",
      body: "Tiny request-response probes to separate transport latency from server time.",
    },
    {
      href: "/bench/page/basic",
      title: "Page Load / Basic",
      body: "Measures navigation timing on a light but configurable page payload.",
    },
    {
      href: "/bench/page/heavy",
      title: "Page Load / Heavy",
      body: "Stresses HTML, assets, and page boot with a heavier document profile.",
    },
    {
      href: "/bench/file",
      title: "File Transfer",
      body: "Download and upload probes for throughput and total transfer time.",
    },
    {
      href: "/bench/db",
      title: "DB Query",
      body: "SQLite-backed query timings with indexed lookup, scan, aggregate, and write/read modes.",
    },
    {
      href: "/bench/js",
      title: "JS Parse",
      body: "Generated modules plus large JSON payloads to surface parse and evaluation costs.",
    },
    {
      href: "/bench/io",
      title: "Filesystem I/O",
      body: "Local disk read/write timing to isolate non-network I/O bottlenecks.",
    },
  ];
}

function readString(query: QueryInput, key: string): string | undefined {
  const raw = query[key];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    return raw[0];
  }
  return undefined;
}

function readEnum<T extends string>(
  query: QueryInput,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = readString(query, key);
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function readNumber(
  query: QueryInput,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readString(query, key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function basePreset(query: QueryInput): Preset {
  return readEnum(query, "preset", ["small", "medium", "large", "xlarge"], "medium");
}

export function resolveScenarioContext(
  id: BenchmarkId,
  query: QueryInput,
  runtime: RuntimeConfig,
): ScenarioContext {
  switch (id) {
    case "ping":
      return {
        id,
        title: "Ping / Pong Responsiveness",
        subtitle: "Small HTTP probes for end-to-end RTT, server time, and residual transport cost.",
        pagePath: "/bench/ping",
        endpoint: "/api/bench/ping",
        mode: "request",
        primaryMetric: "roundTripMs",
        fields: PING_FIELDS(runtime),
        values: resolvePingValues(query, runtime),
        notes: [
          "Client RTT includes browser scheduling, network transport, and server handling.",
          "Injected delay helps verify that the client can actually see server-side stalls.",
        ],
      };
    case "page-basic":
      return {
        id,
        title: "Page Load / Basic",
        subtitle: "Navigation timing for a light, configurable page with linked assets.",
        pagePath: "/bench/page/basic",
        mode: "navigation",
        primaryMetric: "loadEventMs",
        fields: PAGE_FIELDS(runtime),
        values: resolvePageValues("basic", query, runtime),
        notes: [
          "These metrics come from the browser navigation and resource timing APIs.",
          "Reload with new parameters to compare TTFB, DOMContentLoaded, load, and resource waterfalls.",
        ],
      };
    case "page-heavy":
      return {
        id,
        title: "Page Load / Heavy",
        subtitle: "Navigation timing under heavier HTML, script, stylesheet, and image payloads.",
        pagePath: "/bench/page/heavy",
        mode: "navigation",
        primaryMetric: "loadEventMs",
        fields: PAGE_FIELDS(runtime),
        values: resolvePageValues("heavy", query, runtime),
        notes: [
          "Use this page when users report slow complex page loads rather than simple responsiveness issues.",
          "The page-load script performs synchronous startup work so parse/evaluation pressure is visible.",
        ],
      };
    case "file":
      return {
        id,
        title: "File Transfer",
        subtitle: "Download and upload probes for latency, throughput, and transfer integrity.",
        pagePath: "/bench/file",
        endpoint: "/api/bench/file",
        mode: "request",
        primaryMetric: "durationMs",
        fields: FILE_FIELDS(runtime),
        values: resolveFileValues(query, runtime),
        notes: [
          "Download modes return binary payloads; upload modes report bytes accepted and checksum.",
          "Streaming download uses chunked writes so you can compare buffered and incremental transfer behavior.",
        ],
      };
    case "db":
      return {
        id,
        title: "Database Query",
        subtitle: "SQLite-backed request timings broken down into preparation, execution, materialization, and serialization.",
        pagePath: "/bench/db",
        endpoint: "/api/bench/db",
        mode: "request",
        primaryMetric: "totalMs",
        fields: DB_FIELDS(runtime),
        values: resolveDbValues(query, runtime),
        notes: [
          "The built-in adapter uses a seeded SQLite file so DB timings stay real without an external service.",
          "Use the write-read profile to surface lock contention or synchronous disk stalls.",
        ],
      };
    case "js":
      return {
        id,
        title: "JavaScript Parse + Startup",
        subtitle: "Generated module imports, large JSON payloads, and optional DOM work to expose browser-side startup cost.",
        pagePath: "/bench/js",
        endpoint: "/api/bench/js",
        mode: "request",
        primaryMetric: "importMs",
        fields: JS_FIELDS(runtime),
        values: resolveJsValues(query, runtime),
        notes: [
          "Import time includes fetch, parse, compile, and evaluation. Module evaluation time is also reported separately.",
          "Large JSON payloads are fetched as text and parsed on the client so parse time is explicit.",
        ],
      };
    case "io":
      return {
        id,
        title: "Filesystem I/O",
        subtitle: "Local disk operations to separate general I/O sluggishness from network effects.",
        pagePath: "/bench/io",
        endpoint: "/api/bench/io",
        mode: "request",
        primaryMetric: "totalMs",
        fields: IO_FIELDS(runtime),
        values: resolveIoValues(query, runtime),
        notes: [
          "Reads use a benchmark temp area so they do not touch application data.",
          "Write-read mode exposes sync disk behavior by writing then immediately reading the same payload.",
        ],
      };
  }
}

function resolvePingValues(query: QueryInput, runtime: RuntimeConfig) {
  const preset = basePreset(query);
  const defaultsTable: Record<Preset, { iterations: number; payloadBytes: number; serverDelayMs: number }> = {
    small: { iterations: 5, payloadBytes: 64, serverDelayMs: 0 },
    medium: { iterations: 10, payloadBytes: 512, serverDelayMs: 10 },
    large: { iterations: 14, payloadBytes: 4096, serverDelayMs: 25 },
    xlarge: { iterations: 20, payloadBytes: 16384, serverDelayMs: 60 },
  };
  const defaults = defaultsTable[preset];
  return {
    preset,
    iterations: readNumber(query, "iterations", defaults.iterations, 1, runtime.maxIterations),
    payloadBytes: readNumber(query, "payloadBytes", defaults.payloadBytes, 16, runtime.maxTransferBytes),
    serverDelayMs: readNumber(query, "serverDelayMs", defaults.serverDelayMs, 0, runtime.maxServerDelayMs),
  };
}

function resolvePageValues(variant: "basic" | "heavy", query: QueryInput, runtime: RuntimeConfig) {
  const preset = basePreset(query);
  const table: Record<
    Preset,
    {
      htmlBytes: number;
      styleBytes: number;
      scriptBytes: number;
      imageCount: number;
      imageBytes: number;
      serverDelayMs: number;
    }
  > =
    variant === "basic"
      ? {
          small: { htmlBytes: 12 * 1024, styleBytes: 4 * 1024, scriptBytes: 8 * 1024, imageCount: 2, imageBytes: 8 * 1024, serverDelayMs: 0 },
          medium: { htmlBytes: 40 * 1024, styleBytes: 12 * 1024, scriptBytes: 20 * 1024, imageCount: 4, imageBytes: 20 * 1024, serverDelayMs: 10 },
          large: { htmlBytes: 80 * 1024, styleBytes: 24 * 1024, scriptBytes: 50 * 1024, imageCount: 6, imageBytes: 40 * 1024, serverDelayMs: 25 },
          xlarge: { htmlBytes: 160 * 1024, styleBytes: 48 * 1024, scriptBytes: 90 * 1024, imageCount: 8, imageBytes: 64 * 1024, serverDelayMs: 40 },
        }
      : {
          small: { htmlBytes: 50 * 1024, styleBytes: 16 * 1024, scriptBytes: 40 * 1024, imageCount: 4, imageBytes: 16 * 1024, serverDelayMs: 10 },
          medium: { htmlBytes: 120 * 1024, styleBytes: 40 * 1024, scriptBytes: 100 * 1024, imageCount: 8, imageBytes: 48 * 1024, serverDelayMs: 25 },
          large: { htmlBytes: 220 * 1024, styleBytes: 80 * 1024, scriptBytes: 220 * 1024, imageCount: 12, imageBytes: 96 * 1024, serverDelayMs: 40 },
          xlarge: { htmlBytes: 320 * 1024, styleBytes: 120 * 1024, scriptBytes: 360 * 1024, imageCount: 16, imageBytes: 160 * 1024, serverDelayMs: 75 },
        };
  const defaults = table[preset];
  return {
    preset,
    htmlBytes: readNumber(query, "htmlBytes", defaults.htmlBytes, 2048, runtime.maxHtmlBytes),
    styleBytes: readNumber(query, "styleBytes", defaults.styleBytes, 1024, runtime.maxHtmlBytes),
    scriptBytes: readNumber(query, "scriptBytes", defaults.scriptBytes, 1024, runtime.maxJsBytes),
    imageCount: readNumber(query, "imageCount", defaults.imageCount, 0, runtime.maxImageCount),
    imageBytes: readNumber(query, "imageBytes", defaults.imageBytes, 1024, runtime.maxTransferBytes),
    serverDelayMs: readNumber(query, "serverDelayMs", defaults.serverDelayMs, 0, runtime.maxServerDelayMs),
  };
}

function resolveFileValues(query: QueryInput, runtime: RuntimeConfig) {
  const preset = basePreset(query);
  const defaultsTable: Record<Preset, { iterations: number; mode: string; transferBytes: number; chunkBytes: number }> = {
    small: { iterations: 3, mode: "download-buffer", transferBytes: 64 * 1024, chunkBytes: 16 * 1024 },
    medium: { iterations: 5, mode: "download-stream", transferBytes: 512 * 1024, chunkBytes: 64 * 1024 },
    large: { iterations: 8, mode: "upload-raw", transferBytes: 2 * 1024 * 1024, chunkBytes: 128 * 1024 },
    xlarge: { iterations: 10, mode: "upload-form", transferBytes: 6 * 1024 * 1024, chunkBytes: 256 * 1024 },
  };
  const defaults = defaultsTable[preset];
  return {
    preset,
    mode: readEnum(query, "mode", FILE_MODE_OPTIONS.map((option) => option.value), defaults.mode),
    iterations: readNumber(query, "iterations", defaults.iterations, 1, runtime.maxIterations),
    transferBytes: readNumber(query, "transferBytes", defaults.transferBytes, 4096, runtime.maxTransferBytes),
    chunkBytes: readNumber(query, "chunkBytes", defaults.chunkBytes, 1024, runtime.maxTransferBytes),
  };
}

function resolveDbValues(query: QueryInput, runtime: RuntimeConfig) {
  const preset = basePreset(query);
  const defaultsTable: Record<Preset, { iterations: number; mode: string; rowCount: number; payloadBytes: number }> = {
    small: { iterations: 3, mode: "lookup", rowCount: 500, payloadBytes: 128 },
    medium: { iterations: 5, mode: "range", rowCount: 2000, payloadBytes: 256 },
    large: { iterations: 8, mode: "aggregate", rowCount: 6000, payloadBytes: 512 },
    xlarge: { iterations: 10, mode: "write-read", rowCount: 10000, payloadBytes: 1024 },
  };
  const defaults = defaultsTable[preset];
  return {
    preset,
    mode: readEnum(query, "mode", DB_MODE_OPTIONS.map((option) => option.value), defaults.mode),
    iterations: readNumber(query, "iterations", defaults.iterations, 1, runtime.maxIterations),
    rowCount: readNumber(query, "rowCount", defaults.rowCount, 100, runtime.maxDbRows),
    payloadBytes: readNumber(query, "payloadBytes", defaults.payloadBytes, 32, 4096),
  };
}

function resolveJsValues(query: QueryInput, runtime: RuntimeConfig) {
  const preset = basePreset(query);
  const defaultsTable: Record<
    Preset,
    { iterations: number; moduleBytes: number; dataBytes: number; workUnits: number; domNodes: number }
  > = {
    small: { iterations: 2, moduleBytes: 24 * 1024, dataBytes: 32 * 1024, workUnits: 300, domNodes: 40 },
    medium: { iterations: 3, moduleBytes: 96 * 1024, dataBytes: 256 * 1024, workUnits: 800, domNodes: 120 },
    large: { iterations: 4, moduleBytes: 220 * 1024, dataBytes: 1024 * 1024, workUnits: 1500, domNodes: 240 },
    xlarge: { iterations: 5, moduleBytes: 420 * 1024, dataBytes: 2 * 1024 * 1024, workUnits: 2500, domNodes: 400 },
  };
  const defaults = defaultsTable[preset];
  return {
    preset,
    iterations: readNumber(query, "iterations", defaults.iterations, 1, runtime.maxIterations),
    moduleBytes: readNumber(query, "moduleBytes", defaults.moduleBytes, 4096, runtime.maxJsBytes),
    dataBytes: readNumber(query, "dataBytes", defaults.dataBytes, 4096, runtime.maxJsonBytes),
    workUnits: readNumber(query, "workUnits", defaults.workUnits, 1, 10000),
    domNodes: readNumber(query, "domNodes", defaults.domNodes, 0, 3000),
  };
}

function resolveIoValues(query: QueryInput, runtime: RuntimeConfig) {
  const preset = basePreset(query);
  const defaultsTable: Record<Preset, { iterations: number; mode: string; fileBytes: number }> = {
    small: { iterations: 3, mode: "small-read", fileBytes: 32 * 1024 },
    medium: { iterations: 5, mode: "large-read", fileBytes: 256 * 1024 },
    large: { iterations: 8, mode: "write-read", fileBytes: 1024 * 1024 },
    xlarge: { iterations: 10, mode: "write-read", fileBytes: 4 * 1024 * 1024 },
  };
  const defaults = defaultsTable[preset];
  return {
    preset,
    mode: readEnum(query, "mode", IO_MODE_OPTIONS.map((option) => option.value), defaults.mode),
    iterations: readNumber(query, "iterations", defaults.iterations, 1, runtime.maxIterations),
    fileBytes: readNumber(query, "fileBytes", defaults.fileBytes, 1024, runtime.maxIoBytes),
  };
}
