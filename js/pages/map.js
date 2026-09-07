// pages/map.js
// --------------------------------------------------------------------------------
// Orchestrator for index.html — the Map page, the app's front door. A low-basemap
// civic map of precinct polygons with three analytic color modes (Lean / Margin /
// Diversity) and a data dock that briefs the whole county or one clicked precinct.
// Warm large-print "paper" design for precinct chairs 60+ on iPads.
//
// Reuses the SAME data layer as the other pages — loadAllData(), the locked party
// colors, and the county registry — so it never invents data and stays in sync.
// Sits behind the Cognito sign-in gate on deployment (bypassed on localhost / e2e).

import { boundary } from "../data/dataService.js";
import {
  DISTRICT_LIST,
  precinctsInDistrict,
  districtSlugFor,
  listDistrictRaces,
  loadDistrictAggregates,
  loadDistrictOutlines,
  loadDistrictPrecinctGeo,
} from "../data/districts.js";
import { pivotRace, computeWinners } from "../v3Pivot.js";
import { MAP_COSMETICS, PRIMARY_YEAR, fillFor, notOnBallotFill } from "../map/mapStyles.js";
import { legendHTML } from "../map/legend.js";
import {
  createMapView,
  fitToLayer,
  decoratePrecinctPaths,
  wirePrecinctKeyboard,
  updatePrecinctLabels as refreshLabelChips,
} from "../map/mapView.js";
import { PARTY_COLORS } from "../lib/constants.js";
import { ELECTION_META_KEYS, getRaceKey } from "../electionSchema.js";
import { escapeHtml } from "../lib/dom.js";
import { formatPctWhole, formatNumberOrNA } from "../lib/format.js";
import { readParams, writeParams } from "../lib/urlState.js";
import { createRacePicker } from "../ui/racePicker.js";
import { createPrecinctFinder } from "../ui/precinctFinder.js";
import { initAuth, isAuthenticated, signOut, onAuthStateChange } from "../auth.js";
import { showAuthOverlay, hideAuthOverlay } from "../authUI.js";
import { findPrecinctForAddress, findPrecinctForPoint, TEXAS_VIEWBOX } from "../geoLookup.js";
import { describePrecinct, partyName } from "../map/mapBins.js";
import { patternFill, partyKind } from "../map/mapPatterns.js";
import { buildCountyBriefing } from "../countyBriefing.js";
import { buildRows, sortRows, renderRows, countLine, SORTS } from "../listView.js";
import { termButton } from "../glossary.js";
import { rememberedPrecincts } from "../siteNav.js";

// ---- module state (this page's own; no shared singleton) --------------------
// The one data handle: Collin on the current (2026) precincts. Districts are
// a SCOPE on this map (REDESIGN §5.2), never a different data subject.
const svc = boundary();

const cc = {
  map: null,
  tiles: null,
  layer: null,
  renderer: null,        // shared vector renderer (SVG by default; see below)
  labelLayer: null,      // precinct-number chips shown at close zoom
  kb: [],                // keyboard order: precinct layers sorted by code
  view: "map",           // "map" | "list" — the List view is the linear/AT path
  listSort: "code",
  cancelListRender: null,
  otherLayer: null,      // non-Collin county outlines (shown during district races)
  otherPrecinctLayer: null, // non-Collin PRECINCT polygons (where sourced, e.g. Hunt CD-3)
  geojson: null,
  district: null,        // district scope slug (cd-3 …) or null = whole county
  districtCodes: null,   // Set of Collin precinct codes inside the scoped district
  mode: "lean",          // lean | margin | diversity | primary (demographic modes)
  selectedCode: null,
  readoutDismissed: null, // precinct code whose readout card the user ✕-closed
  primary: null,         // party-primary ballots lookup { code: { year: {dem,rep} } }, null = N/A
  countyName: "Collin",
  races: [],             // this county's race manifest (for the picker)
  raceId: null,          // active race id, or null for demographics
  race: null,            // { id, label, partisan, byPrecinct: { code: {winner,total,margin,...} } }
  loadToken: 0,          // bumped per race load; a stale load must not paint (see loadRace)
};

const tm = () => MAP_COSMETICS;

// The map renders SVG so every precinct is a real, focusable, pattern-fillable
// DOM node (canvas has none of that). `?renderer=canvas` is a perf escape
// hatch: it falls back to plain color fills automatically.
const useCanvasRenderer = new URLSearchParams(location.search).get("renderer") === "canvas";
// The overlay SVG that hosts the pattern <defs> (null on the canvas fallback).
function svgRoot() {
  return cc.mapView ? cc.mapView.svgRoot() : null;
}

// Style env handed to the extracted fill engines / legend (js/map/).
function styleEnv() {
  return { svg: svgRoot(), mode: cc.mode, raceId: cc.raceId, race: cc.race, primary: cc.primary };
}

// ---- tiny DOM helpers -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const fmtPct = formatPctWhole;
const fmtNum = formatNumberOrNA;

// Context passed to the shared describePrecinct() formatter (mapBins.js).
function describeCtx() {
  return { mode: cc.mode, race: cc.raceId ? cc.race : null, primary: cc.primary, primaryYear: PRIMARY_YEAR };
}

// A precinct is "in" the active race only if it cast candidate votes.
function inActiveRace(code) {
  if (!cc.race) return true;
  const r = cc.race.byPrecinct[String(code)];
  return !!(r && r.total > 0 && r.winner);
}

// =============================================================================
// MAP RENDERING
// =============================================================================
function baseStyle(feature) {
  const code = String(feature.properties.PRECINCT);
  const isSel = cc.selectedCode != null && code === cc.selectedCode;
  // In a race view, precincts that weren't on that ballot get a distinct light
  // cross-hatch — readable (the old 0.06-opacity ghost was invisible) and
  // clearly different from the solid no-data gray.
  const offBallot = cc.raceId && !inActiveRace(code);
  return {
    fillColor: offBallot ? notOnBallotFill(styleEnv()) : fillFor(feature.properties, styleEnv()),
    fillOpacity: offBallot ? 0.45 : 0.74,
    color: isSel ? tm().sel : tm().stroke,
    weight: isSel ? 2.8 : 0.7,
    opacity: 1,
  };
}

function restyle() {
  if (!cc.layer) return;
  cc.layer.eachLayer((l) => l.setStyle(baseStyle(l.feature)));
}

function buildMap(geojson) {
  cc.mapView = createMapView({ containerId: "cc-map", useCanvas: useCanvasRenderer });
  cc.map = cc.mapView.map;
  cc.renderer = cc.mapView.renderer;
  cc.tiles = cc.mapView.tiles;

  cc.layer = L.geoJSON(geojson, { style: baseStyle, onEachFeature: attachFeature }).addTo(cc.map);

  // Layers actually mount only once the map has a view (fitMap sets it), and
  // the SVG container that hosts the pattern <defs> exists only after that —
  // so fit FIRST, then restyle into patterns and decorate the live paths.
  fitMap();
  restyle();
  decorateMapPaths();
  wireMapKeyboard();
  renderLegend(); // re-render: the boot-time legend predates the pattern defs
  cc.map.on("zoomend", updatePrecinctLabels);
  updatePrecinctLabels();
}

// Wire hover-highlight + tap-to-select for one precinct polygon (shared by
// build & county-switch so the two render paths never drift). The per-precinct
// READOUT is tap-first (readout card + dock) — hover only outlines, because
// the primary device is an iPad where hover doesn't exist.
function attachFeature(feature, layer) {
  const code = String(feature.properties.PRECINCT);
  layer.on({
    mouseover: () => layer.setStyle({ weight: 2.2, color: tm().hover }),
    mouseout: () => layer.setStyle(baseStyle(feature)),
    click: () => selectPrecinct(code),
  });
}

// ---------------------------------------------------------------------------
// SVG accessibility layer: every precinct path is a labelled, keyboard-
// reachable button. One tab stop enters the map (roving tabindex); arrows walk
// precincts in code order; Enter/Space selects. Canvas fallback skips this
// (no DOM) — the List View remains the fully keyboard/AT path there.
// ---------------------------------------------------------------------------
function decorateMapPaths() {
  cc.kb = decoratePrecinctPaths(cc.layer, {
    useCanvas: useCanvasRenderer,
    describe: (props) => describePrecinct(props, describeCtx()),
  });
  // other layers (district views) are pointer/dock driven; still label them
  decorateOtherPaths();
}

