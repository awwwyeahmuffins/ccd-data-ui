// explorePage.js
// --------------------------------------------------------------------------------
// Orchestrator for explore.html — a sortable, filterable table of every precinct
// across every data dimension we have (politics, race, age, income, families,
// housing, education, commute, turnout). Pure data + metric logic lives in
// precinctMetrics.js. Must not import js/app/* modules.

import { boundary } from "./data/dataService.js";
import {
  buildRecords,
  METRICS,
  METRIC_CATEGORIES,
  getMetric,
  availableMetricIds,
  formatValue,
  sortRecords,
  filterRecords,
} from "./precinctMetrics.js";
import { escapeHtml } from "./lib/dom.js";
import { readParams, writeParams } from "./lib/urlState.js";
import { renderDataTable } from "./ui/dataTable.js";

const DEFAULT_COLUMNS = ["winner", "demShare", "registered", "population", "medianIncome", "medianHomeValue", "medianAge", "pctFamily", "nonWhite", "turnoutRate"];

// The Summary view: the eight numbers that matter most, no horizontal scroll.
const SUMMARY_COLUMNS = ["winner", "demShare", "registered", "population", "medianIncome", "nonWhite", "turnoutRate"];

// Electorates this small make every percentage noise (e.g. "100% Dem" off 2
// voters) and mean the area-weighted census figures wildly overstate who really
// lives there (commercial strips, new developments) — flag the row so the real
// counts, not the %s or census pop, carry the meaning. ~5 of Collin's precincts.
const TINY_ELECTORATE = 50;

const pg = {
  view: "summary",        // "summary" | a METRIC_CATEGORIES id | "all" (spreadsheet)
  sortKey: "medianIncome",
  sortDir: "desc",
  party: "all",
  conditions: [],
  columns: DEFAULT_COLUMNS.slice(),
  records: [],
  available: new Set(),
};

const $ = (id) => document.getElementById(id);

// The one boundary handle this page uses — the app is pinned to the 2026 set.
const svc = boundary();

// ---- marquee turnout: highest-turnout election on file ----------------------
async function loadMarqueeTurnout() {
  try {
    const races = await svc.listRaces();
    const files = [...new Set(races.map((e) => e.turnoutFile).filter(Boolean))];
    if (!files.length) return null;
    let best = null, bestBallots = -1;
    for (const f of files) {
      try {
        const rows = await d3.csv(`${svc.config.dataDir}/${f}`, (d) => ({ precinct: d.precinct, registered: +d.registered, ballots: +d.ballots_cast }));
        const sum = rows.reduce((s, r) => s + (isNaN(r.ballots) ? 0 : r.ballots), 0);
        if (sum > bestBallots) { bestBallots = sum; best = rows; }
      } catch (_) { /* skip */ }
    }
    if (!best || bestBallots <= 0) return null;
    const lookup = {};
    for (const r of best) {
      if (r.precinct == null || r.precinct === "") continue;
      lookup[String(r.precinct)] = { registered: isNaN(r.registered) ? null : r.registered, ballots: isNaN(r.ballots) ? null : r.ballots };
    }
    return Object.keys(lookup).length ? lookup : null;
  } catch (_) { return null; }
}

// ---- census profiles (profile extra — optional, absent renders N/A) ---------
// Fetched directly off this page's boundary handle: precinctProfile.js's
// loadCensusProfiles still reads dataLoader's active boundary, which this page
// no longer sets (it would silently resolve the 2024 profiles).
async function loadCensusProfiles() {
  const resp = await fetch(`${svc.config.profileDir}/census_profiles.json`);
  if (!resp.ok) throw new Error(`Failed to load census profiles: ${resp.status}`);
  return resp.json();
}

