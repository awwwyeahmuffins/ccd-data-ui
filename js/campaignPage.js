// campaignPage.js
// --------------------------------------------------------------------------------
// Orchestrator for campaign.html — the Campaign ("Detailed View") dashboard for
// campaign managers and data directors: stackable range filters (margin,
// cross-election turnout drop-off, % non-white), district roll-ups (State
// House / Senate / Congressional / County Commissioner), a multi-sort pinned
// table with win numbers and persuasion-vs-turnout classifications, and a
// VAN-ready CSV export of the filtered target list.
//
// Performance contract (the vanilla answer to "useMemo"): every control
// change funnels into ONE derive() that recomputes the filtered/sorted rows
// and the passing-precinct Set; the table renders from it and the map only
// RESTYLES from it (the Leaflet layer is built exactly once — never rebuilt).
// Sliders are debounced so drag storms cost one derive per settle.

import { boundary } from "./data/dataService.js";
import { TURNOUT_BASELINES, DEFAULT_WIN_BASELINE } from "./data/catalog.js";
import { ROLLUP_KINDS, districtOfFeature } from "./data/districts.js";
import { buildRecords, filterRecords } from "./precinctMetrics.js";
import {
  buildCampaignRows,
  aggregateByDistrict,
  sortRowsMulti,
  buildTargetCSV,
  median,
} from "./domain/campaign.js";
import { escapeHtml, debounce } from "./lib/dom.js";
import { downloadFile } from "./lib/download.js";
import { readParams, writeParams } from "./lib/urlState.js";
import { renderDataTable } from "./ui/dataTable.js";
import {
  createMapView,
  fitToLayer,
  decoratePrecinctPaths,
  wirePrecinctKeyboard,
  updatePrecinctLabels,
} from "./map/mapView.js";
import { fillFor, MAP_COSMETICS } from "./map/mapStyles.js";
import { legendHTML } from "./map/legend.js";
import { describePrecinct } from "./map/mapBins.js";

// The stackable range filters. Fractional filters use STEP; `data:true` widens a
// filter's bounds to the data's actual range at load (computeDataBounds) so
// narrowing is never lossy. `count:true` marks an integer-count filter (its own
// step + plain-number formatting + a 0 floor) — Net Vote Opportunity is a count,
// not a share, so it can't share the fractional slider defaults.
const FILTERS = [
  { id: "margin", key: "margin", label: "Partisan margin", lo: 0, hi: 1 },
  { id: "drop", key: "turnoutDropoff", label: "Turnout drop-off (2024 → 2022)", lo: -0.5, hi: 0.75, data: true },
  { id: "nvo", key: "nvo", label: "Net vote opportunity (untapped supporters)", lo: 0, hi: 1000, data: true, count: true, step: 10 },
  { id: "nw", key: "nonWhite", label: "Non-white population share", lo: 0, hi: 1 },
  { id: "canvass", key: "canvassShare", label: "Canvass coverage (Dem)", lo: 0, hi: 1 },
];
const STEP = 0.01;

// Same tiny-electorate threshold as explore: percentages off <50 voters are noise.
const TINY_ELECTORATE = 50;

const DEFAULT_SORTS = [{ key: "winNumber", dir: "desc" }];

const camp = {
  party: "Dem",
  base: DEFAULT_WIN_BASELINE, // "2022" | "2024" (TURNOUT_BASELINES key)
  rollup: "",                 // "" | "hd" | "sd" | "cd" | "comm"
  sorts: DEFAULT_SORTS.slice(),
  filters: {},                // id -> [lo, hi] (current slider values)
  bounds: {},                 // id -> [lo, hi] (full range; filter active only when narrowed)
  records: [],                // precinctMetrics records
  rows: [],                   // campaign rows (records + win number/dropoff/classification)
  canvass: null,              // code -> {demVoters, share, canvassed} (optional profile extra)
  raw: {},                    // code -> {rep,mod,dem,white,total} for roll-up sums
  memberOf: {},               // kind -> { code: districtKey }
  labels: {},                 // kind -> { districtKey: label }
  aggCache: new Map(),        // `${kind}|${party}|${base}` -> district rows
  derived: null,              // { rows, passSet, total, missing }
  t2024: null,
  t2022: null,
  medianRate: null,
  highlight: null,            // row key to highlight (map → table sync)
  mapView: null,
  map: null,
  layer: null,
  kb: [],
  labelLayer: null,
};