function decorateOtherPaths() {
  // aria-label needs a role to be valid — these are labelled graphics
  // (pointer-driven; the dock and List view are the AT path for them).
  const label = (path, text) => {
    path.setAttribute("role", "img");
    path.setAttribute("aria-label", text);
  };
  if (cc.otherLayer) cc.otherLayer.eachLayer((l) => {
    if (l._path) label(l._path, describeOtherCounty(l.feature.properties));
  });
  if (cc.otherPrecinctLayer) cc.otherPrecinctLayer.eachLayer((l) => {
    if (l._path) label(l._path, describeOtherPrecinct(l.feature.properties));
  });
}

function wireMapKeyboard() {
  wirePrecinctKeyboard($("cc-map"), {
    useCanvas: useCanvasRenderer,
    getKb: () => cc.kb,
    onPick: selectPrecinct,
  });
}

function updatePrecinctLabels() {
  cc.labelLayer = refreshLabelChips(cc.map, cc.layer, cc.labelLayer);
}

function fitMap() {
  fitToLayer(cc.map, cc.layer);
}

// =============================================================================
// READOUT CARD — the tap-first replacement for hover tooltips. Selecting a
// precinct pins one plain-language sentence (the same one AT reads) on a solid
// backplate at the bottom of the map, with a big "Full details" button into
// the dock. aria-live so screen readers hear each selection.
// =============================================================================
function showReadout(text) {
  const card = $("cc-readout");
  if (!card) return;
  $("cc-readout-text").textContent = text;
  card.hidden = false;
}
function hideReadout() {
  const card = $("cc-readout");
  if (card) card.hidden = true;
}
function refreshReadout() {
  if (!cc.selectedCode || cc.readoutDismissed === cc.selectedCode) { hideReadout(); return; }
  const f = cc.geojson.features.find((x) => String(x.properties.PRECINCT) === cc.selectedCode);
  if (f) showReadout(describePrecinct(f.properties, describeCtx()));
}

// =============================================================================
// DOCK — county briefing + per-precinct detail
// =============================================================================

// The one stacked lean bar used everywhere: values as TEXT above the mark
// (party named in words — never color-alone, never white-on-tint), thin
// segments with surface gaps below.
function leanBarHTML(rep, mod, dem, { repLabel = "Republican", modLabel = "Moderate / other", demLabel = "Democratic" } = {}) {
  const vals = [
    rep > 0 ? `<span><b>${rep}%</b> ${repLabel}</span>` : "",
    mod > 0 ? `<span><b>${mod}%</b> ${modLabel}</span>` : "",
    dem > 0 ? `<span><b>${dem}%</b> ${demLabel}</span>` : "",
  ].join("");
  return `
    <div class="cc-leanbar-vals">${vals}</div>
    <div class="cc-leanbar" role="img" aria-label="${rep}% ${repLabel}, ${mod}% ${modLabel}, ${dem}% ${demLabel}">
      ${rep > 0 ? `<span class="seg-rep" style="flex:${rep}"></span>` : ""}
      ${mod > 0 ? `<span class="seg-mod" style="flex:${mod}"></span>` : ""}
      ${dem > 0 ? `<span class="seg-dem" style="flex:${dem}"></span>` : ""}
    </div>`;
}

// One single-level disclosure: the "so what" stays above, everything else
// (toolkit links, tips) waits behind one large labelled button. Never nested.
function disclosureHTML(id, label, bodyHtml) {
  return `
    <button class="cc-disclose" id="${id}" aria-expanded="false" aria-controls="${id}-body">
      <span>${label}</span><span class="cc-disclose-mark" aria-hidden="true">▾</span>
    </button>
    <div class="cc-disclose-body" id="${id}-body" hidden>${bodyHtml}</div>`;
}
function wireDisclosure(id) {
  const btn = $(id);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const body = $(`${id}-body`);
    const open = body.hidden;
    body.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.querySelector(".cc-disclose-mark").textContent = open ? "▴" : "▾";
  });
}

