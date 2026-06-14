// explorePage.js
// --------------------------------------------------------------------------------
// Orchestrator for explore.html — a sortable, filterable table of every precinct
// across every data dimension we have (politics, race, age, income, families,
// housing, education, commute, turnout). Pure data + metric logic lives in
// precinctMetrics.js. Must not import js/app/* modules.

import {
  loadCountyRegistry,
  setActiveCounty,
  setActiveBoundary,
  loadAllData,
  getBoundaryConfigs,
  getActiveBoundary,
} from "./dataLoader.js";
import { loadCensusProfiles } from "./precinctProfile.js";
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
import { escapeHtml } from "./utils.js";

const DEFAULT_COLUMNS = ["winner", "demShare", "registered", "population", "medianIncome", "medianHomeValue", "medianAge", "pctFamily", "nonWhite", "turnoutRate"];

// Electorates this small make every percentage noise (e.g. "100% Dem" off 2
// voters) — flag the row so the real counts, not the %s, carry the meaning.
const TINY_ELECTORATE = 10;

const pg = {
  county: "collin",
  boundary: "original",   // "original" (2024) ⇄ "2026" where available
  sortKey: "medianIncome",
  sortDir: "desc",
  party: "all",
  conditions: [],
  columns: DEFAULT_COLUMNS.slice(),
  records: [],
  available: new Set(),
};

const $ = (id) => document.getElementById(id);

// ---- county selector (mirrors the other standalone pages) -------------------
async function initCountySelect() {
  const registry = await loadCountyRegistry();
  const sel = $("ex-county");
  const counties = registry.filter((c) => c.kind !== "district" && c.status === "live" && c.fips);
  const districts = registry.filter((c) => c.kind === "district" && c.status === "live");
  let html = counties.map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join("");
  const groups = {};
  for (const d of districts) (groups[d.group || "Districts"] ||= []).push(d);
  for (const [label, items] of Object.entries(groups)) {
    html += `<optgroup label="${escapeHtml(label)}">` +
      items.map((d) => `<option value="${escapeHtml(d.slug)}">${escapeHtml(d.name)}</option>`).join("") + "</optgroup>";
  }
  sel.innerHTML = html;
  sel.value = pg.county;
  if (sel.value !== pg.county) pg.county = sel.value;
  sel.addEventListener("change", () => { pg.county = sel.value; updateURL(); loadCounty(); });
}

// Show the 2024⇄2026 boundary toggle only when the county offers >1 set.
function renderBoundaryToggle(configs) {
  const wrap = $("ex-boundary-wrap");
  const sel = $("ex-boundary");
  const ids = Object.keys(configs);
  if (ids.length < 2) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  sel.innerHTML = ids.map((id) => `<option value="${id}">${escapeHtml(configs[id].label || id)}</option>`).join("");
  sel.value = pg.boundary;
}

