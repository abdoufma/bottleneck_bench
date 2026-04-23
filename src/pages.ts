import type { FieldDefinition, RuntimeConfig, ScenarioContext } from "./config.ts";
import { benchmarkCards } from "./config.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stringifyForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderField(field: FieldDefinition, value: string | number): string {
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => {
        const selected = option.value === value ? " selected" : "";
        return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
      })
      .join("");
    return `
      <label class="control">
        <span class="control-label">${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(field.name)}">${options}</select>
        <span class="control-help">${escapeHtml(field.help)}</span>
      </label>
    `;
  }

  return `
    <label class="control">
      <span class="control-label">${escapeHtml(field.label)}</span>
      <input
        name="${escapeHtml(field.name)}"
        type="number"
        value="${escapeHtml(String(value))}"
        min="${field.min ?? ""}"
        max="${field.max ?? ""}"
        step="${field.step ?? 1}"
      />
      <span class="control-help">${escapeHtml(field.help)}</span>
    </label>
  `;
}

function renderControls(context: ScenarioContext): string {
  const fields = context.fields
    .map((field) => renderField(field, context.values[field.name] ?? ""))
    .join("");

  const actionButtons =
    context.mode === "navigation"
      ? `<button type="button" class="action primary" id="reload-run">Reload scenario</button>`
      : `
          <button type="button" class="action primary" id="run-once">Run once</button>
          <button type="button" class="action" id="run-series">Run series</button>
        `;

  return `
    <form id="control-form" class="control-panel" data-page-path="${escapeHtml(context.pagePath)}">
      <div class="control-grid">${fields}</div>
      <div class="action-row">
        ${actionButtons}
        <button type="button" class="action subtle" id="export-results" disabled>Export JSON</button>
      </div>
    </form>
  `;
}

function renderNotes(notes: string[]): string {
  const items = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  return `<ul class="note-list">${items}</ul>`;
}

function renderMetricSkeleton(): string {
  return `
    <div class="metric-grid empty" id="metric-grid">
      <div class="metric-card">
        <span class="metric-label">Status</span>
        <span class="metric-value muted">Awaiting run</span>
      </div>
    </div>
  `;
}

function fillerParagraph(index: number): string {
  const bodies = [
    "Field measurements should be comparable across subnets, browsers, and transport conditions.",
    "This diagnostic page is intentionally content-heavy so navigation timing can be correlated with RTT and asset waterfalls.",
    "Operators can tighten or widen payload sizes without editing the server by using preset-aware query parameters.",
    "Results are not persisted on the server in v1, so export them if you need a manual comparison trail.",
  ];
  return bodies[index % bodies.length]!;
}

function buildFillerArticles(targetBytes: number): string {
  let html = "";
  let index = 0;
  while (html.length < targetBytes) {
    html += `
      <article class="payload-card">
        <span class="payload-index">Segment ${index + 1}</span>
        <h3>Controlled markup payload for repeatable navigation timing</h3>
        <p>${escapeHtml(fillerParagraph(index))}</p>
        <p>${escapeHtml(fillerParagraph(index + 1))}</p>
      </article>
    `;
    index += 1;
  }
  return html;
}

function renderImageGrid(context: ScenarioContext): string {
  const count = Number(context.values.imageCount ?? 0);
  const size = Number(context.values.imageBytes ?? 8192);
  let html = "";
  for (let index = 0; index < count; index += 1) {
    const params = new URLSearchParams({
      sizeBytes: String(size),
      label: `${context.id}-${index + 1}`,
      hue: String(28 + ((index * 21) % 55)),
    });
    html += `
      <figure class="image-card">
        <img
          src="/api/bench/assets/image.svg?${params.toString()}"
          alt="Generated diagnostic asset ${index + 1}"
          width="240"
          height="160"
          loading="eager"
        />
        <figcaption>Asset ${index + 1} · ${formatNumber(size)} bytes</figcaption>
      </figure>
    `;
  }
  return html;
}