// ---- load the data ------------------------------------------------------------
async function loadData() {
  $("ex-body").innerHTML = '<tr><td class="empty-note">Loading…</td></tr>';
  try {
    // Always the 2026 boundary set — the note about re-drawn estimates applies.
    $("ex-boundary-note").style.display = "";
    let census = null;
    const [{ geojson }, turnout] = await Promise.all([svc.loadAll(), loadMarqueeTurnout()]);
    try { census = await loadCensusProfiles(); } catch (_) { census = null; }
    pg.records = buildRecords(geojson.features || [], census, turnout);
    pg.available = availableMetricIds(pg.records);
    // keep only available columns; ensure at least the defaults that exist
    pg.columns = pg.columns.filter((id) => pg.available.has(id));
    if (!pg.columns.length) pg.columns = DEFAULT_COLUMNS.filter((id) => pg.available.has(id));
    if (!pg.available.has(pg.sortKey)) pg.sortKey = pg.available.has("demShare") ? "demShare" : pg.columns[0] || "population";
    if (!pg.columns.includes(pg.sortKey)) pg.columns.unshift(pg.sortKey);
    if (pg.view !== "summary" && pg.view !== "all" && !METRIC_CATEGORIES.some((c) => c.id === pg.view)) pg.view = "summary";
    populateMetricSelects();
    renderViewTabs();
    renderColumnsPicker();
    // Reflect any URL-restored party + filter conditions before first paint.
    pg.conditions = pg.conditions.filter((c) => pg.available.has(c.key));
    $("ex-party").value = pg.party;
    renderChips();
    render();
  } catch (err) {
    console.error("[Explore] load failed:", err);
    $("ex-body").innerHTML = '<tr><td class="empty-note">We couldn’t load the precinct data. Check your internet connection, then <button type="button" class="retry-link" onclick="location.reload()">try again</button>.</td></tr>';
  }
}

// ---- metric dropdowns (sort + filter) ---------------------------------------
function metricOptgroups(filterFn) {
  return METRIC_CATEGORIES.map((cat) => {
    const opts = METRICS.filter((m) => m.cat === cat.id && pg.available.has(m.id) && filterFn(m));
    if (!opts.length) return "";
    return `<optgroup label="${escapeHtml(cat.label)}">` +
      opts.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("") + "</optgroup>";
  }).join("");
}

function populateMetricSelects() {
  $("ex-sort").innerHTML = metricOptgroups(() => true);
  $("ex-sort").value = pg.sortKey;
  // filter metric: numeric only (winner is handled by the party control)
  $("ex-fmetric").innerHTML = metricOptgroups((m) => m.fmt !== "text");
  applyDirLabel();
}

// ---- columns picker ---------------------------------------------------------
function renderColumnsPicker() {
  const html = METRIC_CATEGORIES.map((cat) => {
    const ms = METRICS.filter((m) => m.cat === cat.id && pg.available.has(m.id));
    if (!ms.length) return "";
    return `<div class="cols-group-title">${escapeHtml(cat.label)}</div><div class="cols-grid">` +
      ms.map((m) => `<label class="col-check"><input type="checkbox" data-col="${m.id}" ${pg.columns.includes(m.id) ? "checked" : ""}/> ${escapeHtml(m.label)}</label>`).join("") +
      `</div>`;
  }).join("");
  $("ex-cols").innerHTML = html;
  $("ex-cols").querySelectorAll("input[data-col]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.col;
      if (cb.checked) { if (!pg.columns.includes(id)) pg.columns.push(id); }
      else pg.columns = pg.columns.filter((c) => c !== id);
      render();
    });
  });
}

// ---- flat view tabs: Summary · one tab per topic · All columns --------------
function renderViewTabs() {
  const cats = METRIC_CATEGORIES.filter((cat) => METRICS.some((m) => m.cat === cat.id && pg.available.has(m.id)));
  const tab = (id, label) =>
    `<button type="button" data-view="${escapeHtml(id)}" aria-pressed="${String(pg.view === id)}">${escapeHtml(label)}</button>`;
  $("ex-views").innerHTML =
    tab("summary", "Summary") +
    cats.map((c) => tab(c.id, c.label)).join("") +
    tab("all", "All columns (spreadsheet)");
  $("ex-views").querySelectorAll("button[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      pg.view = b.dataset.view;
      updateURL();
      renderViewTabs();
      render();
    });
  });
  // the checkbox column picker only applies to the full spreadsheet
  document.querySelector("details.cols").style.display = pg.view === "all" ? "" : "none";
}