function renderCountyBriefing() {
  if (cc.raceId && cc.race) return renderRaceBriefing();
  const features = visibleFeatures();
  const b = buildCountyBriefing(features, { countyName: scopeName(), isDistrict: !!cc.district });

  $("cc-dock-eyebrow").textContent = cc.district ? "District Briefing" : "County Briefing";
  $("cc-dock-title").textContent = cc.district ? `${scopeName()} — Collin precincts` : `${cc.countyName} County`;
  $("cc-dock-sub").textContent = b.sub;

  const leanBlock = b.lean
    ? `<div class="cc-stat wide">
         <div class="cc-stat-label">Average precinct share</div>
         ${leanBarHTML(b.lean.rep, b.lean.mod, b.lean.dem)}
       </div>`
    : "";

  $("cc-dock-body").innerHTML = `
    <p class="cc-headline">${escapeHtml(b.headline)}</p>

    <div class="cc-stat-grid">
      ${leanBlock}
      ${b.stats
        .map(
          (s) => `
      <div class="cc-stat">
        <div class="cc-stat-label">${s.term ? termButton(s.term, escapeHtml(s.label)) : escapeHtml(s.label)}</div>
        <div class="cc-stat-value">${escapeHtml(s.value)}${s.suffix ? `<small>${escapeHtml(s.suffix)}</small>` : ""}</div>
      </div>`
        )
        .join("")}
    </div>

    <p class="cc-tip">Tap any precinct on the map for its briefing — or use the map's List view to read precincts as a list.</p>

    ${(() => {
      const mine = rememberedPrecincts()[0];
      return mine && cc.geojson.features.some((f) => String(f.properties.PRECINCT) === mine)
        ? deeplink(`precinct.html#precinct=${encodeURIComponent(mine)}`, "pin", `Your precinct: ${escapeHtml(mine)}`, "Open the full report")
        : "";
    })()}
    ${disclosureHTML(
      "cc-more-county",
      "Show more county detail",
      `
      ${deeplink("targets.html", "target", "Priority Precincts", "Where to focus volunteer hours")}
      ${deeplink("explore.html", "search", "Data Table", "Every number, sortable")}
      ${deeplink("precinct.html", "pin", "My Precinct", "Door-knock one-pagers")}
      ${deeplink("methodology.html", "book", "How It Works", "Where this data comes from")}`
    )}
  `;
  wireDisclosure("cc-more-county");
}

// Dock briefing when a race is showing: county-wide totals across the precincts
// that were actually on that ballot, plus a way back to demographics.
function renderRaceBriefing() {
  const features = cc.geojson.features;
  // Collin's contribution (precinct level)
  let inRace = 0, cRep = 0, cDem = 0, cTotal = 0;
  for (const f of features) {
    const r = cc.race.byPrecinct[String(f.properties.PRECINCT)];
    if (!r || r.total === 0 || !r.winner) continue;
    inRace++; cTotal += r.total; cRep += r.rep; cDem += r.dem;
  }
  const others = cc.race.otherCounties || [];
  const multi = others.length > 0;

  // Full district = Collin + every other county we kept as an aggregate.
  let rep = cRep, dem = cDem, total = cTotal;
  for (const o of others) { rep += o.rep; dem += o.dem; total += o.total; }
  const repPct = total ? Math.round((rep / total) * 100) : 0;
  const demPct = total ? Math.round((dem / total) * 100) : 0;
  const other = Math.max(0, 100 - repPct - demPct);
  const winner = rep === dem ? "Tie" : rep > dem ? "Rep" : "Dem";

  $("cc-dock-eyebrow").textContent = multi ? `Full District · ${others.length + 1} counties` : `${cc.countyName} County · Race Results`;
  $("cc-dock-title").textContent = cc.race.label;
  $("cc-dock-sub").textContent = multi
    ? `Collin: ${inRace} precincts + ${others.map((o) => titleCase(o.county)).join(", ")}`
    : `${inRace} of ${features.length} precincts were on this ballot`;

  // per-county breakdown rows (full-district races only)
  const countyRows = !multi ? "" : [
    { name: "Collin", rep: cRep, dem: cDem, total: cTotal, lvl: "precinct-level" },
    ...others.map((o) => ({ name: titleCase(o.county), rep: o.rep, dem: o.dem, total: o.total, lvl: countyHasPrecincts(o.county) ? "precinct-level" : "county total" })),
  ].map((c) => {
    const win = c.rep === c.dem ? "—" : c.rep > c.dem ? "Rep" : "Dem";
    const col = win === "Rep" ? "var(--rep-text)" : win === "Dem" ? "var(--dem-text)" : "var(--ink-dim)";
    return `<div class="cc-demo-row">
      <div class="cc-demo-top"><span class="name">${escapeHtml(c.name)} <span style="color:var(--ink-faint);font-size:11px">· ${c.lvl}</span></span>
        <span class="val" style="color:${col}">${win} · ${fmtNum(c.total)}</span></div>
      <div class="cc-demo-track"><div class="cc-demo-fill" style="width:${c.total ? Math.round((c.rep) / c.total * 100) : 0}%;background:var(--rep)"></div></div>
    </div>`;
  }).join("");

  // Non-partisan / single-party race: no Rep-vs-Dem bar. Summarize which
  // candidate carried the most precincts instead (county races only — these
  // are never multi-county districts).
  let resultGrid;
  if (cc.race.partisan === false) {
    const wins = {};
    for (const f of features) {
      const r = cc.race.byPrecinct[String(f.properties.PRECINCT)];
      if (!r || r.total === 0 || !r.winner) continue;
      const nm = r.winnerName || r.winner;
      wins[nm] = (wins[nm] || 0) + 1;
    }
    const ranked = Object.entries(wins).sort((a, b) => b[1] - a[1]);
    const topName = ranked.length ? ranked[0][0] : "—";
    const topWins = ranked.length ? ranked[0][1] : 0;
    resultGrid = `
    <div class="cc-stat-grid">
      <div class="cc-stat wide">
        <div class="cc-stat-label">Most precincts carried</div>
        <div class="cc-stat-value" style="font-size:18px">${escapeHtml(topName)}<small> · ${topWins} of ${inRace}</small></div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">Total Votes</div>
        <div class="cc-stat-value" style="font-size:21px">${fmtNum(total)}</div>
      </div>
    </div>`;
  } else {
    resultGrid = `
    <div class="cc-stat-grid">
      <div class="cc-stat wide">
        <div class="cc-stat-label">${multi ? "Full district result" : "County result (precincts on this ballot)"}</div>
        ${leanBarHTML(repPct, other, demPct)}
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">${multi ? "District winner" : "Leads"}</div>
        <div class="cc-stat-value" style="color:${winner === "Rep" ? "var(--rep-text)" : winner === "Dem" ? "var(--dem-text)" : "var(--ink)"}">${winner}</div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">Total Votes</div>
        <div class="cc-stat-value" style="font-size:21px">${fmtNum(total)}</div>
      </div>
    </div>`;
  }

  $("cc-dock-body").innerHTML = `
    ${resultGrid}

    ${multi ? `<div class="cc-section-label">By county</div>${countyRows}` : ""}

    <button class="cc-deeplink" id="cc-clear-race" style="margin-top:14px">
      <span class="dl-l"><span class="dl-ic">${ICON.back}</span><span><span class="dl-t">Back to the overview</span><span class="dl-s">Clear this race</span></span></span>
      <span class="dl-arrow">↺</span>
    </button>

    <div class="cc-section-label">Act on this race</div>
    ${deeplink(`targets.html#race=${encodeURIComponent(cc.raceId)}&strategy=tossups${cc.district ? `&district=${encodeURIComponent(cc.district)}` : ""}`, "target", "Find flip targets", "Rank these precincts by flip / defend — pre-filtered to this race")}
    ${deeplink(`forecast.html#race=${encodeURIComponent(cc.raceId)}`, "chart", "Forecast this race", "Model a turnout scenario")}

    <p style="font-size:13px;color:var(--ink-dim);line-height:1.55;margin-top:12px">
      ${multi ? "Counties with sourced precinct data show precinct-by-precinct; the rest are drawn as shaded county outlines (click either for its result). " : ""}Faded precincts weren’t on this ballot.
    </p>
  `;
  const back = $("cc-clear-race");
  if (back) back.addEventListener("click", clearRace);
}


function renderPrecinctDetail(code) {
  const f = cc.geojson.features.find((x) => String(x.properties.PRECINCT) === code);
  if (!f) return;
  const p = f.properties;

  $("cc-dock-eyebrow").textContent = `${cc.countyName} County · Precinct`;
  $("cc-dock-title").textContent = `Precinct ${escapeHtml(code)}`;

  const hasParty = p.winningParty && p.demShare != null && !isNaN(p.demShare);
  const r = hasParty ? Math.round(p.repShare * 100) : 0;
  const d = hasParty ? Math.round(p.demShare * 100) : 0;
  const m = hasParty ? Math.max(0, 100 - r - d) : 0;

  const strengthWord = { 1: "slight lean", 2: "solid lean", 3: "strong lean" }[p.partyStrength] || "lean";
  $("cc-dock-sub").textContent = hasParty
    ? `Leans ${partyName(p.winningParty)} · ${strengthWord}`
    : "No party data on file";

  // demographic rows (only those present)
  const demo = [
    { name: "White", val: p.pct_white, col: "#9467bd" },
    { name: "Hispanic", val: p.pct_hispanic, col: "#2ca02c" },
    { name: "Black", val: p.pct_black, col: "#ff7f0e" },
    { name: "Asian", val: p.pct_asian, col: "#1f77b4" },
  ].filter((x) => x.val != null && !isNaN(x.val));

  const demoHtml = demo.length
    ? demo
        .sort((a, b) => b.val - a.val)
        .map(
          (x) => `
      <div class="cc-demo-row">
        <div class="cc-demo-top"><span class="name">${x.name}</span><span class="val">${fmtPct(x.val)}</span></div>
        <div class="cc-demo-track"><div class="cc-demo-fill" style="width:${Math.round(x.val * 100)}%;background:${x.col}"></div></div>
      </div>`
        )
        .join("")
    : `<p style="font-size:13px;color:var(--ink-faint)">No racial composition data for this precinct.</p>`;

  const leanBlock = hasParty
    ? `
      <div class="cc-stat wide">
        <div class="cc-stat-label">Partisan Share</div>
        ${leanBarHTML(r, m, d)}
      </div>`
    : `<div class="cc-stat wide"><div class="cc-stat-label">Partisan Share</div><div class="cc-stat-value" style="font-size:1rem;color:var(--ink-dim)">N/A</div></div>`;

  const margin = hasParty ? Math.abs(p.demShare - p.repShare) : null;
  const totalPop = p.total;

  // When a race is showing, lead the detail with this precinct's actual result.
  let raceBlock = "";
  if (cc.raceId && cc.race) {
    const rr = cc.race.byPrecinct[code];
    if (rr && rr.total > 0 && rr.winner) {
      if (cc.race.partisan === false) {
        // No Rep/Dem split to show — lead with the winner and how decisive it was.
        raceBlock = `<div class="cc-section-label">${escapeHtml(cc.race.label)}</div>
          <div class="cc-stat wide" style="margin-bottom:14px">
            <div class="cc-stat-label">${escapeHtml(rr.winnerName || rr.winner)} won · ${fmtNum(rr.total)} votes</div>
            <div class="cc-stat-value" style="font-size:18px">+${fmtPct(rr.margin)} margin</div>
          </div>`;
      } else {
        const rp = Math.round((rr.rep / rr.total) * 100);
        const dp = Math.round((rr.dem / rr.total) * 100);
        const op = Math.max(0, 100 - rp - dp);
        raceBlock = `<div class="cc-section-label">${escapeHtml(cc.race.label)}</div>
          <div class="cc-stat wide" style="margin-bottom:14px">
            <div class="cc-stat-label">${escapeHtml(rr.winnerName || rr.winner)} won · ${fmtNum(rr.total)} votes</div>
            ${leanBarHTML(rp, op, dp)}
          </div>`;
      }
    } else {
      raceBlock = `<div class="cc-section-label">${escapeHtml(cc.race.label)}</div>
        <p style="font-size:13px;color:var(--ink-faint);margin-bottom:14px">This precinct wasn’t on this ballot.</p>`;
    }
  }

  $("cc-dock-body").innerHTML = `
    <p class="cc-headline">${escapeHtml(describePrecinct(p, describeCtx()))}</p>
    ${raceBlock}
    <div class="cc-pill-row" style="margin-bottom:16px">
      ${hasParty ? `<span class="cc-pill ${p.winningParty === "Rep" ? "rep" : p.winningParty === "Dem" ? "dem" : ""}">Leans ${escapeHtml(partyName(p.winningParty))}</span>` : ""}
      ${margin != null ? `<span class="cc-pill ${margin < 0.1 ? "gold" : ""}">${margin < 0.1 ? "Competitive" : "Safe"} · modeled ${fmtPct(margin)} apart</span>` : ""}
    </div>

    <div class="cc-stat-grid">
      ${leanBlock}
      <div class="cc-stat">
        <div class="cc-stat-label">Population</div>
        <div class="cc-stat-value" style="font-size:21px">${fmtNum(totalPop)}</div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">Non-White</div>
        <div class="cc-stat-value" style="font-size:21px">${p.pct_white == null ? "N/A" : fmtPct(1 - p.pct_white)}</div>
      </div>
    </div>

    <div class="cc-section-label">Racial Composition</div>
    ${demoHtml}

    <div class="cc-section-label">Go deeper</div>
    ${deeplink(`precinct.html#precinct=${encodeURIComponent(code)}`, "pin", "Full Precinct Report", "Talking points, history & export")}
    ${deeplink(`explore.html#precinct=${encodeURIComponent(code)}`, "search", "See in the Data Table", "This precinct's row, next to every other")}

    <button class="cc-deeplink" id="cc-back-county" style="margin-top:14px">
      <span class="dl-l"><span class="dl-ic">${ICON.back}</span><span><span class="dl-t">Back to County</span><span class="dl-s">Clear selection</span></span></span>
      <span class="dl-arrow">↺</span>
    </button>
  `;

  const back = $("cc-back-county");
  if (back) back.addEventListener("click", () => selectPrecinct(null));
}

// ---- deeplink card markup ---------------------------------------------------
const ICON = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/><polyline points="14 7 21 7 21 14"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="15 18 9 12 15 6"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z"/></svg>`,
};
function deeplink(href, icon, title, sub) {
  return `
    <a class="cc-deeplink" href="${href}">
      <span class="dl-l"><span class="dl-ic">${ICON[icon]}</span><span><span class="dl-t">${title}</span><span class="dl-s">${sub}</span></span></span>
      <span class="dl-arrow">→</span>
    </a>`;
}