// ---- marquee turnout: highest-turnout election on file ----------------------
async function loadMarqueeTurnout() {
  try {
    const cfg = getBoundaryConfigs()[getActiveBoundary()];
    if (!cfg) return null;
    const manifest = await fetch(`${cfg.dataDir}/elections.json`).then((r) => (r.ok ? r.json() : null));
    const files = [...new Set((manifest?.elections || []).map((e) => e.turnoutFile).filter(Boolean))];
    if (!files.length) return null;
    let best = null, bestBallots = -1;
    for (const f of files) {
      try {
        const rows = await d3.csv(`${cfg.dataDir}/${f}`, (d) => ({ precinct: d.precinct, registered: +d.registered, ballots: +d.ballots_cast }));
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

// ---- load a county ----------------------------------------------------------
async function loadCounty() {
  $("ex-body").innerHTML = '<tr><td class="empty-note">Loading…</td></tr>';
  try {
    await setActiveCounty(pg.county);
    // Boundary set (e.g. Collin's 2024 vs 2026 precincts). setActiveCounty reset
    // it to the county default; keep the user's pick if this county offers it.
    const configs = getBoundaryConfigs();
    const bids = Object.keys(configs);
    if (!bids.includes(pg.boundary)) pg.boundary = getActiveBoundary();
    setActiveBoundary(pg.boundary);
    renderBoundaryToggle(configs);
    $("ex-boundary-note").style.display = pg.boundary === "2026" ? "" : "none";
    let census = null;
    const [{ geojson }, turnout] = await Promise.all([loadAllData(), loadMarqueeTurnout()]);
    try { census = await loadCensusProfiles(); } catch (_) { census = null; }
    pg.records = buildRecords(geojson.features || [], census, turnout);
    pg.available = availableMetricIds(pg.records);
    // keep only available columns; ensure at least the defaults that exist
    pg.columns = pg.columns.filter((id) => pg.available.has(id));
    if (!pg.columns.length) pg.columns = DEFAULT_COLUMNS.filter((id) => pg.available.has(id));
    if (!pg.available.has(pg.sortKey)) pg.sortKey = pg.available.has("demShare") ? "demShare" : pg.columns[0] || "population";
    if (!pg.columns.includes(pg.sortKey)) pg.columns.unshift(pg.sortKey);
    populateMetricSelects();
    renderColumnsPicker();
    render();
  } catch (err) {
    console.error("[Explore] load failed:", err);
    $("ex-body").innerHTML = '<tr><td class="empty-note">Could not load this county’s data.</td></tr>';
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
  $("ex-dir").textContent = pg.sortDir === "desc" ? "↓" : "↑";
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

// ---- render table -----------------------------------------------------------
function render() {
  const filtered = filterRecords(pg.records, { party: pg.party, conditions: pg.conditions });
  const sorted = sortRecords(filtered, pg.sortKey, pg.sortDir);

  // header
  const arrow = pg.sortDir === "desc" ? " ↓" : " ↑";
  let head = `<th class="pcell-precinct" data-col="precinct">Precinct</th>`;
  head += pg.columns.map((id) => {
    const m = getMetric(id);
    const isSorted = id === pg.sortKey;
    return `<th data-col="${id}" class="${isSorted ? "sorted" : ""}">${escapeHtml(m ? m.label : id)}${isSorted ? arrow : ""}</th>`;
  }).join("");
  $("ex-head").innerHTML = head;
  $("ex-head").querySelectorAll("th[data-col]").forEach((th) => {
    if (th.dataset.col === "precinct") return;
    th.addEventListener("click", () => setSort(th.dataset.col));
  });

  // body
  if (!sorted.length) {
    $("ex-body").innerHTML = '<tr><td class="empty-note" colspan="' + (pg.columns.length + 1) + '">No precincts match these filters.</td></tr>';
  } else {
    const cParam = encodeURIComponent(pg.county);
    $("ex-body").innerHTML = sorted.map((r) => {
      const cells = pg.columns.map((id) => {
        const m = getMetric(id);
        const v = r[id];
        if (id === "winner") {
          return v ? `<td><span class="lean-tag lean-${escapeHtml(v)}">${escapeHtml(v)}</span></td>` : `<td>—</td>`;
        }
        return `<td class="num">${escapeHtml(formatValue(v, m ? m.fmt : "num"))}</td>`;
      }).join("");
      // tiny-electorate flag: real registered voters (fallback to modeled) < 10
      const elect = r.registered != null ? r.registered : r.votes;
      const tiny = elect != null && elect < TINY_ELECTORATE;
      const flag = tiny ? ` <span class="tiny-flag" title="Only ${elect} voter${elect === 1 ? "" : "s"} on file — the percentages here are not statistically meaningful">⚠</span>` : "";
      return `<tr class="${tiny ? "tiny-row" : ""}"><td class="pcell-precinct"><a href="precinct.html#county=${cParam}&precinct=${encodeURIComponent(r.precinct)}">${escapeHtml(r.precinct)}</a>${flag}</td>${cells}</tr>`;
    }).join("");
  }
  $("ex-count").textContent = `Showing ${sorted.length} of ${pg.records.length} precincts`;
}

function setSort(key) {
  if (pg.sortKey === key) pg.sortDir = pg.sortDir === "desc" ? "asc" : "desc";
  else { pg.sortKey = key; pg.sortDir = "desc"; }
  if (!pg.columns.includes(key)) pg.columns.push(key);
  $("ex-sort").value = pg.sortKey;
  $("ex-dir").textContent = pg.sortDir === "desc" ? "↓" : "↑";
  renderColumnsPicker();
  updateURL();
  render();
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
    b.addEventListener("click", () => { pg.conditions.splice(+b.dataset.cond, 1); renderChips(); render(); }));
  const pc = $("ex-chips").querySelector("button[data-clear='party']");
  if (pc) pc.addEventListener("click", () => { pg.party = "all"; $("ex-party").value = "all"; renderChips(); render(); });
}

// ---- URL sync ---------------------------------------------------------------
function updateURL() {
  history.replaceState(null, "", `#county=${encodeURIComponent(pg.county)}&boundary=${encodeURIComponent(pg.boundary)}&sort=${encodeURIComponent(pg.sortKey)}&dir=${pg.sortDir}`);
}
function readURL() {
  const params = {};
  for (const part of window.location.hash.slice(1).split("&")) {
    const [k, v] = part.split("=");
    if (k && v) params[k] = decodeURIComponent(v);
  }
  if (params.county) pg.county = params.county;
  if (params.boundary) pg.boundary = params.boundary;
  if (params.sort && getMetric(params.sort)) pg.sortKey = params.sort;
  if (params.dir === "asc" || params.dir === "desc") pg.sortDir = params.dir;
}

// ---- boot -------------------------------------------------------------------
async function init() {
  readURL();
  $("ex-sort").addEventListener("change", (e) => { pg.sortKey = e.target.value; if (!pg.columns.includes(pg.sortKey)) pg.columns.push(pg.sortKey); renderColumnsPicker(); updateURL(); render(); });
  $("ex-dir").addEventListener("click", () => { pg.sortDir = pg.sortDir === "desc" ? "asc" : "desc"; $("ex-dir").textContent = pg.sortDir === "desc" ? "↓" : "↑"; updateURL(); render(); });
  $("ex-party").addEventListener("change", (e) => { pg.party = e.target.value; renderChips(); render(); });
  $("ex-boundary").addEventListener("change", (e) => { pg.boundary = e.target.value; updateURL(); loadCounty(); });
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
      render();
    }
  });
  await initCountySelect();
  $("ex-county").value = pg.county;
  if ($("ex-county").value !== pg.county) pg.county = $("ex-county").value;
  await loadCounty();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