// Which columns the active view shows. The sorted metric always stays visible.
function displayColumns() {
  let cols;
  if (pg.view === "summary") cols = SUMMARY_COLUMNS.filter((id) => pg.available.has(id));
  else if (pg.view === "all") cols = pg.columns.slice();
  else cols = METRICS.filter((m) => m.cat === pg.view && pg.available.has(m.id)).map((m) => m.id);
  if (!cols.length) cols = DEFAULT_COLUMNS.filter((id) => pg.available.has(id));
  if (!cols.includes(pg.sortKey) && pg.available.has(pg.sortKey)) cols.push(pg.sortKey);
  return cols;
}

// ---- render table (via ui/dataTable — the one column-model renderer) --------
// flag near-empty precincts; artifacts (census suppressed) get a sharper note
function electorateOf(r) {
  return r.registered != null ? r.registered : r.votes;
}
function isTiny(r) {
  const elect = electorateOf(r);
  return elect != null && elect < TINY_ELECTORATE;
}
function tinyFlagHTML(r) {
  const elect = electorateOf(r);
  let msg = null;
  if (r.artifact) {
    msg = `Non-residential sliver — ${elect} registered voters. Its census population figure was unreliable and is hidden; the voter counts are the only real data.`;
  } else if (isTiny(r)) {
    msg = `Only ${elect} registered voter${elect === 1 ? "" : "s"} — a very small precinct, so the percentages are noisy.`;
  }
  return msg ? ` <span class="tiny-flag" role="img" tabindex="0" aria-label="${msg}" title="${msg}">⚠</span>` : "";
}

// dataTable column model for the current view: the sticky precinct-link column
// plus one column per visible metric.
function tableColumns(cols) {
  const precinctCol = {
    id: "precinct",
    label: "Precinct",
    headerClass: "pcell-precinct",
    sortable: false,
    cellHTML: (r) =>
      `<td class="pcell-precinct"><a href="precinct.html#precinct=${encodeURIComponent(r.precinct)}">${escapeHtml(r.precinct)}</a>${tinyFlagHTML(r)}</td>`,
  };
  const metricCols = cols.map((id) => {
    const m = getMetric(id);
    const label = m ? m.label : id;
    if (id === "winner") {
      return {
        id,
        label,
        cellHTML: (r) =>
          r.winner ? `<td><span class="lean-tag lean-${escapeHtml(r.winner)}">${escapeHtml(r.winner)}</span></td>` : `<td>—</td>`,
      };
    }
    return { id, label, cellClass: "num", format: (v) => formatValue(v, m ? m.fmt : "num") };
  });
  return [precinctCol, ...metricCols];
}

function render() {
  const filtered = filterRecords(pg.records, { party: pg.party, conditions: pg.conditions });
  const sorted = sortRecords(filtered, pg.sortKey, pg.sortDir);

  renderDataTable({
    head: $("ex-head"),
    body: $("ex-body"),
    columns: tableColumns(displayColumns()),
    rows: sorted,
    sort: { key: pg.sortKey, dir: pg.sortDir },
    onSort: setSort,
    rowAttrs: (r) => ({
      class: [isTiny(r) || r.artifact ? "tiny-row" : "", pg.highlight && String(r.precinct) === pg.highlight ? "row-highlight" : ""].filter(Boolean).join(" "),
    }),
    emptyMessage: "No precincts match these filters.",
  });
  $("ex-count").textContent = `Showing ${sorted.length} of ${pg.records.length} precincts`;
  // A #precinct= deep link (from the Map readout) scrolls its row into view once.
  if (pg.highlight && !pg.highlightShown) {
    const row = $("ex-body").querySelector(".row-highlight");
    if (row) {
      row.scrollIntoView({ block: "center" });
      pg.highlightShown = true;
    }
  }
}

function setSort(key) {
  if (pg.sortKey === key) pg.sortDir = pg.sortDir === "desc" ? "asc" : "desc";
  else { pg.sortKey = key; pg.sortDir = "desc"; }
  if (!pg.columns.includes(key)) pg.columns.push(key);
  $("ex-sort").value = pg.sortKey;
  applyDirLabel();
  renderColumnsPicker();
  updateURL();
  render();
}