// =============================================================================
// SELECTION + INTERACTION
// =============================================================================
function selectPrecinct(code) {
  cc.selectedCode = code;
  cc.readoutDismissed = null; // a fresh selection always re-shows the card
  updateHash();
  restyle();
  if (code == null) {
    hideReadout();
    renderCountyBriefing();
  } else {
    refreshReadout();
    renderPrecinctDetail(code);
    // pan to the precinct
    const layer = findLayerByCode(code);
    if (layer) {
      try { cc.map.fitBounds(layer.getBounds(), { padding: [80, 80], maxZoom: 13 }); } catch (_) { /* ignore */ }
    }
  }
}

function findLayerByCode(code) {
  let found = null;
  cc.layer.eachLayer((l) => {
    if (String(l.feature.properties.PRECINCT) === code) found = l;
  });
  return found;
}

// =============================================================================
// MODE SWITCHING + LEGEND
// =============================================================================
async function setMode(mode) {
  const wasRace = !!cc.raceId;
  const hadOthers = !!(cc.race && (cc.race.otherGeojson || cc.race.precinctGeo));
  cc.mode = mode;
  if (wasRace) {
    cc.raceId = null; cc.race = null; removeOtherLayer(); applyRaceLabel(); updateHash(); // picking a demo mode exits the race
  }
  document.querySelectorAll(".cc-mode-btn").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  restyle();
  decorateMapPaths(); // aria-labels follow the new mode
  refreshReadout();
  renderLegend();
  if (hadOthers) fitMap();
  if (wasRace) { cc.selectedCode ? renderPrecinctDetail(cc.selectedCode) : renderCountyBriefing(); }
  if (cc.view === "list") renderListView();
}

// Legend rows are discrete named bins with pattern-bearing swatches — the
// EXACT fills the map uses (same pattern defs via url(#…)), with numeric
// ranges written out. Never a gradient bar a 60+ eye has to interpolate.
function renderLegend() {
  const el = $("cc-legend");
  el.innerHTML = legendHTML({
    ...styleEnv(),
    hasOtherLayer: !!cc.otherLayer,
    hasOtherPrecinctLayer: !!cc.otherPrecinctLayer,
  });
}

// The dark "War Room" theme was retired (June 2026 civic-plain redesign).
// Clear any stale saved preference so old sessions don't carry it around.
function clearLegacyTheme() {
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem("cc_theme"); localStorage.removeItem("ccd_theme"); } catch (_) { /* ignore */ }
}

// =============================================================================
// DISTRICT SCOPE — the county picker is gone (Collin-only, REDESIGN Phase 3).
// Districts limit the Collin map to their precincts (geojson CONG/SEN/SHR
// props); the scope also adds that district's tree-only races to the picker.
// =============================================================================

function visibleFeatures() {
  if (!cc.district || !cc.geojson) return cc.geojson ? cc.geojson.features : [];
  return cc.geojson.features.filter((f) => cc.districtCodes.has(String(f.properties.PRECINCT)));
}

function scopeName() {
  if (!cc.district) return "Collin";
  const d = DISTRICT_LIST.find((x) => x.slug === cc.district);
  return d ? d.name : cc.district;
}

function populateDistrictSelect() {
  const sel = $("cc-district");
  if (!sel) return;
  const groups = {};
  for (const d of DISTRICT_LIST) (groups[d.group || "Districts"] ||= []).push(d);
  let html = `<option value="">All precincts</option>`;
  for (const [label, items] of Object.entries(groups)) {
    html += `<optgroup label="${escapeHtml(label)}">` +
      items.map((d) => `<option value="${escapeHtml(d.slug)}">${escapeHtml(d.name)}</option>`).join("") +
      `</optgroup>`;
  }
  sel.innerHTML = html;
}

async function setDistrictScope(slug) {
  cc.district = slug || null;
  cc.districtCodes = cc.district
    ? new Set(precinctsInDistrict(cc.district, cc.geojson.features).map(String))
    : null;
  const sel = $("cc-district");
  if (sel) sel.value = cc.district || "";
  // A selection outside the new scope clears (its polygon is gone).
  if (cc.selectedCode && cc.district && !cc.districtCodes.has(String(cc.selectedCode))) {
    cc.selectedCode = null;
    hideReadout();
  }
  rebuildLayer();
  fitMap();
  await populateRaceMenu(); // the scope adds the district's tree-only races
  updateHash();
  if (cc.selectedCode) renderPrecinctDetail(cc.selectedCode);
  else renderCountyBriefing();
  if (cc.view === "list") renderListView();
}

// Rebuild the precinct layer from the current scope (full county or district).
function rebuildLayer() {
  if (cc.layer) cc.layer.remove();
  cc.layer = L.geoJSON(
    { type: "FeatureCollection", features: visibleFeatures() },
    { style: baseStyle, onEachFeature: attachFeature }
  ).addTo(cc.map);
  decorateMapPaths();
  updatePrecinctLabels();
}

// Honest data-vintage note in the topbar (replaces the old "Live Data" badge —
// the data is official and historical, not live).
function renderDataNote() {
  const el = $("cc-data-note");
  if (!el) return;
  const years = cc.races.map((r) => r.year).filter(Boolean);
  el.textContent = years.length
    ? `Latest results: ${Math.max(...years)} election`
    : "Official election data";
}

// =============================================================================
// PRIMARY TURNOUT (optional profile extra)
// =============================================================================

// Load the optional party-primary turnout extra and show/hide the Primary map
// mode accordingly. Counties without the file just never show the button.
async function refreshPrimaryTurnout() {
  cc.primary = await svc.loadPrimaryTurnout();
  const btn = document.querySelector('.cc-mode-btn[data-mode="primary"]');
  if (btn) btn.style.display = cc.primary ? "" : "none";
  if (!cc.primary && cc.mode === "primary") { await setMode("lean"); return; }
  // The layer may have been built before this data arrived — repaint if showing.
  if (cc.mode === "primary") { restyle(); decorateMapPaths(); renderLegend(); }
}

