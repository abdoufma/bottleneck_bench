# bottleneck_bench

Internal HTTP diagnostic benchmark server for separating server-side latency from network, browser, and local I/O effects.

## Install

```bash
bun install
```

## Run

```bash
bun run start
```

The server starts on `http://0.0.0.0:4321` by default.

## Available diagnostics

- `GET /` dashboard
- `GET /bench/ping` round-trip responsiveness
- `GET /bench/page/basic` light page-load benchmark
- `GET /bench/page/heavy` heavy page-load benchmark
- `GET /bench/file` upload/download throughput
- `GET /bench/db` SQLite-backed query latency
- `GET /bench/js` module import and JSON parsing latency
- `GET /bench/io` local filesystem I/O latency

## Useful environment variables

- `PORT`
- `HOST`
- `MAX_ITERATIONS`
- `MAX_TRANSFER_BYTES`
- `MAX_JS_BYTES`
- `MAX_JSON_BYTES`
- `MAX_DB_ROWS`
- `MAX_IO_BYTES`
- `BENCH_DB_PATH`
- `BENCH_TEMP_DIR`