function applyDirLabel() {
  $("ex-dir").textContent = pg.sortDir === "desc" ? "High → low" : "Low → high";
}

// ---- filters ----------------------------------------------------------------
function renderChips() {
  const partyChip = pg.party !== "all"
    ? `<span class="fchip">Party: ${escapeHtml(pg.party)} <button data-clear="party" aria-label="remove">×</button></span>` : "";
  const condChips = pg.conditions.map((c, i) => {
    const m = getMetric(c.key);
    const op = c.op === "gte" ? "≥" : "≤";
    return `<span class="fchip">${escapeHtml(m ? m.label : c.key)} ${op} ${escapeHtml(formatValue(c.value, m ? m.fmt : "num"))} <button data-cond="${i}" aria-label="remove">×</button></span>`;
  }).join("");
  $("ex-chips").innerHTML = partyChip + condChips;
  $("ex-chips").querySelectorAll("button[data-cond]").forEach((b) =>
    b.addEventListener("click", () => { pg.conditions.splice(+b.dataset.cond, 1); renderChips(); updateURL(); render(); }));
  const pc = $("ex-chips").querySelector("button[data-clear='party']");
  if (pc) pc.addEventListener("click", () => { pg.party = "all"; $("ex-party").value = "all"; renderChips(); updateURL(); render(); });
}

// ---- URL sync — via the one urlState vocabulary (§5.3) -----------------------
// Party + stacked filter conditions are encoded too, so a filtered Data Table
// view is a shareable/bookmarkable link (parity with the campaign dashboard).
// Conditions serialize as `key:op:value` tokens joined by commas.
function encodeConditions(conds) {
  return conds.map((c) => `${c.key}:${c.op}:${c.value}`).join(",");
}
function decodeConditions(str) {
  return String(str)
    .split(",")
    .map((tok) => {
      const [key, op, value] = tok.split(":");
      if (!getMetric(key) || (op !== "gte" && op !== "lte") || value === "" || isNaN(+value)) return null;
      return { key, op, value: +value };
    })
    .filter(Boolean);
}
function updateURL() {
  writeParams({
    view: pg.view,
    sort: pg.sortKey,
    dir: pg.sortDir,
    party: pg.party !== "all" ? pg.party : null,
    filters: pg.conditions.length ? encodeConditions(pg.conditions) : null,
  });
}
function readURL() {
  const params = readParams();
  // Legacy `county=` is read-tolerated and ignored — old links must not crash.
  if (params.precinct) pg.highlight = String(params.precinct); // row highlight (from the Map readout)
  if (params.view) pg.view = params.view;
  if (params.sort && getMetric(params.sort)) pg.sortKey = params.sort;
  if (params.dir === "asc" || params.dir === "desc") pg.sortDir = params.dir;
  if (params.party) pg.party = params.party;
  if (params.filters) pg.conditions = decodeConditions(params.filters);
}

// ---- boot -------------------------------------------------------------------
async function init() {
  readURL();
  $("ex-sort").addEventListener("change", (e) => { pg.sortKey = e.target.value; if (!pg.columns.includes(pg.sortKey)) pg.columns.push(pg.sortKey); renderColumnsPicker(); updateURL(); render(); });
  $("ex-dir").addEventListener("click", () => { pg.sortDir = pg.sortDir === "desc" ? "asc" : "desc"; applyDirLabel(); updateURL(); render(); });
  $("ex-party").addEventListener("change", (e) => { pg.party = e.target.value; renderChips(); updateURL(); render(); });
  $("ex-addfilter").addEventListener("click", () => {
    const key = $("ex-fmetric").value;
    const op = $("ex-fop").value;
    const raw = $("ex-fval").value;
    if (key && raw !== "" && !isNaN(+raw)) {
      const m = getMetric(key);
      // pct metrics are stored 0..1 — accept a percent in the box (e.g. 50 → .5)
      const value = m && m.fmt === "pct" ? +raw / 100 : +raw;
      pg.conditions.push({ key, op, value });
      $("ex-fval").value = "";
      renderChips();
      updateURL();
      render();
    }
  });
  await loadData();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