// True only for genuine Rep-vs-Dem contests (both parties present). Single-party
// primaries and non-partisan races (props, municipal, ISD) return false → they
// get the neutral margin ramp instead of meaningless party colors.
function isPartisanRace(rows) {
  if (!rows.length) return false;
  let hasRep = false, hasDem = false;
  for (const k of Object.keys(rows[0])) {
    if (ELECTION_META_KEYS.has(k) || k === "Write-in") continue;
    const t = k.split(/\s+/)[0].toUpperCase();
    if (t === "REP") hasRep = true;
    else if (t === "DEM") hasDem = true;
  }
  return hasRep && hasDem;
}


// =============================================================================
// RACE OVERLAY — show a specific election's results on the map
// =============================================================================

// Reduce one pivoted race row to the bits we render. Candidate columns are any
// column NOT in the metadata set; summing them gives true participation.
function precinctRaceResult(row) {
  let total = 0, rep = 0, dem = 0, topV = -1, secondV = -1;
  for (const k in row) {
    if (ELECTION_META_KEYS.has(k) || k === "Write-in") continue;
    const v = +row[k] || 0;
    total += v;
    // party prefix case varies between race files (Rep/REP, Dem/DEM)
    const party = k.split(" ")[0].toUpperCase();
    if (party === "REP") rep += v;
    else if (party === "DEM") dem += v;
    if (v > topV) { secondV = topV; topV = v; }
    else if (v > secondV) secondV = v;
  }
  const winner = total > 0 ? row["Winning Party"] || null : null;
  const margin = total > 0 ? (topV - Math.max(0, secondV)) / total : 0;
  // An exact tie still carries a "Winning Party" (first-max keeps the map from
  // going blank), but naming a winner would be a false statement about the
  // result — so callers check `tie` before they say who won.
  const tie = total > 0 && row["Tie"] === true;
  return {
    total, rep, dem, winner,
    winnerName: total > 0 ? row["Winning Candidate"] : null,
    margin, tie,
  };
}

async function populateRaceMenu() {
  try {
    const collinRaces = await svc.listRaces();
    let races = collinRaces;
    if (cc.district) {
      // The scope adds the district's tree-only races (e.g. the 2020 statewide
      // set) — Collin's own manifest entries win on any overlap.
      try {
        const treeRaces = await listDistrictRaces(cc.district);
        const have = new Set(collinRaces.map(getRaceKey));
        const extras = treeRaces
          .filter((e) => !have.has(getRaceKey(e)))
          .map((e) => ({ ...e, _districtTree: cc.district }));
        races = [...collinRaces, ...extras];
      } catch (_) { /* scope extras are optional */ }
    }
    cc.races = races;
  } catch (_) { cc.races = []; }
  if (cc.racePicker) cc.racePicker.refresh();
}

const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Load a district-tree-only race (a scope extra, e.g. the 2020 statewide set)
// for the COLLIN precincts on this map: tree rows key precincts as
// "collin:<code>" — strip the prefix and pivot to the legacy row shape. The
// other counties' rows fold in via loadDistrictAggregates as with any
// district race.
async function loadTreeRaceRows(slug, entry) {
  const base = `data/tx/districts/${slug}/data`;
  const stripCollin = (rows) =>
    rows
      .filter((r) => String(r.precinct).startsWith("collin:"))
      .map((r) => ({ ...r, precinct: String(r.precinct).slice("collin:".length) }));
  const longRows = await d3.csv(`${base}/${entry.raceFile}`);
  let turnoutRows = null;
  if (entry.turnoutFile) {
    try {
      turnoutRows = stripCollin(await d3.csv(`${base}/${entry.turnoutFile}`));
    } catch (_) { turnoutRows = null; }
  }
  return computeWinners(pivotRace(stripCollin(longRows), turnoutRows));
}

// Race-picker groups, in display order. The marquee contests come first and
// open by default; the hundreds of city/school/utility races stay behind
// closed headers so the list starts at a readable size.
function applyRaceLabel() {
  if (cc.racePicker) cc.racePicker.setLabel(cc.race ? cc.race.label : null);
  // While a race is showing, the demographic modes are muted VISUALLY only.
  // They are not disabled: clicking one works and is the only in-map way out of
  // a loaded race. Marking them aria-disabled told screen-reader users the
  // Diversity view was unavailable while sighted users clicked it freely — a
  // false statement about a working control, so it is gone. The buttons carry
  // real aria-pressed state instead (set in setMode).
  const modes = $("cc-modes");
  if (modes) modes.style.opacity = cc.raceId ? "0.7" : "1";
}

async function loadRace(raceIdOrEntry) {
  const entry = typeof raceIdOrEntry === "object"
    ? raceIdOrEntry
    : cc.races.find((e) => getRaceKey(e) === raceIdOrEntry);
  if (!entry) return;
  // Every await below is a fetch that can outlive the click that started it.
  // Without a token, picking a race and then clicking Diversity repaints race
  // fills and the race legend after the mode switch -- leaving the Diversity
  // button active, the hash rewritten back to #race=, and the map showing the
  // race the user just left. Only the newest load is allowed to paint.
  const token = ++cc.loadToken;
  showLoading(true);
  try {
    // 2026-only app: every race renders on the current (2026) precincts. Older
    // races use the official results carefully re-drawn onto the new boundaries.
    // Tree-only races (a district scope's extras, e.g. 2020 statewide) load
    // from the district tree with their Collin rows unprefixed.
    const rows = entry._districtTree
      ? await loadTreeRaceRows(entry._districtTree, entry)
      : await svc.loadRace(entry);
    if (token !== cc.loadToken) return;
    const byPrecinct = {};
    for (const row of rows) byPrecinct[String(row["PRECINCT CODE"])] = precinctRaceResult(row);
    cc.raceId = getRaceKey(entry);
    // Keep this race's group open so reopening the picker shows the selection.
    if (cc.racePicker) cc.racePicker.ensureGroupOpen(entry.category);
    cc.race = { id: cc.raceId, label: entry.displayName || entry.office || cc.raceId, byPrecinct,
      partisan: isPartisanRace(rows),
      otherCounties: [], otherByCounty: {}, otherPrecincts: {}, otherGeojson: null, precinctGeo: null, precinctCounties: new Set() };
    // For multi-county federal/state DISTRICT races, fold in the other counties.
    // Each non-Collin county is drawn at PRECINCT level where we have its precinct
    // geometry + per-precinct results (Hunt CD-3); otherwise as one county outline.
    const slug = districtSlugFor(entry);
    if (slug && entry.raceFile) {
      const ex = await loadDistrictAggregates(slug, entry.raceFile);
      if (token !== cc.loadToken) return;
      cc.race.otherCounties = ex.byCounty;
      cc.race.otherByCounty = Object.fromEntries(ex.byCounty.map((o) => [o.county, o]));
      cc.race.otherPrecincts = ex.byPrecinct;
      if (ex.byCounty.length) {
        const outlines = await loadDistrictOutlines(slug);
        const precinctGeo = await loadDistrictPrecinctGeo(slug);
        if (token !== cc.loadToken) return;
        cc.race.otherGeojson = outlines;
        cc.race.precinctGeo = precinctGeo;
        if (cc.race.precinctGeo) {
          const joined = {}; // countySlug -> Set of precinct codes with both a polygon and a result
          for (const f of cc.race.precinctGeo.features) {
            const code = String(f.properties.PRECINCT);
            if (!ex.byPrecinct[code]) continue;
            (joined[f.properties.countySlug] = joined[f.properties.countySlug] || new Set()).add(code);
          }
          // A county earns precinct-level rendering only when its joined polygons
          // account for its entire county total — a partial join (e.g. a race whose
          // precinct codes only sometimes match our boundary vintage) would silently
          // hide the unmatched votes, so it falls back to the county outline.
          for (const county in joined) {
            let sum = 0;
            for (const code of joined[county]) sum += ex.byPrecinct[code].total;
            const countyRow = cc.race.otherByCounty[county];
            if (countyRow && sum === countyRow.total) cc.race.precinctCounties.add(county);
          }
        }
      }
    }
    if (token !== cc.loadToken) return;
    applyRaceLabel();
    updateHash();
    restyle();
    renderOtherLayer();
    renderOtherPrecinctLayer();
    decorateMapPaths();
    refreshReadout();
    renderLegend();
    if (cc.race.otherGeojson || cc.race.precinctGeo) fitDistrictBounds();
    if (cc.selectedCode) renderPrecinctDetail(cc.selectedCode);
    else renderCountyBriefing();
    if (cc.view === "list") renderListView();
  } catch (err) {
    console.error("[Command] race load failed:", err);
  } finally {
    // A superseded load must not clear the spinner the newest one is still using.
    if (token === cc.loadToken) showLoading(false);
  }
}