const $ = (id) => document.getElementById(id);
const svc = boundary(); // pinned to the 2026 set, like every page

const useCanvas = new URLSearchParams(location.search).get("renderer") === "canvas";

// ---- formatters ---------------------------------------------------------------
const fmtNum = (v) => (v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString());
const fmtPct = (v) => (v == null || isNaN(v) ? "—" : `${Math.round(v * 100)}%`);
const fmtSignedPct = (v) =>
  v == null || isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;

// =============================================================================
// DATA LOAD (once)
// =============================================================================
async function loadData() {
  const [{ geojson }, census, t2024, t2022, canvass] = await Promise.all([
    svc.loadAll(),
    svc.loadCensusProfiles().catch(() => null),
    svc.loadTurnoutLookup(TURNOUT_BASELINES["2024"].file),
    svc.loadTurnoutLookup(TURNOUT_BASELINES["2022"].file),
    svc.loadCanvass().catch(() => null),
  ]);
  const features = geojson.features || [];
  camp.t2024 = t2024;
  camp.t2022 = t2022;
  camp.canvass = canvass;
  // Records keyed off the 2024 general (registered voters, turnout rate).
  camp.records = buildRecords(features, census, t2024);

  // Raw summable counts for district roll-ups, straight off the merged props.
  for (const f of features) {
    const p = f.properties;
    camp.raw[String(p.PRECINCT)] = { rep: p.rep, mod: p.mod, dem: p.dem, white: p.white, total: p.total };
  }

  // District membership + labels for every roll-up kind, from the GeoJSON props.
  for (const kind of ROLLUP_KINDS) {
    const memberOf = {};
    const labels = {};
    for (const f of features) {
      const key = districtOfFeature(f, kind.id);
      if (!key) continue;
      memberOf[String(f.properties.PRECINCT)] = key;
      if (!labels[key]) labels[key] = `${kind.prefix} ${key.split("-")[1]}`;
    }
    camp.memberOf[kind.id] = memberOf;
    camp.labels[kind.id] = labels;
  }

  rebuildRows();
  return features;
}

// Campaign rows depend on party + baseline; everything downstream (roll-up
// cache, county median rate) resets with them.
function rebuildRows() {
  const tBase = camp.base === "2024" ? camp.t2024 : camp.t2022;
  camp.rows = buildCampaignRows(camp.records, camp.raw, {
    t2024: camp.t2024,
    t2022: camp.t2022,
    tBase,
    party: camp.party,
    canvass: camp.canvass,
  });
  camp.medianRate = median(camp.rows.map((r) => r.rate2024));
  camp.aggCache.clear();
}

// Widen every data-derived filter (drop-off, NVO) to the data's real range
// (rounded out to that filter's step); count filters keep a 0 floor. Then seed
// bounds + initial filter values for ALL specs.
function computeDropBounds() {
  for (const spec of FILTERS) {
    if (spec.data) {
      const step = spec.step || STEP;
      const vals = camp.rows.map((r) => r[spec.key]).filter((v) => v != null && !isNaN(v));
      if (vals.length) {
        spec.lo = spec.count ? 0 : Math.floor(Math.min(...vals) / step) * step;
        spec.hi = Math.ceil(Math.max(...vals) / step) * step;
      }
    }
    camp.bounds[spec.id] = [spec.lo, spec.hi];
    if (!camp.filters[spec.id]) camp.filters[spec.id] = [spec.lo, spec.hi];
  }
}

// =============================================================================
// DERIVED STATE — the one recompute per change
// =============================================================================

// A slider contributes a condition only when narrowed from its full range, so
// precincts missing that datum are excluded only when the user opts in
// (filterRecords drops null-valued rows per condition key — never fabricate).
function activeConditions() {
  const conds = [];
  for (const spec of FILTERS) {
    const [lo, hi] = camp.filters[spec.id];
    const [blo, bhi] = camp.bounds[spec.id];
    if (lo > blo + 1e-9) conds.push({ key: spec.key, op: "gte", value: lo });
    if (hi < bhi - 1e-9) conds.push({ key: spec.key, op: "lte", value: hi });
  }
  return conds;
}

function countMissing(rows, conditions) {
  if (!conditions.length) return 0;
  const keys = [...new Set(conditions.map((c) => c.key))];
  return rows.filter((r) => keys.some((k) => r[k] == null)).length;
}

