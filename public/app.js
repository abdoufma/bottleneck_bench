(() => {
  const contextNode = document.getElementById("bench-context");
  if (!contextNode) {
    return;
  }

  const context = JSON.parse(contextNode.textContent || "{}");
  const form = document.getElementById("control-form");
  const statusLine = document.getElementById("status-line");
  const metricGrid = document.getElementById("metric-grid");
  const tableHead = document.querySelector("#samples-table thead");
  const tableBody = document.querySelector("#samples-table tbody");
  const rawOutput = document.getElementById("raw-output");
  const exportButton = document.getElementById("export-results");
  const renderSink = document.createElement("div");
  renderSink.className = "render-sink";
  document.body.appendChild(renderSink);

  let lastResult = null;

  const actions = {
    runOnce: document.getElementById("run-once"),
    runSeries: document.getElementById("run-series"),
    reloadRun: document.getElementById("reload-run"),
  };

  if (!form || !statusLine || !metricGrid || !tableHead || !tableBody || !rawOutput || !exportButton) {
    return;
  }

  if (actions.runOnce) {
    actions.runOnce.addEventListener("click", () => runScenario({ single: true }));
  }

  if (actions.runSeries) {
    actions.runSeries.addEventListener("click", () => runScenario({ single: false }));
  }

  if (actions.reloadRun) {
    actions.reloadRun.addEventListener("click", () => {
      const target = new URL(window.location.origin + context.pagePath);
      target.search = toSearchParams(readValues()).toString();
      window.location.assign(target);
    });
  }

  exportButton.addEventListener("click", () => {
    if (!lastResult) {
      return;
    }
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${context.id}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  if (context.mode === "navigation") {
    captureNavigationMetrics();
  }

  async function runScenario({ single }) {
    setBusy(true);
    setStatus(single ? "Running one iteration..." : "Running series...");
    try {
      const values = readValues();
      if (single) {
        values.iterations = 1;
      }

      let result;
      switch (context.id) {
        case "ping":
          result = await runPing(values);
          break;
        case "file":
          result = await runFile(values);
          break;
        case "db":
          result = await runDb(values);
          break;
        case "js":
          result = await runJs(values);
          break;
        case "io":
          result = await runIo(values);
          break;
        default:
          throw new Error(`No request runner registered for ${context.id}`);
      }

      lastResult = {
        scenario: context.id,
        capturedAt: new Date().toISOString(),
        effectiveConfig: values,
        ...result,
      };
      exportButton.disabled = false;
      renderResult(lastResult);
      setStatus(`Completed ${values.iterations} iteration${values.iterations === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Benchmark failed.", true);
    } finally {
      setBusy(false);
    }
  }

  function captureNavigationMetrics() {
    window.setTimeout(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      if (!navigation) {
        setStatus("Navigation timing is not available in this browser.", true);
        return;
      }

      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.startsWith(window.location.origin))
        .sort((left, right) => right.duration - left.duration);

      const assetMetrics = Array.isArray(window.__pageLoadAssetMetrics)
        ? window.__pageLoadAssetMetrics
        : [];

      const summary = {
        "TTFB (ms)": round(navigation.responseStart),
        "DOMContentLoaded (ms)": round(navigation.domContentLoadedEventEnd),
        "Load event (ms)": round(navigation.loadEventEnd),
        "Transfer (KB)": round((navigation.transferSize || 0) / 1024),
        Resources: resources.length,
        "Page script eval (ms)": round(
          assetMetrics.reduce((sum, item) => sum + Number(item.evaluationMs || 0), 0),
        ),
      };

      const samples = resources.slice(0, 12).map((entry, index) => ({
        rank: index + 1,
        resource: shrinkName(entry.name),
        initiator: entry.initiatorType || "document",
        durationMs: round(entry.duration),
        transferKB: round((entry.transferSize || 0) / 1024),
      }));

      lastResult = {
        scenario: context.id,
        capturedAt: new Date().toISOString(),
        effectiveConfig: readValues(),
        summary,
        samples,
        raw: {
          navigation,
          resources,
          assetMetrics,
        },
      };

      exportButton.disabled = false;
      renderResult(lastResult);
      setStatus("Captured navigation timing for the current page load.");
    }, 60);
  }

  async function runPing(values) {
    const samples = [];
    for (let iteration = 1; iteration <= values.iterations; iteration += 1) {
      const url = new URL("/api/bench/ping", window.location.origin);
      url.search = toSearchParams(values).toString();
      const startedAt = performance.now();
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      const roundTripMs = performance.now() - startedAt;
      samples.push({
        iteration,
        roundTripMs: round(roundTripMs),
        serverMs: round(Number(payload.serverTiming.totalMs || 0)),
        transportMs: round(roundTripMs - Number(payload.serverTiming.totalMs || 0)),
        echoBytes: Number(payload.data.echoBytes || 0),
      });
    }

    return {
      summary: {
        "Avg RTT (ms)": round(mean(samples, "roundTripMs")),
        "P95 RTT (ms)": percentile(samples.map((sample) => sample.roundTripMs), 95),
        "Avg server (ms)": round(mean(samples, "serverMs")),
        "Avg transport gap (ms)": round(mean(samples, "transportMs")),
      },
      samples,
      raw: samples,
    };
  }

  async function runFile(values) {
    const samples = [];
    for (let iteration = 1; iteration <= values.iterations; iteration += 1) {
      const startedAt = performance.now();
      if (values.mode === "download-buffer" || values.mode === "download-stream") {
        const url = new URL("/api/bench/file", window.location.origin);
        url.search = toSearchParams(values).toString();
        const response = await fetch(url, { cache: "no-store" });
        const body = await response.arrayBuffer();
        const elapsed = performance.now() - startedAt;
        const bytes = body.byteLength;
        samples.push({
          iteration,
          direction: values.mode,
          durationMs: round(elapsed),
          bytes,
          throughputMbps: round(toMbps(bytes, elapsed)),
          serverMs: round(Number(response.headers.get("x-server-ms") || 0)),
        });
      } else {
        const payload = makePayload(values.transferBytes);
        const url = new URL(
          values.mode === "upload-form" ? "/api/bench/file/form" : "/api/bench/file/raw",
          window.location.origin,
        );
        url.search = toSearchParams(values).toString();

        const init =
          values.mode === "upload-form"
            ? {
                method: "POST",
                body: (() => {
                  const formData = new FormData();
                  formData.append("payload", new Blob([payload]), "benchmark.bin");
                  return formData;
                })(),
              }
            : {
                method: "POST",
                headers: { "content-type": "application/octet-stream" },
                body: payload,
              };

        const response = await fetch(url, init);
        const result = await response.json();
        const elapsed = performance.now() - startedAt;
        samples.push({
          iteration,
          direction: values.mode,
          durationMs: round(elapsed),
          bytes: Number(result.data.receivedBytes || 0),
          throughputMbps: round(toMbps(Number(result.data.receivedBytes || 0), elapsed)),
          checksum: result.data.checksum,
        });
      }
    }

    return {
      summary: {
        "Avg duration (ms)": round(mean(samples, "durationMs")),
        "P95 duration (ms)": percentile(samples.map((sample) => sample.durationMs), 95),
        "Avg throughput (Mb/s)": round(mean(samples, "throughputMbps")),
        Mode: values.mode,
      },
      samples,
      raw: samples,
    };
  }

  async function runDb(values) {
    const samples = [];
    const phaseTotals = { prepareMs: 0, executeMs: 0, materializeMs: 0, serializeMs: 0 };

    for (let iteration = 1; iteration <= values.iterations; iteration += 1) {
      const url = new URL("/api/bench/db", window.location.origin);
      url.search = toSearchParams(values).toString();
      const startedAt = performance.now();
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      const elapsed = performance.now() - startedAt;
      const phases = result.data.phases || {};
      Object.keys(phaseTotals).forEach((key) => {
        phaseTotals[key] += Number(phases[key] || 0);
      });
      samples.push({
        iteration,
        totalMs: round(elapsed),
        serverMs: round(Number(result.serverTiming.totalMs || 0)),
        prepareMs: round(Number(phases.prepareMs || 0)),
        executeMs: round(Number(phases.executeMs || 0)),
        materializeMs: round(Number(phases.materializeMs || 0)),
        serializeMs: round(Number(phases.serializeMs || 0)),
        rowsReturned: Number(result.data.rowsReturned || 0),
      });
    }

    return {
      summary: {
        "Avg total (ms)": round(mean(samples, "totalMs")),
        "Avg execute (ms)": round(phaseTotals.executeMs / values.iterations),
        "Avg materialize (ms)": round(phaseTotals.materializeMs / values.iterations),
        "Avg serialize (ms)": round(phaseTotals.serializeMs / values.iterations),
      },
      samples,
      raw: samples,
    };
  }

  async function runIo(values) {
    const samples = [];
    for (let iteration = 1; iteration <= values.iterations; iteration += 1) {
      const url = new URL("/api/bench/io", window.location.origin);
      url.search = toSearchParams(values).toString();
      const startedAt = performance.now();
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      const elapsed = performance.now() - startedAt;
      const phases = result.data.phases || {};
      samples.push({
        iteration,
        totalMs: round(elapsed),
        setupMs: round(Number(phases.setupMs || 0)),
        writeMs: round(Number(phases.writeMs || 0)),
        readMs: round(Number(phases.readMs || 0)),
        cleanupMs: round(Number(phases.cleanupMs || 0)),
        bytesProcessed: Number(result.data.bytesProcessed || 0),
      });
    }

    return {
      summary: {
        "Avg total (ms)": round(mean(samples, "totalMs")),
        "P95 total (ms)": percentile(samples.map((sample) => sample.totalMs), 95),
        "Avg read (ms)": round(mean(samples, "readMs")),
        "Avg write (ms)": round(mean(samples, "writeMs")),
      },
      samples,
      raw: samples,
    };
  }

  async function runJs(values) {
    const samples = [];
    for (let iteration = 1; iteration <= values.iterations; iteration += 1) {
      const nonce = `${Date.now()}-${iteration}`;
      const moduleUrl = new URL("/api/bench/js/module.mjs", window.location.origin);
      moduleUrl.search = new URLSearchParams({
        sizeBytes: String(values.moduleBytes),
        workUnits: String(values.workUnits),
        nonce,
      }).toString();

      const importStart = performance.now();
      const moduleResult = await import(moduleUrl.toString());
      const importMs = performance.now() - importStart;

      const dataUrl = new URL("/api/bench/js/data.json", window.location.origin);
      dataUrl.search = new URLSearchParams({
        sizeBytes: String(values.dataBytes),
        nonce,
      }).toString();

      const fetchStart = performance.now();
      const response = await fetch(dataUrl, { cache: "no-store" });
      const text = await response.text();
      const jsonFetchMs = performance.now() - fetchStart;

      const parseStart = performance.now();
      const parsed = JSON.parse(text);
      const jsonParseMs = performance.now() - parseStart;

      const domStart = performance.now();
      renderNodes(values.domNodes, parsed.rows || []);
      const domRenderMs = performance.now() - domStart;

      samples.push({
        iteration,
        importMs: round(importMs),
        moduleEvalMs: round(Number(moduleResult.default.metrics.evaluationMs || 0)),
        jsonFetchMs: round(jsonFetchMs),
        jsonParseMs: round(jsonParseMs),
        domRenderMs: round(domRenderMs),
      });
    }

    return {
      summary: {
        "Avg import (ms)": round(mean(samples, "importMs")),
        "Avg module eval (ms)": round(mean(samples, "moduleEvalMs")),
        "Avg JSON fetch (ms)": round(mean(samples, "jsonFetchMs")),
        "Avg JSON parse (ms)": round(mean(samples, "jsonParseMs")),
        "Avg DOM render (ms)": round(mean(samples, "domRenderMs")),
      },
      samples,
      raw: samples,
    };
  }

  function renderNodes(count, rows) {
    renderSink.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const row = rows[index % Math.max(rows.length, 1)] || { label: "row", score: 0 };
      const node = document.createElement("div");
      node.className = "render-chip";
      node.textContent = `${row.label} · ${row.score}`;
      fragment.appendChild(node);
    }
    renderSink.appendChild(fragment);
  }

  function readValues() {
    const values = {};
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
      const element = form.elements.namedItem(key);
      values[key] = element instanceof HTMLInputElement && element.type === "number" ? Number(value) : value;
    }
    return values;
  }

  function toSearchParams(values) {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      params.set(key, String(value));
    });
    return params;
  }

  function renderResult(result) {
    metricGrid.classList.remove("empty");
    metricGrid.innerHTML = Object.entries(result.summary)
      .map(
        ([label, value]) => `
          <div class="metric-card">
            <span class="metric-label">${escapeHtml(label)}</span>
            <span class="metric-value">${escapeHtml(String(value))}</span>
          </div>
        `,
      )
      .join("");

    renderTable(result.samples);
    rawOutput.textContent = JSON.stringify(result.raw, null, 2);
  }

  function renderTable(samples) {
    if (!samples.length) {
      tableHead.innerHTML = "";
      tableBody.innerHTML = "";
      return;
    }
    const columns = [...new Set(samples.flatMap((sample) => Object.keys(sample)))];
    tableHead.innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
    tableBody.innerHTML = samples
      .map(
        (sample) => `
          <tr>
            ${columns
              .map((column) => `<td>${escapeHtml(String(sample[column] ?? ""))}</td>`)
              .join("")}
          </tr>
        `,
      )
      .join("");
  }

  function setStatus(message, isError = false) {
    statusLine.textContent = message;
    statusLine.classList.toggle("error", isError);
  }

  function setBusy(isBusy) {
    [actions.runOnce, actions.runSeries, actions.reloadRun].forEach((button) => {
      if (button) {
        button.disabled = isBusy;
      }
    });
    form.querySelectorAll("input, select").forEach((element) => {
      element.disabled = isBusy;
    });
  }

  function mean(samples, key) {
    if (!samples.length) {
      return 0;
    }
    return samples.reduce((sum, sample) => sum + Number(sample[key] || 0), 0) / samples.length;
  }

  function percentile(values, p) {
    if (!values.length) {
      return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return round(sorted[index]);
  }

  function round(value) {
    return Number(Number(value).toFixed(2));
  }

  function toMbps(bytes, durationMs) {
    if (!durationMs) {
      return 0;
    }
    return (bytes * 8) / (durationMs / 1000) / 1_000_000;
  }

  function shrinkName(name) {
    try {
      const url = new URL(name);
      return `${url.pathname}${url.search}`;
    } catch {
      return name;
    }
  }

  function makePayload(sizeBytes) {
    const chunk = new Uint8Array(16 * 1024);
    for (let index = 0; index < chunk.length; index += 1) {
      chunk[index] = 65 + (index % 26);
    }
    const payload = new Uint8Array(sizeBytes);
    for (let offset = 0; offset < sizeBytes; offset += chunk.length) {
      payload.set(chunk.subarray(0, Math.min(chunk.length, sizeBytes - offset)), offset);
    }
    return payload;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