async function clearRace() {
  if (!cc.raceId) return;
  // Leaving the race supersedes any load still in flight, or it would paint
  // the race back over the demographic mode the user just switched to.
  cc.loadToken++;
  const hadOthers = !!(cc.race && (cc.race.otherGeojson || cc.race.precinctGeo));
  cc.raceId = null; cc.race = null;
  removeOtherLayer();
  applyRaceLabel();
  updateHash();
  restyle();
  decorateMapPaths();
  refreshReadout();
  renderLegend();
  if (hadOthers) fitMap(); // pull the view back to Collin now the other counties are gone
  if (cc.selectedCode) renderPrecinctDetail(cc.selectedCode);
  else renderCountyBriefing();
  if (cc.view === "list") renderListView();
}

// ---- non-Collin county outlines (district races) ----------------------------
// We carry only Collin at precinct level; the other counties of a district are
// drawn as ONE shaded outline each (their dissolved district-portion geometry),
// coloured by the county-total winner. Dashed stroke signals "county aggregate,
// not precinct detail."
function otherCountyResult(slug) {
  return cc.race && cc.race.otherByCounty ? cc.race.otherByCounty[slug] : null;
}

function otherStyle(feature) {
  const r = otherCountyResult(feature.properties.countySlug);
  const fill = r && r.winner
    ? patternFill(svgRoot(), partyKind(r.winner), 1, PARTY_COLORS[r.winner] || PARTY_COLORS.default)
    : notOnBallotFill(styleEnv());
  return {
    fillColor: fill,
    fillOpacity: r ? 0.5 : 0.3,
    color: tm().stroke,
    weight: 1.6,
    dashArray: "5 4",
    opacity: 0.95,
  };
}

// Plain-text description (aria-label on the county outline path).
function describeOtherCounty(props) {
  const r = otherCountyResult(props.countySlug);
  const name = String(props.COUNTY);
  if (!r || !r.total) return `${name} County — not on this ballot`;
  const margin = Math.abs(r.rep - r.dem) / r.total;
  return `${name} County — ${partyName(r.winner)} won by ${Math.round(margin * 100)} points · ${fmtNum(r.total)} votes (county total)`;
}

function removeOtherLayer() {
  if (cc.otherLayer) { cc.otherLayer.remove(); cc.otherLayer = null; }
  if (cc.otherPrecinctLayer) { cc.otherPrecinctLayer.remove(); cc.otherPrecinctLayer = null; }
}

// A county is drawn precinct-by-precinct (not as an outline) when we have its
// precinct geometry joined to results for this race.
function countyHasPrecincts(slug) {
  return !!(cc.race && cc.race.precinctCounties && cc.race.precinctCounties.has(slug));
}

function renderOtherLayer() {
  if (cc.otherLayer) { cc.otherLayer.remove(); cc.otherLayer = null; }
  if (!cc.race || !cc.race.otherGeojson) return;
  // skip counties we draw at precinct level — they get the detailed layer instead
  const feats = cc.race.otherGeojson.features.filter((f) => !countyHasPrecincts(f.properties.countySlug));
  if (!feats.length) return;
  cc.otherLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: otherStyle,
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: () => layer.setStyle({ weight: 3, color: tm().hover }),
        mouseout: () => layer.setStyle(otherStyle(feature)),
        click: () => selectOtherCounty(feature.properties.countySlug),
      });
    },
  }).addTo(cc.map);
  decorateOtherPaths();
}

// Non-Collin PRECINCT polygons (e.g. Hunt CD-3) coloured by each precinct's own
// result — the same treatment Collin gets, for counties whose precinct geometry
// + results we've sourced.
function otherPrecinctResult(code) {
  return cc.race && cc.race.otherPrecincts ? cc.race.otherPrecincts[code] : null;
}

function otherPrecinctStyle(feature) {
  const r = otherPrecinctResult(String(feature.properties.PRECINCT));
  const fill = r && r.winner
    ? patternFill(svgRoot(), partyKind(r.winner), 2, PARTY_COLORS[r.winner] || PARTY_COLORS.default)
    : notOnBallotFill(styleEnv());
  return {
    fillColor: fill,
    fillOpacity: r ? 0.74 : 0.45,
    color: tm().stroke,
    weight: 0.7,
    opacity: 1,
  };
}

// Plain-text description (aria-label on the precinct path).
function describeOtherPrecinct(props) {
  const r = otherPrecinctResult(String(props.PRECINCT));
  const code = String(props.PRECINCT).split(":").pop();
  const county = String(props.COUNTY);
  if (!r || !r.total) return `${county} County precinct ${code} — not on this ballot`;
  return `${county} County precinct ${code} — ${partyName(r.winner)} won by ${Math.round(r.margin * 100)} points · ${fmtNum(r.total)} votes`;
}

function renderOtherPrecinctLayer() {
  if (cc.otherPrecinctLayer) { cc.otherPrecinctLayer.remove(); cc.otherPrecinctLayer = null; }
  if (!cc.race || !cc.race.precinctGeo || !cc.race.precinctCounties.size) return;
  const feats = cc.race.precinctGeo.features.filter((f) => countyHasPrecincts(f.properties.countySlug));
  if (!feats.length) return;
  cc.otherPrecinctLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: otherPrecinctStyle,
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: () => layer.setStyle({ weight: 2.2, color: tm().hover }),
        mouseout: () => layer.setStyle(otherPrecinctStyle(feature)),
        click: () => selectOtherPrecinct(String(feature.properties.PRECINCT)),
      });
    },
  }).addTo(cc.map);
  decorateOtherPaths();
}

// Fit the map to the WHOLE district (Collin precincts + the other counties) so a
// multi-county race like CD-3 reveals Hunt instead of staying zoomed on Collin.
function fitDistrictBounds() {
  try {
    let b = cc.layer.getBounds();
    if (cc.otherLayer) b = b.extend(cc.otherLayer.getBounds());
    if (cc.otherPrecinctLayer) b = b.extend(cc.otherPrecinctLayer.getBounds());
    if (b.isValid()) { cc.map.fitBounds(b, { padding: [30, 30] }); return; }
  } catch (_) { /* fall through */ }
  fitMap();
}

// Click a non-Collin precinct → brief it like a Collin precinct (race result).
function selectOtherPrecinct(code) {
  cc.selectedCode = null;
  restyle();
  const r = otherPrecinctResult(code);
  const feat = cc.race.precinctGeo.features.find((f) => String(f.properties.PRECINCT) === code);
  if (feat) showReadout(describeOtherPrecinct(feat.properties));
  const county = feat ? feat.properties.COUNTY : "";
  const bare = code.split(":").pop();
  $("cc-dock-eyebrow").textContent = `${cc.race.label} · ${escapeHtml(county)} County`;
  $("cc-dock-title").textContent = `Precinct ${escapeHtml(bare)}`;
  const backBtn = `<button class="cc-deeplink" id="cc-back-district" style="margin-top:14px">
      <span class="dl-l"><span class="dl-ic">${ICON.back}</span><span><span class="dl-t">Back to District</span><span class="dl-s">Full district result</span></span></span>
      <span class="dl-arrow">↺</span></button>`;
  if (!r || !r.total) {
    $("cc-dock-sub").textContent = "Not on this ballot";
    $("cc-dock-body").innerHTML = `<p style="font-size:13px;color:var(--ink-dim)">This precinct wasn’t on this ballot.</p>${backBtn}`;
  } else {
    const rp = Math.round((r.rep / r.total) * 100), dp = Math.round((r.dem / r.total) * 100), op = Math.max(0, 100 - rp - dp);
    $("cc-dock-sub").textContent = `${r.winner} +${fmtPct(r.margin)} · ${fmtNum(r.total)} votes`;
    $("cc-dock-body").innerHTML = `
      <div class="cc-stat wide" style="margin-bottom:14px">
        <div class="cc-stat-label">${escapeHtml(county)} County · precinct-level (official)</div>
        ${leanBarHTML(rp, op, dp)}
      </div>${backBtn}`;
  }
  const back = $("cc-back-district");
  if (back) back.addEventListener("click", () => selectPrecinct(null));
  openDockMobile();
  if (feat) {
    cc.otherPrecinctLayer.eachLayer((l) => {
      if (String(l.feature.properties.PRECINCT) === code) {
        try { cc.map.fitBounds(l.getBounds(), { padding: [80, 80], maxZoom: 13 }); } catch (_) { /* ignore */ }
      }
    });
  }
}