function districtRows() {
  const key = `${camp.rollup}|${camp.party}|${camp.base}`;
  if (!camp.aggCache.has(key)) {
    camp.aggCache.set(
      key,
      aggregateByDistrict(camp.rows, camp.memberOf[camp.rollup], camp.labels[camp.rollup], {
        party: camp.party,
        medianRate: camp.medianRate,
      })
    );
  }
  return camp.aggCache.get(key);
}

function derive() {
  const conditions = activeConditions();
  if (camp.rollup) {
    const all = districtRows();
    const rows = sortRowsMulti(filterRecords(all, { conditions }), camp.sorts);
    const passSet = new Set();
    for (const d of rows) for (const c of d.memberCodes) passSet.add(c);
    camp.derived = { rows, passSet, total: all.length, missing: countMissing(all, conditions) };
  } else {
    const rows = sortRowsMulti(filterRecords(camp.rows, { conditions }), camp.sorts);
    camp.derived = {
      rows,
      passSet: new Set(rows.map((r) => r.precinct)),
      total: camp.rows.length,
      missing: countMissing(camp.rows, conditions),
    };
  }
}

// =============================================================================
// MAP — built once; filter changes only restyle
// =============================================================================
function styleEnv() {
  return { svg: camp.mapView ? camp.mapView.svgRoot() : null, mode: "lean", raceId: null, race: null, primary: null };
}

function passes(code) {
  return !camp.derived || camp.derived.passSet.has(code);
}

function baseStyle(feature) {
  const code = String(feature.properties.PRECINCT);
  if (passes(code)) {
    return {
      fillColor: fillFor(feature.properties, styleEnv()),
      fillOpacity: 0.74,
      color: MAP_COSMETICS.stroke,
      weight: 0.7,
      opacity: 1,
    };
  }
  // Filtered out: dimmed flat gray (the off-ballot dim precedent, softer).
  return { fillColor: MAP_COSMETICS.noData, fillOpacity: 0.35, color: MAP_COSMETICS.stroke, weight: 0.7, opacity: 1 };
}

function describeFeature(props) {
  const base = describePrecinct(props, { mode: "lean" });
  return passes(String(props.PRECINCT)) ? base : `${base} · filtered out`;
}

function restyle() {
  if (!camp.layer) return;
  camp.layer.eachLayer((l) => {
    l.setStyle(baseStyle(l.feature));
    if (l._path) l._path.setAttribute("aria-label", describeFeature(l.feature.properties));
  });
}

function buildMap(features) {
  camp.mapView = createMapView({ containerId: "cp-map", useCanvas });
  camp.map = camp.mapView.map;
  camp.layer = L.geoJSON({ type: "FeatureCollection", features }, {
    style: baseStyle,
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: () => layer.setStyle({ weight: 2.2, color: MAP_COSMETICS.hover }),
        mouseout: () => layer.setStyle(baseStyle(feature)),
        click: () => highlightFromMap(String(feature.properties.PRECINCT)),
      });
    },
  }).addTo(camp.map);

  // Fit FIRST: the overlay SVG that hosts the pattern <defs> exists only after
  // the map has a view — then restyle into patterns (js/pages/map.js precedent).
  fitToLayer(camp.map, camp.layer);
  restyle();
  camp.kb = decoratePrecinctPaths(camp.layer, { useCanvas, describe: describeFeature });
  wirePrecinctKeyboard($("cp-map"), {
    useCanvas,
    getKb: () => camp.kb,
    onPick: highlightFromMap,
  });
  camp.map.on("zoomend", () => {
    camp.labelLayer = updatePrecinctLabels(camp.map, camp.layer, camp.labelLayer);
  });
  renderLegend();
}

function renderLegend() {
  $("cp-legend").innerHTML =
    legendHTML(styleEnv()) +
    `<div class="cc-legend-row"><span class="cp-sw-dim" aria-hidden="true"></span><span>Filtered out by your filters</span></div>`;
}

// Map → table sync: clicking (or keyboard-picking) a precinct highlights its
// row — its district's row in roll-up mode — and scrolls it into view.
function highlightFromMap(code) {
  camp.highlight = camp.rollup ? camp.memberOf[camp.rollup][code] || null : code;
  renderTable();
  const row = $("cp-body").querySelector(".row-highlight");
  if (row) row.scrollIntoView({ block: "nearest" });
}