function renderNavigationPayload(context: ScenarioContext): string {
  const styleQuery = new URLSearchParams({
    sizeBytes: String(context.values.styleBytes),
    accent: context.id === "page-heavy" ? "heavy" : "basic",
  }).toString();
  const scriptQuery = new URLSearchParams({
    sizeBytes: String(context.values.scriptBytes),
    workUnits: context.id === "page-heavy" ? "1200" : "400",
    nonce: String(Date.now()),
  }).toString();

  const head = `
    <link rel="stylesheet" href="/api/bench/assets/page-style.css?${styleQuery}" />
    <script defer src="/api/bench/assets/page-script.js?${scriptQuery}"></script>
  `;

  const body = `
    <section class="payload-surface">
      <div class="payload-header">
        <span class="pill">Navigation payload</span>
        <p>This section intentionally contributes controlled markup and asset load to the page timing result.</p>
      </div>
      <div class="payload-columns">
        ${buildFillerArticles(Number(context.values.htmlBytes ?? 0))}
      </div>
      <div class="image-grid">${renderImageGrid(context)}</div>
    </section>
  `;

  return head + body;
}

function layout(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/style.css" />
    ${extraHead}
  </head>
  <body>
    ${body}
    <script src="/app.js" defer></script>
  </body>
</html>`;
}

export function renderDashboard(runtime: RuntimeConfig): string {
  const cards = benchmarkCards()
    .map(
      (card) => `
        <a class="dashboard-card" href="${escapeHtml(card.href)}">
          <span class="dashboard-kicker">Benchmark</span>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.body)}</p>
          <span class="dashboard-link">Open scenario</span>
        </a>
      `,
    )
    .join("");

  const body = `
    <main class="dashboard-shell">
      <section class="hero-panel">
        <div class="hero-copy">
          <span class="eyebrow">HTTP diagnostic workbench</span>
          <h1>Parallel benchmark server for isolating transport, browser, and server latency.</h1>
          <p>
            This standalone Express application hosts targeted pages and APIs so you can compare the main server against a controlled reference surface on the same machine.
          </p>
        </div>
        <div class="hero-stats">
          <div class="metric-card">
            <span class="metric-label">Host</span>
            <span class="metric-value">${escapeHtml(runtime.host)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Port</span>
            <span class="metric-value">${runtime.port}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">DB path</span>
            <span class="metric-value tight">${escapeHtml(runtime.dbPath)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Temp dir</span>
            <span class="metric-value tight">${escapeHtml(runtime.tempDir)}</span>
          </div>
        </div>
      </section>

      <section class="dashboard-grid">${cards}</section>

      <section class="footer-panel">
        <p>System endpoints: <code>/health</code>, <code>/api/system/info</code>, <code>/api/bench/config/:scenario</code></p>
        <p>All benchmark pages keep measurements client-side in the browser. Use the export action on each page if you need a portable snapshot.</p>
      </section>
    </main>
  `;

  return layout("HTTP Diagnostic Workbench", body);
}

export function renderBenchmarkPage(context: ScenarioContext): string {
  const contextScript = `<script id="bench-context" type="application/json">${stringifyForScript(context)}</script>`;
  const navigationPayload = context.mode === "navigation" ? renderNavigationPayload(context) : "";
  const extraHead = context.mode === "navigation" ? navigationPayload.slice(0, navigationPayload.indexOf("<section")) : "";
  const navigationBody = context.mode === "navigation" ? navigationPayload.slice(navigationPayload.indexOf("<section")) : "";

  const body = `
    <main class="bench-shell">
      <header class="hero-panel">
        <div class="hero-copy">
          <a class="eyebrow link-back" href="/">Back to dashboard</a>
          <h1>${escapeHtml(context.title)}</h1>
          <p>${escapeHtml(context.subtitle)}</p>
        </div>
        <div class="hero-stats">
          <div class="metric-card">
            <span class="metric-label">Route</span>
            <span class="metric-value">${escapeHtml(context.pagePath)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Primary metric</span>
            <span class="metric-value">${escapeHtml(context.primaryMetric)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Mode</span>
            <span class="metric-value">${escapeHtml(context.mode)}</span>
          </div>
        </div>
      </header>

      <section class="bench-layout">
        <aside class="bench-sidebar">
          ${renderControls(context)}
          ${renderNotes(context.notes)}
        </aside>

        <section class="bench-main">
          <div class="status-bar" id="status-line">Ready.</div>
          ${renderMetricSkeleton()}
          <div class="table-shell">
            <table id="samples-table">
              <thead></thead>
              <tbody></tbody>
            </table>
          </div>
          <pre id="raw-output" class="raw-output">No result captured yet.</pre>
        </section>
      </section>

      ${navigationBody}
    </main>
    ${contextScript}
  `;

  return layout(context.title, body, extraHead);
}