function selectOtherCounty(slug) {
  cc.selectedCode = null;
  restyle();
  const feat = cc.race.otherGeojson && cc.race.otherGeojson.features.find((f) => f.properties.countySlug === slug);
  if (feat) showReadout(describeOtherCounty(feat.properties));
  renderOtherCountyDetail(slug);
  openDockMobile();
  if (cc.otherLayer) {
    cc.otherLayer.eachLayer((l) => {
      if (l.feature.properties.countySlug === slug) {
        try { cc.map.fitBounds(l.getBounds(), { padding: [60, 60], maxZoom: 11 }); } catch (_) { /* ignore */ }
      }
    });
  }
}

function renderOtherCountyDetail(slug) {
  const r = otherCountyResult(slug);
  const feat = cc.race.otherGeojson && cc.race.otherGeojson.features.find((f) => f.properties.countySlug === slug);
  const name = feat ? feat.properties.COUNTY : titleCase(slug);
  $("cc-dock-eyebrow").textContent = `${cc.race.label} · County total`;
  $("cc-dock-title").textContent = `${escapeHtml(name)} County`;

  const backBtn = `
    <button class="cc-deeplink" id="cc-back-district" style="margin-top:14px">
      <span class="dl-l"><span class="dl-ic">${ICON.back}</span><span><span class="dl-t">Back to District</span><span class="dl-s">Full district result</span></span></span>
      <span class="dl-arrow">↺</span>
    </button>`;

  if (!r || !r.total) {
    $("cc-dock-sub").textContent = "Part of the district · no result on file";
    $("cc-dock-body").innerHTML = `<p style="font-size:13px;color:var(--ink-dim);line-height:1.55">
      ${escapeHtml(name)} County is part of this district but carries no result for this race.</p>${backBtn}`;
  } else {
    const rp = Math.round((r.rep / r.total) * 100);
    const dp = Math.round((r.dem / r.total) * 100);
    const op = Math.max(0, 100 - rp - dp);
    $("cc-dock-sub").textContent = `${r.winner} carries the county · ${fmtNum(r.total)} votes`;
    $("cc-dock-body").innerHTML = `
      <div class="cc-stat-grid">
        <div class="cc-stat wide">
          <div class="cc-stat-label">County-total result</div>
          ${leanBarHTML(rp, op, dp)}
        </div>
        <div class="cc-stat">
          <div class="cc-stat-label">Winner</div>
          <div class="cc-stat-value" style="color:${r.winner === "Rep" ? "var(--rep-text)" : "var(--dem-text)"}">${escapeHtml(r.winner)}</div>
        </div>
        <div class="cc-stat">
          <div class="cc-stat-label">Total Votes</div>
          <div class="cc-stat-value" style="font-size:21px">${fmtNum(r.total)}</div>
        </div>
      </div>
      <p style="font-size:13px;color:var(--ink-faint);line-height:1.55;margin-top:12px">
        County total for this district — we carry Collin at precinct level; the
        other counties are shown as one shaded outline each.</p>
      ${backBtn}`;
  }
  const back = $("cc-back-district");
  if (back) back.addEventListener("click", () => selectPrecinct(null));
}

function closeRaceMenu() { if (cc.racePicker) cc.racePicker.close(); }

// =============================================================================
// LIST VIEW — the linear alternative to the map (js/listView.js)
// =============================================================================
function setView(view) {
  cc.view = view === "list" ? "list" : "map";
  const list = $("cc-list");
  const isList = cc.view === "list";
  list.hidden = !isList;
  $("cc-view-map").setAttribute("aria-pressed", String(!isList));
  $("cc-view-list").setAttribute("aria-pressed", String(isList));
  updateHash();
  if (isList) renderListView();
}

function renderListView() {
  if (cc.view !== "list" || !cc.geojson) return;
  const ctx = describeCtx();

  // headline: race label when a race is showing, area "so what" otherwise
  const headline = cc.raceId && cc.race
    ? `${cc.race.label} — precinct by precinct.`
    : buildCountyBriefing(visibleFeatures(), { countyName: scopeName(), isDistrict: !!cc.district }).headline;
  $("cc-list-headline").textContent = headline;

  const rows = sortRows(buildRows(visibleFeatures(), ctx), cc.listSort);
  $("cc-list-count").textContent = countLine(rows, cc.listSort);
  if (cc.cancelListRender) cc.cancelListRender();
  cc.cancelListRender = renderRows($("cc-list-body"), rows);
}

function wireListView() {
  const sort = $("cc-list-sort");
  sort.innerHTML = SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  sort.addEventListener("change", () => {
    cc.listSort = sort.value;
    renderListView();
  });
  $("cc-list-body").addEventListener("click", (e) => {
    const btn = e.target.closest(".cc-card-details");
    if (!btn) return;
    setView("map");
    selectPrecinct(btn.dataset.code);
  });
  $("cc-view-map").addEventListener("click", () => setView("map"));
  $("cc-view-list").addEventListener("click", () => setView("list"));
  // the skip link before the map lands keyboard/AT users straight in the list
  $("cc-skip-map").addEventListener("click", (e) => {
    e.preventDefault();
    setView("list");
    $("cc-list-sort").focus();
  });
}

// =============================================================================
// MOBILE DOCK
// =============================================================================
function openDockMobile() { if (window.innerWidth <= 1180) $("cc-dock").classList.add("open"); }

// =============================================================================
// LOADING
// =============================================================================
function showLoading(on) { $("cc-loading").classList.toggle("hidden", !on); }

// =============================================================================
// WIRING
// =============================================================================
function wireUI() {
  // mode buttons
  $("cc-modes").addEventListener("click", (e) => {
    const btn = e.target.closest(".cc-mode-btn");
    if (btn) setMode(btn.dataset.mode);
  });

  // district scope — a native select; districts filter the Collin map
  $("cc-district").addEventListener("change", (e) => setDistrictScope(e.target.value || null));

  // race menu — the shared searchable picker (ui/racePicker.js)
  cc.racePicker = createRacePicker({
    root: $("cc-race-select"),
    button: $("cc-race-btn"),
    nameEl: $("cc-race-name"),
    menuEl: $("cc-race-menu"),
    searchInput: $("cc-race-search"),
    listEl: $("cc-race-list"),
    getRaces: () => cc.races,
    getSelectedId: () => cc.raceId,
    onPick: (id) => (id ? loadRace(id) : clearRace()),
  });

  // precinct quick-search + "My location" — the shared finder
  // (ui/precinctFinder.js) owns the number-vs-address heuristic, the geocode
  // and geolocation flows, and the plain-language status copy.
  cc.finder = createPrecinctFinder({
    getFeatures: () => (cc.geojson && cc.geojson.features) || [],
    hasPrecinct: (code) => !!findLayerByCode(code),
    onFound: (code) => selectPrecinct(code),
    onStatus: searchStatus,
    findPrecinctForAddress,
    findPrecinctForPoint,
    viewbox: TEXAS_VIEWBOX,
  });
  $("cc-precinct-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") cc.finder.search(e.target.value);
  });
  $("cc-locate-btn").addEventListener("click", () => cc.finder.locate());

  // phones: the legend collapses behind a labelled toggle so it never
  // blankets the map (the [hidden] attr only gates the ≤700px display rule)
  const legendToggle = $("cc-legend-toggle");
  if (window.innerWidth <= 700) {
    $("cc-legend").classList.add("collapsed");
    legendToggle.setAttribute("aria-expanded", "false");
  }
  legendToggle.addEventListener("click", () => {
    const collapsed = $("cc-legend").classList.toggle("collapsed");
    legendToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  // readout card: "Full details" opens/focuses the dock briefing. On desktop
  // the dock is already visible, so pulse it — the click must always produce
  // a visible response.
  $("cc-readout-more").addEventListener("click", () => {
    openDockMobile();
    const dock = $("cc-dock");
    $("cc-dock-body").scrollTop = 0;
    dock.classList.remove("flash");
    void dock.offsetWidth; // restart the animation on repeat clicks
    dock.classList.add("flash");
    const title = $("cc-dock-title");
    title.setAttribute("tabindex", "-1");
    title.focus();
  });

  // readout card: ✕ dismisses the card (selection + dock detail stay)
  $("cc-readout-close").addEventListener("click", () => {
    cc.readoutDismissed = cc.selectedCode;
    hideReadout();
  });

  // tablet/phone: the details dock is a slide-over — give it a visible toggle
  $("cc-dock-toggle").addEventListener("click", () => $("cc-dock").classList.toggle("open"));

  // Escape closes menus / mobile dock
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeRaceMenu(); $("cc-dock").classList.remove("open"); }
  });

  setupThumbBar();
  wireReadoutSheet();
}