// =============================================================================
// TABLE
// =============================================================================
function classificationCell(r) {
  return r.classification
    ? `<td><span class="cls-tag cls-${escapeHtml(r.classification)}">${escapeHtml(r.classification)}</span></td>`
    : "<td>—</td>";
}

function tableColumns() {
  const first = camp.rollup
    ? {
        id: "label",
        label: (ROLLUP_KINDS.find((k) => k.id === camp.rollup) || {}).label || "District",
        pinned: true,
        headerClass: "pcell-precinct",
        // Compact key fits the pinned cell; the full label rides the title attr.
        cellHTML: (r) =>
          `<td class="pcell-precinct pin-col pin-col-0" title="${escapeHtml(r.label)}"><strong>${escapeHtml(r.precinct.toUpperCase())}</strong> <span class="cp-members">· ${r.memberCodes.length} pcts</span></td>`,
      }
    : {
        id: "precinct",
        label: "Precinct",
        pinned: true,
        headerClass: "pcell-precinct",
        cellHTML: (r) =>
          `<td class="pcell-precinct pin-col pin-col-0"><a href="precinct.html#precinct=${encodeURIComponent(r.precinct)}">${escapeHtml(r.precinct)}</a></td>`,
      };
  return [
    first,
    { id: "winNumber", label: "Win number", pinned: true, cellClass: "num", format: fmtNum },
    { id: "voteGap", label: "Vote gap", cellClass: "num", format: fmtNum },
    { id: "nvo", label: "Net vote opp.", cellClass: "num", format: fmtNum },
    { id: "classification", label: "Play", cellHTML: classificationCell },
    { id: "signedMargin", label: "Margin", cellClass: "num", format: fmtSignedPct },
    { id: "turnoutDropoff", label: "Drop-off", cellClass: "num", format: fmtSignedPct },
    { id: "nonWhite", label: "Non-white", cellClass: "num", format: fmtPct },
    { id: "canvassShare", label: "Canvassed", cellClass: "num", format: fmtPct },
    { id: "registered", label: "Registered", cellClass: "num", format: fmtNum },
    { id: "expectedBallots", label: "Expected ballots", cellClass: "num", format: fmtNum },
    { id: "modShare", label: "Moderate share", cellClass: "num", format: fmtPct },
    { id: "turnoutRate", label: "Turnout rate", cellClass: "num", format: fmtPct },
  ];
}

// District rows reuse `precinct` for the district key, so one key rule works
// in both modes (highlightFromMap stores the district key in roll-up mode).
function rowKey(r) {
  return r.precinct;
}

function isTiny(r) {
  return !r.isDistrict && r.registered != null && r.registered < TINY_ELECTORATE;
}

function renderTable() {
  renderDataTable({
    head: $("cp-head"),
    body: $("cp-body"),
    columns: tableColumns(),
    rows: camp.derived.rows,
    sort: camp.sorts,
    onSort: setSort,
    rowAttrs: (r) => ({
      "data-code": r.precinct,
      class: [
        isTiny(r) ? "tiny-row" : "",
        camp.highlight != null && String(rowKey(r)) === String(camp.highlight) ? "row-highlight" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }),
    emptyMessage: camp.rollup
      ? "No districts match these filters."
      : "No precincts match these filters.",
  });
}

function renderCount() {
  const d = camp.derived;
  const noun = camp.rollup ? "districts" : "precincts";
  let text = `Showing ${d.rows.length} of ${d.total} ${noun}`;
  if (camp.rollup) {
    text += ` (${d.passSet.size} precincts)`;
  }
  if (d.missing > 0) {
    text += ` · ${d.missing} ${noun} lack data for an active filter and are excluded`;
  }
  $("cp-count").textContent = text;
}

// =============================================================================
// RENDER PIPELINE — one derive, then table + count + map restyle + URL
// =============================================================================
function deriveAndRender() {
  derive();
  renderTable();
  renderCount();
  restyle();
  updateURL();
}

// =============================================================================
// SORTING (multi-key: click = primary toggle, shift-click = add secondary)
// =============================================================================
function setSort(key, event) {
  const idx = camp.sorts.findIndex((s) => s.key === key);
  if (event && event.shiftKey && camp.sorts.length && idx !== 0) {
    if (idx === -1) camp.sorts = [...camp.sorts, { key, dir: "desc" }];
    else {
      const next = camp.sorts.slice();
      next[idx] = { key, dir: next[idx].dir === "desc" ? "asc" : "desc" };
      camp.sorts = next;
    }
  } else if (idx === 0) {
    camp.sorts = [{ key, dir: camp.sorts[0].dir === "desc" ? "asc" : "desc" }, ...camp.sorts.slice(1)];
    if (!(event && event.shiftKey)) camp.sorts = camp.sorts.slice(0, 1);
  } else {
    camp.sorts = [{ key, dir: "desc" }];
  }
  deriveAndRender();
}

// =============================================================================
// FILTER SLIDERS (min/max pair per filter — no native dual-thumb range exists)
// =============================================================================
function renderFilters() {
  $("cp-filters").innerHTML = FILTERS.map((spec) => {
    const [blo, bhi] = camp.bounds[spec.id];
    const [lo, hi] = camp.filters[spec.id];
    return `
      <fieldset class="frange" data-filter="${spec.id}">
        <legend>${escapeHtml(spec.label)} — <span class="fvals" id="cp-fval-${spec.id}"></span></legend>
        <div class="fpair">
          <label for="cp-${spec.id}-min">Min</label>
          <input type="range" id="cp-${spec.id}-min" min="${blo}" max="${bhi}" step="${spec.step || STEP}" value="${lo}"
                 aria-label="${escapeHtml(spec.label)} minimum" />
        </div>
        <div class="fpair">
          <label for="cp-${spec.id}-max">Max</label>
          <input type="range" id="cp-${spec.id}-max" min="${blo}" max="${bhi}" step="${spec.step || STEP}" value="${hi}"
                 aria-label="${escapeHtml(spec.label)} maximum" />
        </div>
      </fieldset>`;
  }).join("");

  const applyDebounced = debounce(deriveAndRender, 100);
  for (const spec of FILTERS) {
    const min = $(`cp-${spec.id}-min`);
    const max = $(`cp-${spec.id}-max`);
    const onInput = () => {
      let lo = +min.value;
      let hi = +max.value;
      if (lo > hi) [lo, hi] = [hi, lo]; // crossed thumbs: treat as a valid range
      camp.filters[spec.id] = [lo, hi];
      updateFilterReadout(spec); // readout is instant; derive is debounced
      applyDebounced();
    };
    min.addEventListener("input", onInput);
    max.addEventListener("input", onInput);
    updateFilterReadout(spec);
  }
}

function updateFilterReadout(spec) {
  const [lo, hi] = camp.filters[spec.id];
  const [blo, bhi] = camp.bounds[spec.id];
  const full = lo <= blo + 1e-9 && hi >= bhi - 1e-9;
  $(`cp-fval-${spec.id}`).textContent = full
    ? "any"
    : `${fmtSignedRange(spec, lo)} to ${fmtSignedRange(spec, hi)}`;
}

function fmtSignedRange(spec, v) {
  if (spec.count) return fmtNum(v);
  return spec.id === "drop" ? fmtSignedPct(v) : fmtPct(v);
}

function resetFilters() {
  for (const spec of FILTERS) camp.filters[spec.id] = camp.bounds[spec.id].slice();
  renderFilters();
  deriveAndRender();
}

// =============================================================================
// CSV EXPORT — always precinct-level (VAN joins on the bare precinct number)
// =============================================================================
function exportCSV() {
  let rows;
  let districtLabels = null;
  if (camp.rollup) {
    // Member precincts of the surviving districts, each with its OWN values.
    const memberOf = camp.memberOf[camp.rollup];
    const labels = camp.labels[camp.rollup];
    rows = camp.rows
      .filter((r) => camp.derived.passSet.has(r.precinct))
      .sort(
        (a, b) =>
          String(memberOf[a.precinct]).localeCompare(String(memberOf[b.precinct]), undefined, { numeric: true }) ||
          String(a.precinct).localeCompare(String(b.precinct), undefined, { numeric: true })
      );
    districtLabels = {};
    for (const r of rows) districtLabels[r.precinct] = labels[memberOf[r.precinct]] || memberOf[r.precinct];
  } else {
    rows = camp.derived.rows;
  }
  const csv = buildTargetCSV(rows, { districtLabels });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(csv, `collin-target-list-${stamp}.csv`, "text/csv");
}

// =============================================================================
// URL STATE (persisted + shareable, unlike explore's filters)
// =============================================================================
function rangeParam(id) {
  const [lo, hi] = camp.filters[id];
  const [blo, bhi] = camp.bounds[id];
  if (lo <= blo + 1e-9 && hi >= bhi - 1e-9) return null; // full range = default
  return `${lo}:${hi}`;
}

function updateURL() {
  writeParams({
    party: camp.party === "Dem" ? null : camp.party,
    base: camp.base === DEFAULT_WIN_BASELINE ? null : camp.base,
    rollup: camp.rollup || null,
    sort:
      camp.sorts.length === 1 &&
      camp.sorts[0].key === DEFAULT_SORTS[0].key &&
      camp.sorts[0].dir === DEFAULT_SORTS[0].dir
        ? null
        : camp.sorts.map((s) => `${s.key}:${s.dir}`).join(","),
    margin: rangeParam("margin"),
    drop: rangeParam("drop"),
    nvo: rangeParam("nvo"),
    nw: rangeParam("nw"),
    canvass: rangeParam("canvass"),
  });
}

// Read once at boot; slider values are clamped to bounds AFTER load (bounds
// depend on the data), so ranges are stashed and applied in applyURLRanges.
let pendingRanges = {};
function readURL() {
  const p = readParams();
  if (p.party === "Rep" || p.party === "Dem") camp.party = p.party;
  if (p.base && TURNOUT_BASELINES[p.base]) camp.base = p.base;
  if (p.rollup && ROLLUP_KINDS.some((k) => k.id === p.rollup)) camp.rollup = p.rollup;
  if (p.sort) {
    const sorts = p.sort
      .split(",")
      .map((part) => {
        const [key, dir] = part.split(":");
        return key && (dir === "asc" || dir === "desc") ? { key, dir } : null;
      })
      .filter(Boolean);
    if (sorts.length) camp.sorts = sorts;
  }
  for (const id of ["margin", "drop", "nvo", "nw", "canvass"]) {
    if (!p[id]) continue;
    const [lo, hi] = String(p[id]).split(":").map(Number);
    if (!isNaN(lo) && !isNaN(hi) && lo <= hi) pendingRanges[id] = [lo, hi];
  }
}

function applyURLRanges() {
  for (const [id, [lo, hi]] of Object.entries(pendingRanges)) {
    const [blo, bhi] = camp.bounds[id];
    camp.filters[id] = [Math.max(blo, lo), Math.min(bhi, hi)];
  }
  pendingRanges = {};
}

// =============================================================================
// CONTROLS + BOOT
// =============================================================================
function populateControls() {
  $("cp-party").value = camp.party;
  $("cp-base").innerHTML = Object.values(TURNOUT_BASELINES)
    .map((b) => `<option value="${b.id}">${escapeHtml(b.label)}</option>`)
    .join("");
  $("cp-base").value = camp.base;
  $("cp-rollup").innerHTML =
    `<option value="">Precincts (no grouping)</option>` +
    ROLLUP_KINDS.map((k) => `<option value="${k.id}">${escapeHtml(k.label)} districts</option>`).join("");
  $("cp-rollup").value = camp.rollup;
}

function wireControls() {
  $("cp-party").addEventListener("change", (e) => {
    camp.party = e.target.value;
    rebuildRows();
    deriveAndRender();
  });
  $("cp-base").addEventListener("change", (e) => {
    camp.base = e.target.value;
    rebuildRows();
    deriveAndRender();
  });
  $("cp-rollup").addEventListener("change", (e) => {
    camp.rollup = e.target.value;
    camp.highlight = null;
    deriveAndRender();
  });
  $("cp-reset").addEventListener("click", resetFilters);
  $("cp-export").addEventListener("click", exportCSV);
}

async function init() {
  readURL();
  populateControls();
  wireControls();
  try {
    const features = await loadData();
    computeDropBounds();
    applyURLRanges();
    renderFilters();
    derive();
    buildMap(features);
    renderTable();
    renderCount();
    updateURL();
  } catch (err) {
    console.error("[Campaign] load failed:", err);
    $("cp-body").innerHTML =
      '<tr><td class="empty-note">We couldn’t load the precinct data. Check your internet connection, then <button type="button" class="retry-link" onclick="location.reload()">try again</button>.</td></tr>';
    $("cp-count").textContent = "";
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