// Mobile "thumb zone": on a phone the frequent map actions (Map|List toggle,
// the Lean/Margin/Diversity mode switch, and 📍 My location) sit at the TOP of
// the screen — out of reach one-handed. Relocate those three control NODES into
// a fixed bottom bar so they land under the thumb. Desktop and iPad (≥761px) are
// untouched. Decided ONCE at init, mirroring the legend-collapse idiom above —
// the page never re-flows on resize; a resize/orientation re-home is a possible
// follow-up. Safe because every control is wired by id or delegated on the whole
// #cc-modes node (see wireUI): moving the nodes keeps all listeners live, and
// the mode buttons stay inside #cc-modes. The bar's measured height feeds the
// --cc-thumbbar-h CSS var so the floating legend/readout clear it when it wraps.
function setupThumbBar() {
  if (!window.matchMedia || !window.matchMedia("(max-width: 760px)").matches) return;
  const topbar = document.querySelector(".cc-topbar");
  const viewToggle = document.querySelector(".cc-view-toggle");
  const modes = $("cc-modes");
  const locate = $("cc-locate-btn");
  if (!topbar || !viewToggle || !modes || !locate) return;

  const bar = document.createElement("div");
  bar.className = "cc-thumbbar backplate";
  bar.id = "cc-thumbbar";
  // Insert right after the top strip so keyboard/tab order stays
  // header → top strip → thumb actions → map → legend.
  topbar.insertAdjacentElement("afterend", bar);
  // Order in the bar: view switch, map-layer switch, locate.
  bar.append(viewToggle, modes, locate);
  document.body.classList.add("cc-has-thumbbar");

  // Keep --cc-thumbbar-h current as the bar wraps/unwraps.
  const setH = () =>
    document.documentElement.style.setProperty("--cc-thumbbar-h", `${bar.offsetHeight}px`);
  setH();
  if (window.ResizeObserver) new ResizeObserver(setH).observe(bar);
}

// On phones the readout is a bottom sheet with a grab handle: drag it UP to open
// the full detail dock, DOWN to dismiss — the natural bottom-sheet gesture, with
// the map staying visible behind. The handle is a real button, so keyboard users
// get the same "full details" action via Enter/Space. No-op on desktop (the
// handle is display:none and the card keeps its compact form).
function wireReadoutSheet() {
  const handle = $("cc-readout-handle");
  if (!handle) return;
  const THRESH = 36; // px of intentional drag before we act
  let startY = null;
  const begin = (y) => { startY = y; };
  const finish = (y) => {
    if (startY == null || y == null) { startY = null; return; }
    const dy = y - startY;
    startY = null;
    if (dy > THRESH) { cc.readoutDismissed = cc.selectedCode; hideReadout(); }
    else if (dy < -THRESH) { $("cc-readout-more").click(); }
  };
  handle.addEventListener("touchstart", (e) => begin(e.touches[0]?.clientY), { passive: true });
  handle.addEventListener("touchend", (e) => finish(e.changedTouches[0]?.clientY), { passive: true });
  // Mouse/trackpad drag (non-touch pointers only, so touch isn't double-counted).
  handle.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") begin(e.clientY); });
  handle.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") finish(e.clientY); });
  // Keyboard: the handle opens full details (drag-down dismiss has the ✕ button).
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("cc-readout-more").click(); }
  });
}

// =============================================================================
// ADDRESS / LOCATION SEARCH — logic + copy live in ui/precinctFinder.js;
// plain-language status goes to the dock subtitle.
// =============================================================================
function searchStatus(msg) {
  $("cc-dock-sub").textContent = msg;
  openDockMobile();
}

// hash params (county / race) for deep links + shareable state — via the one
// urlState vocabulary (REDESIGN.md §5.3)
function readHashParams() {
  return readParams();
}
function updateHash() {
  writeParams({
    race: cc.raceId || null,
    precinct: cc.selectedCode || null,
    view: cc.view === "list" ? "list" : null,
    district: cc.district || null,
  });
}

// =============================================================================
// BOOT
// =============================================================================
async function init() {
  if (cc.map) return; // guard: the auth path can fire boot twice
  clearLegacyTheme();
  wireUI();
  wireListView();
  renderLegend();
  showLoading(true);
  try {
    const params = readHashParams();
    document.title = "Map — Collin County Elections";
    const { geojson } = await svc.loadAll();
    cc.geojson = geojson;
    populateDistrictSelect();
    // District scope: a #district= deep link, with legacy #county=<district
    // slug> read-tolerated for old bookmarks (never written back — §3.5).
    const wanted = params.district || params.county;
    if (wanted && DISTRICT_LIST.some((d) => d.slug === wanted)) {
      cc.district = wanted;
      cc.districtCodes = new Set(precinctsInDistrict(wanted, geojson.features).map(String));
      $("cc-district").value = wanted;
    }
    buildMap({ type: "FeatureCollection", features: visibleFeatures() });
    if (cc.district) fitMap();
    await refreshPrimaryTurnout();
    await populateRaceMenu();
    renderDataNote();
    // A #race= deep link (e.g. from the Elections catalog) shows that race.
    if (params.race) await loadRace(params.race);
    else renderCountyBriefing();
    // A #precinct= deep link (e.g. from Targets' "Map" link) jumps to + selects it.
    if (params.precinct && visibleFeatures().some((f) => String(f.properties.PRECINCT) === params.precinct)) {
      selectPrecinct(params.precinct);
    }
    // A #view=list deep link opens the linear view directly.
    if (params.view === "list") setView("list");
    // Normalize the hash to the current vocabulary (drops any legacy county=).
    updateHash();
  } catch (err) {
    console.error("[Command] boot failed:", err);
    $("cc-dock-sub").textContent = "We couldn't load the election data.";
    $("cc-dock-body").innerHTML = `
      <p style="font-size:16px;color:var(--ink-dim);line-height:1.5;margin-bottom:14px">
        Check your internet connection, then try again.</p>
      <button id="cc-retry" class="cc-county-btn" type="button">Try again</button>`;
    $("cc-retry").addEventListener("click", () => location.reload());
  } finally {
    showLoading(false);
  }
}

// Sign-out lives in the shared header (js/siteNav.js) — it detects the Cognito
// session in localStorage and clears it; no page-specific button needed here.

// Auth gate — when REQUIRE_SIGN_IN is true, the public deployment sits behind
// Cognito sign-in (localhost and e2e always bypass it). init() is idempotent,
// so running it on both the initial check and the auth-state change is safe.
//
// PUBLIC-ACCESS MODE (July 2026): the gate is switched OFF so anyone can view
// the site. Flip this back to true to restore the sign-in requirement — the
// overlay, Cognito wiring, and header Sign out all still work.
const REQUIRE_SIGN_IN = false;

async function boot() {
  if (!REQUIRE_SIGN_IN) {
    hideAuthOverlay();
    init();
    return;
  }
  initAuth();
  const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocalDev || (await isAuthenticated())) {
    hideAuthOverlay();
    init();
  } else {
    showAuthOverlay();
  }
  onAuthStateChange((authenticated) => {
    if (authenticated) { hideAuthOverlay(); init(); }
    else { location.reload(); }
  });
}

// auth-expired events (e.g. from an API 401) force a clean re-auth.
window.addEventListener("auth-expired", () => { signOut(); location.reload(); });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
