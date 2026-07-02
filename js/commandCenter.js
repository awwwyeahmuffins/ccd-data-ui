// commandCenter.js
// --------------------------------------------------------------------------------
// Orchestrator for index.html — the Map page, the app's front door. A low-basemap
// civic map of precinct polygons with three analytic color modes (Lean / Margin /
// Diversity) and a data dock that briefs the whole county or one clicked precinct.
// Warm large-print "paper" design for precinct chairs 60+ on iPads.
//
// Reuses the SAME data layer as the other pages — loadAllData(), the locked party
// colors, and the county registry — so it never invents data and stays in sync.
// Sits behind the Cognito sign-in gate on deployment (bypassed on localhost / e2e).

import { loadAllData, setActiveCounty, loadCountyRegistry, getActiveCounty, listElectionCSVs, loadElectionData, setActiveBoundary, getActiveBoundary, getBoundaryConfigs, loadPrimaryTurnout } from "./dataLoader.js";
import { PARTY_STRENGTH_COLORS, PARTY_COLORS, ELECTION_META_KEYS, MAP_CONFIG } from "./constants.js";
import { escapeHtml } from "./lib/dom.js";
import { formatPctWhole, formatNumberOrNA } from "./lib/format.js";
import { readParams, writeParams } from "./lib/urlState.js";
import { initAuth, isAuthenticated, signOut, onAuthStateChange } from "./auth.js";
import { showAuthOverlay, hideAuthOverlay } from "./authUI.js";
import { findPrecinctForAddress, findPrecinctForPoint, TEXAS_VIEWBOX } from "./geoLookup.js";
import { RAMPS, marginBin, diversityBin, describePrecinct, partyName, legendBins } from "./mapBins.js";
import { patternFill, partyKind, swatchSVG } from "./mapPatterns.js";
import { buildCountyBriefing } from "./countyBriefing.js";
import { buildRows, sortRows, renderRows, countLine, SORTS } from "./listView.js";
import { termButton } from "./glossary.js";

// ---- module state (this page's own; no shared singleton) --------------------
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
  mode: "lean",          // lean | margin | diversity | primary (demographic modes)
  selectedCode: null,
  primary: null,         // party-primary ballots lookup { code: { year: {dem,rep} } }, null = N/A
  countyName: "Collin",
  races: [],             // this county's race manifest (for the picker)
  raceId: null,          // active race id, or null for demographics
  race: null,            // { id, label, partisan, byPrecinct: { code: {winner,total,margin,...} } }
};

// Subtle CartoDB basemap for geographic grounding (precinct chairs orienting
// to their turf). Kept low-opacity in CSS so the choropleth dominates.
const BASEMAP = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const BASEMAP_ATTR =
  '&copy; <a href="https://carto.com/">CARTO</a> · &copy; OpenStreetMap';

// Map cosmetics that can't come from CSS variables (vector fills).
const MAP_COSMETICS = { noData: "#DAD3C6", stroke: "#FFFDF9", hover: "#1560C4", sel: "#0B4DA2", notBallot: "#EFEBE2" };
const tm = () => MAP_COSMETICS;

// The map renders SVG so every precinct is a real, focusable, pattern-fillable
// DOM node (canvas has none of that). `?renderer=canvas` is a perf escape
// hatch: it falls back to plain color fills automatically.
const useCanvasRenderer = new URLSearchParams(location.search).get("renderer") === "canvas";
// The overlay SVG that hosts the pattern <defs> (null on the canvas fallback).
function svgRoot() {
  return useCanvasRenderer ? null : (cc.renderer && cc.renderer._container) || null;
}

// ---- tiny DOM helpers -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const fmtPct = formatPctWhole;
const fmtNum = formatNumberOrNA;

// =============================================================================
// FILL ENGINES — one per mode. Each takes a feature's merged properties and
// returns an SVG fill: a pattern url (color + party geometry + bin density,
// never color alone) or a plain color on the canvas fallback / no-data case.
// Bin edges and ramp colors live in mapBins.js — shared with the legend,
// aria-labels, readout card, and List View so they can never disagree.
// =============================================================================

// Lean: fill = locked PARTY_STRENGTH_COLORS tint; pattern geometry by party
// (Rep diagonal / Dem horizontal / other dots); density = strength 1..3.
function leanFill(p) {
  const party = p.winningParty;
  const strength = p.partyStrength;
  if (!party || !PARTY_STRENGTH_COLORS[party]) return tm().noData;
  const ramp = PARTY_STRENGTH_COLORS[party];
  const bg = ramp[strength] || ramp.default;
  const level = Math.max(1, Math.min(3, +strength || 1));
  return patternFill(svgRoot(), partyKind(party), level, bg);
}

// Margin: 5 named numeric bins (mapBins.MARGIN_BINS); dot density rises with
// the bin. Bin 0 (very close) stays solid pale so close races pop as "clean".
function marginFill(p) {
  if (p.demShare == null || p.repShare == null || isNaN(p.demShare)) return tm().noData;
  const bin = marginBin(Math.abs(p.demShare - p.repShare));
  return patternFill(svgRoot(), "dots", bin, RAMPS.margin[bin]);
}

// Diversity: 5 fixed 20-point bins of non-white share.
function diversityFill(p) {
  if (p.pct_white == null || isNaN(p.pct_white)) return tm().noData;
  const bin = diversityBin(1 - p.pct_white);
  return patternFill(svgRoot(), "dots", bin, RAMPS.diversity[bin]);
}

// Race results: fill by the winning party — but ONLY for precincts that
// actually participated (candidate votes > 0). computeWinners() assigns a
// "winner" to every precinct via an alphabetical-first-max rule even when a
// precinct had 0 votes (it wasn't on that ballot), so a sub-county race like
// CD-3 would otherwise light up the whole county. Non-participants → the
// distinct "not on this ballot" cross-hatch (see baseStyle), never plain gray.
function raceFill(p) {
  if (!cc.race) return tm().noData;
  const r = cc.race.byPrecinct[String(p.PRECINCT)];
  if (!r || r.total === 0 || !r.winner) return tm().noData;
  // Non-partisan / single-party race: "Winning Party" is a candidate-name
  // fragment, not Rep/Dem, so PARTY_COLORS would fall through to gray. Fill by
  // the winner's margin on a neutral ramp instead (decisiveness, not party).
  if (cc.race.partisan === false) {
    const bin = marginBin(r.margin || 0);
    return patternFill(svgRoot(), "dots", bin, RAMPS.nonpartisan[bin]);
  }
  const bg = PARTY_COLORS[r.winner] || PARTY_COLORS.default;
  return patternFill(svgRoot(), partyKind(r.winner), 2, bg);
}

// The distinct texture for "was part of the map but not on this ballot" —
// readable (unlike the old 0.06 opacity ghost) and different from no-data gray.
function notOnBallotFill() {
  return patternFill(svgRoot(), "cross", 2, tm().notBallot);
}

// Primary energy: which party's primary drew more ballots, in the exact lean
// visual language (party pattern, denser = more one-sided). Official county
// reports via data/…/profile/primary_turnout.csv; absent → no-data gray.
const PRIMARY_YEAR = 2026;
function primaryFill(p) {
  const rec = cc.primary?.[String(p.PRECINCT)]?.[PRIMARY_YEAR];
  if (!rec || rec.dem + rec.rep === 0) return tm().noData;
  const share = rec.dem / (rec.dem + rec.rep);
  const party = share >= 0.5 ? "Dem" : "Rep";
  const diff = Math.abs(share - 0.5);
  const level = diff < 0.05 ? 1 : diff < 0.15 ? 2 : 3;
  const ramp = PARTY_STRENGTH_COLORS[party];
  return patternFill(svgRoot(), partyKind(party), level, ramp[level] || ramp.default);
}

function fillFor(p) {
  if (cc.raceId) return raceFill(p);
  if (cc.mode === "margin") return marginFill(p);
  if (cc.mode === "diversity") return diversityFill(p);
  if (cc.mode === "primary") return primaryFill(p);
  return leanFill(p);
}

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
    fillColor: offBallot ? notOnBallotFill() : fillFor(feature.properties),
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
  cc.renderer = useCanvasRenderer ? L.canvas() : L.svg({ padding: 0.3 });
  cc.map = L.map("cc-map", {
    zoomControl: false, // added below at top-right so it never collides with the Lean/Margin/Diversity switch (top-left)
    attributionControl: true,
    renderer: cc.renderer,
    zoomSnap: 0,
    minZoom: 6,
    maxZoom: 16,
  });
  L.control.zoom({ position: "topright" }).addTo(cc.map);

  // The map region announces how to drive it without a pointer.
  const mapEl = $("cc-map");
  mapEl.setAttribute("role", "application");
  mapEl.setAttribute(
    "aria-label",
    "Precinct map. Press Tab to enter the precincts, arrow keys to move between them, Enter to open a precinct's details."
  );

  // Subtle basemap underlay (geographic grounding) — swaps with theme.
  cc.tiles = L.tileLayer(BASEMAP, {
    attribution: BASEMAP_ATTR,
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(cc.map);

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
  cc.kb = [];
  if (!cc.layer || useCanvasRenderer) return;
  cc.layer.eachLayer((l) => { if (l._path) cc.kb.push(l); });
  cc.kb.sort((a, b) => {
    const ca = String(a.feature.properties.PRECINCT), cb = String(b.feature.properties.PRECINCT);
    return (parseInt(ca, 10) || 0) - (parseInt(cb, 10) || 0) || ca.localeCompare(cb);
  });
  cc.kb.forEach((l, i) => {
    const path = l._path;
    path.setAttribute("role", "button");
    path.setAttribute("tabindex", i === 0 ? "0" : "-1");
    path.setAttribute("aria-label", describePrecinct(l.feature.properties, describeCtx()));
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
  if (useCanvasRenderer) return;
  $("cc-map").addEventListener("keydown", (e) => {
    const idx = cc.kb.findIndex((l) => l._path === e.target);
    if (idx === -1) return;
    const move = (to) => {
      const next = cc.kb[Math.max(0, Math.min(cc.kb.length - 1, to))];
      if (!next) return;
      cc.kb.forEach((l) => l._path.setAttribute("tabindex", l === next ? "0" : "-1"));
      next._path.focus();
      next._path.scrollIntoView?.({ block: "nearest" });
    };
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": e.preventDefault(); move(idx + 1); break;
      case "ArrowLeft": case "ArrowUp": e.preventDefault(); move(idx - 1); break;
      case "Home": e.preventDefault(); move(0); break;
      case "End": e.preventDefault(); move(cc.kb.length - 1); break;
      case "Enter": case " ": e.preventDefault(); selectPrecinct(String(cc.kb[idx].feature.properties.PRECINCT)); break;
    }
  });
}

// ---------------------------------------------------------------------------
// Precinct-number chips: at close zoom every big-enough polygon carries its
// number on a solid backplate — the number is on the map itself, not hidden
// behind a hover. Small polygons stay unlabelled (declutter); their number is
// one tap away in the readout.
// ---------------------------------------------------------------------------
function updatePrecinctLabels() {
  if (cc.labelLayer) { cc.labelLayer.remove(); cc.labelLayer = null; }
  if (!cc.map || !cc.layer || cc.map.getZoom() < 11) return;
  const markers = [];
  cc.layer.eachLayer((l) => {
    let b;
    try { b = l.getBounds(); } catch (_) { return; }
    if (!b || !b.isValid()) return;
    const p1 = cc.map.latLngToContainerPoint(b.getNorthWest());
    const p2 = cc.map.latLngToContainerPoint(b.getSouthEast());
    if (Math.abs(p2.x - p1.x) < 62 || Math.abs(p2.y - p1.y) < 36) return; // too small for a chip
    const code = String(l.feature.properties.PRECINCT).split(":").pop();
    markers.push(
      L.marker(b.getCenter(), {
        icon: L.divIcon({ className: "cc-plabel-wrap", html: `<span class="cc-plabel">${escapeHtml(code)}</span>` }),
        interactive: false,
        keyboard: false,
      })
    );
  });
  if (markers.length) cc.labelLayer = L.layerGroup(markers).addTo(cc.map);
}

function fitMap() {
  try {
    const b = cc.layer.getBounds();
    if (b.isValid()) { cc.map.fitBounds(b, { padding: [30, 30] }); return; }
  } catch (_) { /* fall through */ }
  cc.map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
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
  if (!cc.selectedCode) { hideReadout(); return; }
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
  const features = cc.geojson.features;
  const entry = registryCache?.find((x) => x.slug === getActiveCounty());
  const b = buildCountyBriefing(features, { countyName: cc.countyName, isDistrict: entry?.kind === "district" });

  $("cc-dock-eyebrow").textContent = "County Briefing";
  $("cc-dock-title").textContent = `${cc.countyName} County`;
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

    ${disclosureHTML(
      "cc-more-county",
      "Show more county detail",
      `
      ${deeplink("elections.html", "search", "Elections Catalog", "Browse every race")}
      ${deeplink("forecast.html", "chart", "Forecast Tool", "Build turnout scenarios")}
      ${deeplink("precinct.html", "pin", "Precinct Report", "Door-knock one-pagers")}
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
    ${deeplink(`targets.html#county=${encodeURIComponent(getActiveCounty())}&race=${encodeURIComponent(cc.raceId)}&strategy=tossups`, "target", "Find flip targets", "Rank these precincts by flip / defend — pre-filtered to this race")}
    ${deeplink("elections.html", "search", "Elections Catalog", "Browse & open another race")}

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
      ${margin != null ? `<span class="cc-pill ${margin < 0.1 ? "gold" : ""}">${margin < 0.1 ? "Competitive" : "Safe"} · decided by ${fmtPct(margin)}</span>` : ""}
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
    await setMapBoundary(preferredDemographicBoundary()); // back to current precincts
  }
  document.querySelectorAll(".cc-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
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
function legendRow(fill, label) {
  return `<div class="cc-legend-row">${swatchSVG(fill)}<span>${label}</span></div>`;
}

function binRows(kind, ramp) {
  return legendBins(kind)
    .map((b) => legendRow(patternFill(svgRoot(), "dots", b.index, ramp[b.index]), `${escapeHtml(b.name)} — ${escapeHtml(b.range)}`))
    .join("");
}

function renderLegend() {
  const el = $("cc-legend");
  const notBallotRow = legendRow(notOnBallotFill(), "Not on this ballot");
  const noDataRow = legendRow(tm().noData, "No data (N/A)");

  if (cc.raceId && cc.race) {
    // Non-partisan / single-party race: neutral decisiveness bins, not Rep/Dem.
    if (cc.race.partisan === false) {
      el.innerHTML = `
        <div class="cc-legend-title">${escapeHtml(cc.race.label)}</div>
        <p class="cc-legend-desc">How decisively the leading candidate won each precinct.</p>
        ${binRows("margin", RAMPS.nonpartisan)}
        ${notBallotRow}
        <p class="cc-legend-desc">Showing one race — tap Lean, Margin, or Diversity above to go back to the county overview.</p>`;
      return;
    }
    el.innerHTML = `
      <div class="cc-legend-title">${escapeHtml(cc.race.label)}</div>
      <p class="cc-legend-desc">Which party won each precinct in this race. Stripes lean with the party: Republican ↗, Democratic —.</p>
      ${legendRow(patternFill(svgRoot(), "diag", 2, PARTY_COLORS.Rep), "Republican win")}
      ${legendRow(patternFill(svgRoot(), "horiz", 2, PARTY_COLORS.Dem), "Democratic win")}
      ${legendRow(patternFill(svgRoot(), "dots", 2, PARTY_COLORS.Mod || "#800080"), "Other / Moderate win")}
      ${notBallotRow}
      ${cc.otherPrecinctLayer ? legendRow(patternFill(svgRoot(), "diag", 2, PARTY_COLORS.Rep), "Other county · precinct-level") : ""}
      ${cc.otherLayer ? `<div class="cc-legend-row"><span class="cc-legend-sw cc-sw-dash"></span><span>County total (dashed outline)</span></div>` : ""}
      <p class="cc-legend-desc">Showing one race — tap Lean, Margin, or Diversity above to go back to the county overview.</p>`;
    return;
  }
  if (cc.mode === "lean") {
    const P = PARTY_STRENGTH_COLORS;
    el.innerHTML = `
      <div class="cc-legend-title">Party Lean</div>
      <p class="cc-legend-desc">Which party each precinct usually favors. Denser stripes = stronger habit.</p>
      ${legendRow(patternFill(svgRoot(), "diag", 3, P.Rep[3]), "Strong Republican")}
      ${legendRow(patternFill(svgRoot(), "diag", 1, P.Rep[1]), "Slight Republican")}
      ${legendRow(patternFill(svgRoot(), "horiz", 1, P.Dem[1]), "Slight Democratic")}
      ${legendRow(patternFill(svgRoot(), "horiz", 3, P.Dem[3]), "Strong Democratic")}
      ${legendRow(patternFill(svgRoot(), "dots", 2, P.Mod ? P.Mod[2] : "#B19CD9"), "Moderate / mixed")}
      ${noDataRow}`;
  } else if (cc.mode === "margin") {
    el.innerHTML = `
      <div class="cc-legend-title">Victory Margin</div>
      <p class="cc-legend-desc">How close the vote was, in percentage points. Denser dots = more lopsided.</p>
      ${binRows("margin", RAMPS.margin)}
      ${noDataRow}`;
  } else if (cc.mode === "primary") {
    const P = PARTY_STRENGTH_COLORS;
    el.innerHTML = `
      <div class="cc-legend-title">${PRIMARY_YEAR} Primary Ballots</div>
      <p class="cc-legend-desc">Which party's ${PRIMARY_YEAR} primary drew more voters here. Denser stripes = more one-sided. Source: official county reports.</p>
      ${legendRow(patternFill(svgRoot(), "diag", 3, P.Rep[3]), "Strongly Republican primary")}
      ${legendRow(patternFill(svgRoot(), "diag", 1, P.Rep[1]), "Slightly Republican primary")}
      ${legendRow(patternFill(svgRoot(), "horiz", 1, P.Dem[1]), "Slightly Democratic primary")}
      ${legendRow(patternFill(svgRoot(), "horiz", 3, P.Dem[3]), "Strongly Democratic primary")}
      ${noDataRow}`;
  } else {
    el.innerHTML = `
      <div class="cc-legend-title">Non-White Share</div>
      <p class="cc-legend-desc">Share of residents who are not non-Hispanic white (Census).</p>
      ${binRows("diversity", RAMPS.diversity)}
      ${noDataRow}`;
  }
}

// The dark "War Room" theme was retired (June 2026 civic-plain redesign).
// Clear any stale saved preference so old sessions don't carry it around.
function clearLegacyTheme() {
  document.documentElement.removeAttribute("data-theme");
  try { localStorage.removeItem("cc_theme"); localStorage.removeItem("ccd_theme"); } catch (_) { /* ignore */ }
}

// =============================================================================
// COUNTY SWITCHING
// =============================================================================
let registryCache = null;

async function populateCountyMenu() {
  const registry = await loadCountyRegistry();
  // Collin plus the Collin-touching districts (CD/SD/HD). District entries lack a
  // FIPS code; they're valid map subjects, so list them as switchable too.
  registryCache = registry.filter((c) => c.status === "live");
  renderCountyList("");
}

function renderCountyList(filter) {
  const list = $("cc-county-list");
  const active = getActiveCounty();
  const f = filter.toLowerCase();
  const items = registryCache
    .filter((c) => c.name.toLowerCase().includes(f))
    .slice(0, 60)
    .map(
      (c) => `
      <div class="cc-county-opt ${c.slug === active ? "active" : ""}" data-slug="${c.slug}">
        <span>${escapeHtml(c.name)}</span><small>${escapeHtml(c.fips || c.group || "District")}</small>
      </div>`
    )
    .join("");
  list.innerHTML = items || `<div class="cc-county-opt" style="cursor:default;color:var(--ink-faint)">No match</div>`;
}

// One source of truth for "what county am I looking at" — drives the topbar
// label AND the browser tab title, so branding follows the active county
// instead of being hardcoded to Collin.
function applyCountyBranding(name, isDistrict = false) {
  cc.countyName = name;
  const label = isDistrict ? name : `${name} County`;
  $("cc-county-name").textContent = label;
  document.title = `${label} — Elections Map`;
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
// BOUNDARY VINTAGE — the demographic map (lean/margin/diversity) shows the
// CURRENT precincts (2026 redistricting); real election results are shown on the
// precincts they were actually cast under (2024). The map swaps boundary set as
// you enter/leave a race.
// =============================================================================

// The boundary the demographic view should sit on: prefer 2026 where the county
// has it (Collin), else whatever the registry default is (every other county has
// just one set, so this is a no-op for them).
function preferredDemographicBoundary() {
  const configs = getBoundaryConfigs();
  return configs["2026"] ? "2026" : getActiveBoundary();
}

// Load the optional party-primary turnout extra and show/hide the Primary map
// mode accordingly. Counties without the file just never show the button.
async function refreshPrimaryTurnout() {
  cc.primary = await loadPrimaryTurnout();
  const btn = document.querySelector('.cc-mode-btn[data-mode="primary"]');
  if (btn) btn.style.display = cc.primary ? "" : "none";
  if (!cc.primary && cc.mode === "primary") { await setMode("lean"); return; }
  // The layer may have been built before this data arrived — repaint if showing.
  if (cc.mode === "primary") { restyle(); decorateMapPaths(); renderLegend(); }
}

// Set the active boundary before the FIRST data load (no layer to rebuild yet).
// Safe to call when nothing is loaded — setActiveBoundary clears the cache.
function setInitialBoundary(boundaryId) {
  if (getBoundaryConfigs()[boundaryId] && getActiveBoundary() !== boundaryId) {
    setActiveBoundary(boundaryId);
  }
}

// Switch the LIVE map to a different boundary set: reload that set's geojson +
// demographic data and rebuild the precinct layer in place (keeps the current
// view — no refit, since a county's two boundary sets share an extent).
async function setMapBoundary(boundaryId) {
  if (!getBoundaryConfigs()[boundaryId] || getActiveBoundary() === boundaryId) return;
  setActiveBoundary(boundaryId); // clears the data cache
  const { geojson } = await loadAllData();
  cc.geojson = geojson;
  // A precinct selected on the old set may not exist on the new one (252 ↔ 273).
  if (cc.selectedCode && !geojson.features.some((f) => String(f.properties.PRECINCT) === cc.selectedCode)) {
    cc.selectedCode = null;
  }
  if (cc.layer) cc.layer.remove();
  cc.layer = L.geoJSON(geojson, { style: baseStyle, onEachFeature: attachFeature }).addTo(cc.map);
  decorateMapPaths();
  updatePrecinctLabels();
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

async function switchCounty(slug, name) {
  showLoading(true);
  closeCountyMenu();
  try {
    await setActiveCounty(slug);
    setInitialBoundary(preferredDemographicBoundary()); // open on current precincts
    const { geojson } = await loadAllData();
    cc.geojson = geojson;
    cc.selectedCode = null;
    cc.raceId = null; cc.race = null; // races are county-specific
    removeOtherLayer();
    // Districts brand without the "County" suffix (e.g. "Congressional District 3").
    const entry = registryCache?.find((c) => c.slug === slug);
    applyCountyBranding(name, entry?.kind === "district");
    applyRaceLabel();
    // rebuild map layer
    if (cc.layer) { cc.layer.remove(); }
    cc.layer = L.geoJSON(geojson, { style: baseStyle, onEachFeature: attachFeature }).addTo(cc.map);
    decorateMapPaths();
    updatePrecinctLabels();
    hideReadout();
    fitMap();
    renderLegend();
    await refreshPrimaryTurnout();
    await populateRaceMenu();
    renderCountyBriefing();
    if (cc.view === "list") renderListView();
  } catch (err) {
    console.error("[Command] county switch failed:", err);
    $("cc-dock-sub").textContent = "Failed to load this county's data.";
  } finally {
    showLoading(false);
  }
}

function openCountyMenu() { $("cc-county-menu").classList.add("open"); $("cc-county-search").focus(); }
function closeCountyMenu() { $("cc-county-menu").classList.remove("open"); }

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
  return { total, rep, dem, winner, winnerName: total > 0 ? row["Winning Candidate"] : null, margin };
}

async function populateRaceMenu() {
  try {
    cc.races = await listElectionCSVs();
  } catch (_) { cc.races = []; }
  renderRaceList("");
}

// The 12 Collin-touching districts we keep data for.
const KEPT_DISTRICTS = new Set(["cd-3", "cd-32", "cd-4", "hd-33", "hd-61", "hd-66", "hd-67", "hd-70", "hd-89", "sd-2", "sd-30", "sd-8"]);

// Federal / state DISTRICT races span multiple counties. Map a Collin race to
// its district slug so we can pull in the non-Collin counties' results.
function districtSlugFor(entry) {
  const office = (entry.office || "").toLowerCase();
  const d = entry.district;
  if (d == null || d === "") return null;
  let slug = null;
  if (office.includes("representative") && (office.includes("united states") || office.includes("u.s") || office.includes("u s") || office.includes("congress"))) slug = `cd-${d}`;
  else if (office.includes("senator") || office.includes("senate")) slug = `sd-${d}`;
  else if (office.includes("representative")) slug = `hd-${d}`; // state house (after US handled)
  return slug && KEPT_DISTRICTS.has(slug) ? slug : null;
}

const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Load the non-Collin counties' aggregate results for a district race. The
// district data keeps Collin at precinct level and every other county collapsed
// to "<county>:ALL" rows — exactly the multi-county info to fold back in.
async function loadDistrictAggregates(slug, raceFile) {
  try {
    const txt = await fetch(`data/tx/districts/${slug}/data/${raceFile}`).then((r) => (r.ok ? r.text() : null));
    if (!txt) return { byCounty: [], byPrecinct: {} };
    const lines = txt.trim().split("\n");
    const agg = {};       // countySlug -> running county total
    const pre = {};       // full code "hunt:101" -> { rep, dem, total }
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      const pc = c[0];
      // Fold in every non-Collin row — whether a collapsed "<county>:ALL" total
      // or real "<county>:<precinct>" rows (e.g. Hunt's official Clarity data) —
      // so the county outline/dock total is correct at any granularity.
      if (!pc || !pc.includes(":")) continue;
      const county = pc.split(":")[0];
      if (county === "collin") continue;
      const party = (c[1] || "").toUpperCase();
      if (!party) continue; // skip Over/Under/Write-in
      const votes = +c[3] || 0;
      const a = agg[county] || (agg[county] = { county, rep: 0, dem: 0, total: 0 });
      a.total += votes;
      if (party === "REP") a.rep += votes;
      else if (party === "DEM") a.dem += votes;
      if (!pc.endsWith(":ALL")) { // real precinct row → keep per-precinct result too
        const p = pre[pc] || (pre[pc] = { rep: 0, dem: 0, total: 0 });
        p.total += votes;
        if (party === "REP") p.rep += votes;
        else if (party === "DEM") p.dem += votes;
      }
    }
    const byCounty = Object.values(agg).filter((a) => a.total > 0).map((a) => ({ ...a, winner: a.rep >= a.dem ? "Rep" : "Dem" }));
    const byPrecinct = {};
    for (const code in pre) {
      const p = pre[code];
      if (p.total <= 0) continue;
      byPrecinct[code] = { ...p, winner: p.rep >= p.dem ? "Rep" : "Dem", margin: Math.abs(p.rep - p.dem) / p.total };
    }
    return { byCounty, byPrecinct };
  } catch (_) {
    return { byCounty: [], byPrecinct: {} };
  }
}

// Real precinct geometry for non-Collin counties we've sourced (Hunt CD-3 so far,
// data_processor/fetch_district_county_precincts.py). Absent → those counties
// fall back to a county outline.
async function loadDistrictPrecinctGeo(slug) {
  try {
    return await fetch(`data/tx/districts/${slug}/boundaries/other_precincts.geojson`).then((r) => (r.ok ? r.json() : null));
  } catch (_) {
    return null;
  }
}

// Dissolved outline of each non-Collin county's portion of the district (built
// from the pre-reduction precinct geometry — data_processor/build_district_county_outlines.py).
// One feature per county, keyed "<county-slug>:ALL" to join the aggregate result.
async function loadDistrictOutlines(slug) {
  try {
    return await fetch(`data/tx/districts/${slug}/boundaries/county_outlines.geojson`).then((r) => (r.ok ? r.json() : null));
  } catch (_) {
    return null;
  }
}

// Race-picker groups, in display order. The marquee contests come first and
// open by default; the hundreds of city/school/utility races stay behind
// closed headers so the list starts at a readable size.
const RACE_GROUP_DEFS = [
  { key: "Federal", label: "Federal — President & Congress" },
  { key: "State", label: "State — Governor & Legislature" },
  { key: "County", label: "County offices" },
  { key: "City", label: "City councils & mayors" },
  { key: "ISD", label: "School districts (ISD)" },
  { key: "MUD", label: "Utility districts (MUD)" },
];
const openRaceGroups = new Set(["Federal"]);

function raceOptHTML(e) {
  const id = e.raceKey || e.filename;
  const label = String(e.displayName || e.office || id);
  const year = String(e.year || "");
  const badge = year && !label.includes(year) ? year : "";
  return `<div class="cc-county-opt ${id === cc.raceId ? "active" : ""}" data-race="${escapeHtml(id)}">
    <span>${escapeHtml(label)}</span>${badge ? `<small>${escapeHtml(badge)}</small>` : ""}</div>`;
}

function renderRaceList(filter) {
  const list = $("cc-race-list");
  if (!list) return;
  const f = filter.toLowerCase().trim();
  let html = `<div class="cc-county-opt ${cc.raceId ? "" : "active"}" data-race="">
      <span>Overview — no race selected</span></div>`;
  if (f) {
    // Typing searches every race, flat.
    html += cc.races
      .filter((e) => (e.displayName || e.office || e.filename || "").toLowerCase().includes(f))
      .slice(0, 80)
      .map(raceOptHTML)
      .join("");
    list.innerHTML = html;
    return;
  }
  const byYearDesc = (a, b) =>
    (+b.year || 0) - (+a.year || 0) ||
    String(a.displayName || a.office || "").localeCompare(String(b.displayName || b.office || ""));
  const grouped = new Map(RACE_GROUP_DEFS.map((g) => [g.key, []]));
  const other = [];
  for (const e of cc.races) (grouped.get(e.category) || other).push(e);
  const groups = other.length
    ? [...RACE_GROUP_DEFS, { key: "Other", label: "Other races" }]
    : RACE_GROUP_DEFS;
  for (const g of groups) {
    const entries = g.key === "Other" ? other : grouped.get(g.key);
    if (!entries.length) continue;
    entries.sort(byYearDesc);
    const open = openRaceGroups.has(g.key);
    html += `<button type="button" class="cc-race-group" data-group="${g.key}" aria-expanded="${open}">
      <span>${escapeHtml(g.label)}</span><small>${entries.length} race${entries.length === 1 ? "" : "s"} ${open ? "▴" : "▾"}</small></button>`;
    if (open) html += entries.map(raceOptHTML).join("");
  }
  list.innerHTML = html;
}

function applyRaceLabel() {
  const el = $("cc-race-name");
  if (el) el.textContent = cc.race ? cc.race.label : "Choose a race";
  // While a race is showing the demographic modes are inactive: mute them
  // visually AND semantically (picking one still exits the race — allowed).
  const modes = $("cc-modes");
  if (modes) {
    modes.style.opacity = cc.raceId ? "0.45" : "1";
    modes.querySelectorAll(".cc-mode-btn").forEach((b) => {
      if (cc.raceId) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
    });
  }
}

async function loadRace(raceIdOrEntry) {
  const entry = typeof raceIdOrEntry === "object"
    ? raceIdOrEntry
    : cc.races.find((e) => (e.raceKey || e.filename) === raceIdOrEntry);
  if (!entry) return;
  showLoading(true);
  try {
    // 2026-only app: every race renders on the current (2026) precincts. Older
    // races use the official results carefully re-drawn onto the new boundaries.
    const rows = await loadElectionData(entry);
    const byPrecinct = {};
    for (const row of rows) byPrecinct[String(row["PRECINCT CODE"])] = precinctRaceResult(row);
    cc.raceId = entry.raceKey || entry.filename;
    // Keep this race's group open so reopening the picker shows the selection.
    openRaceGroups.add(RACE_GROUP_DEFS.some((g) => g.key === entry.category) ? entry.category : "Other");
    cc.race = { id: cc.raceId, label: entry.displayName || entry.office || cc.raceId, byPrecinct,
      partisan: isPartisanRace(rows),
      otherCounties: [], otherByCounty: {}, otherPrecincts: {}, otherGeojson: null, precinctGeo: null, precinctCounties: new Set() };
    // For multi-county federal/state DISTRICT races, fold in the other counties.
    // Each non-Collin county is drawn at PRECINCT level where we have its precinct
    // geometry + per-precinct results (Hunt CD-3); otherwise as one county outline.
    const slug = districtSlugFor(entry);
    if (slug && entry.raceFile) {
      const ex = await loadDistrictAggregates(slug, entry.raceFile);
      cc.race.otherCounties = ex.byCounty;
      cc.race.otherByCounty = Object.fromEntries(ex.byCounty.map((o) => [o.county, o]));
      cc.race.otherPrecincts = ex.byPrecinct;
      if (ex.byCounty.length) {
        cc.race.otherGeojson = await loadDistrictOutlines(slug);
        cc.race.precinctGeo = await loadDistrictPrecinctGeo(slug);
        if (cc.race.precinctGeo) {
          for (const f of cc.race.precinctGeo.features) {
            if (ex.byPrecinct[String(f.properties.PRECINCT)]) cc.race.precinctCounties.add(f.properties.countySlug);
          }
        }
      }
    }
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
    showLoading(false);
  }
}

async function clearRace() {
  if (!cc.raceId) return;
  const hadOthers = !!(cc.race && (cc.race.otherGeojson || cc.race.precinctGeo));
  cc.raceId = null; cc.race = null;
  removeOtherLayer();
  applyRaceLabel();
  updateHash();
  // Return the map to the current-precinct demographic view (2026 where available).
  await setMapBoundary(preferredDemographicBoundary());
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
    : notOnBallotFill();
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
    : notOnBallotFill();
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

function restyleOther() {
  if (cc.otherLayer) cc.otherLayer.eachLayer((l) => l.setStyle(otherStyle(l.feature)));
  if (cc.otherPrecinctLayer) cc.otherPrecinctLayer.eachLayer((l) => l.setStyle(otherPrecinctStyle(l.feature)));
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

function openRaceMenu() { $("cc-race-menu").classList.add("open"); $("cc-race-search").focus(); }
function closeRaceMenu() { $("cc-race-menu").classList.remove("open"); }

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
  const entry = registryCache?.find((x) => x.slug === getActiveCounty());

  // headline: race label when a race is showing, county "so what" otherwise
  const headline = cc.raceId && cc.race
    ? `${cc.race.label} — precinct by precinct.`
    : buildCountyBriefing(cc.geojson.features, { countyName: cc.countyName, isDistrict: entry?.kind === "district" }).headline;
  $("cc-list-headline").textContent = headline;

  const rows = sortRows(buildRows(cc.geojson.features, ctx), cc.listSort);
  $("cc-list-count").textContent = countLine(rows, cc.listSort);
  if (cc.cancelListRender) cc.cancelListRender();
  cc.cancelListRender = renderRows($("cc-list-body"), rows, getActiveCounty());
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

  // county menu
  $("cc-county-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("cc-county-menu");
    menu.classList.contains("open") ? closeCountyMenu() : openCountyMenu();
  });
  $("cc-county-search").addEventListener("input", (e) => renderCountyList(e.target.value));
  // Keyboard path: Enter selects the first matching county (no mouse needed).
  $("cc-county-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = $("cc-county-list").querySelector(".cc-county-opt[data-slug]");
    if (!first) return;
    const entry = registryCache.find((c) => c.slug === first.dataset.slug);
    switchCounty(first.dataset.slug, entry ? entry.name : first.dataset.slug);
  });
  $("cc-county-list").addEventListener("click", (e) => {
    const opt = e.target.closest(".cc-county-opt");
    if (!opt || !opt.dataset.slug) return;
    // Resolve the display name from the registry — never scrape it off the
    // option text (which concatenates the FIPS code badge).
    const entry = registryCache.find((c) => c.slug === opt.dataset.slug);
    switchCounty(opt.dataset.slug, entry ? entry.name : opt.dataset.slug);
  });
  document.addEventListener("click", (e) => {
    const sel = document.querySelector(".cc-county-select");
    if (sel && !sel.contains(e.target)) closeCountyMenu();
  });

  // race menu
  $("cc-race-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("cc-race-menu").classList.contains("open") ? closeRaceMenu() : openRaceMenu();
  });
  $("cc-race-search").addEventListener("input", (e) => renderRaceList(e.target.value));
  $("cc-race-list").addEventListener("click", (e) => {
    const group = e.target.closest(".cc-race-group");
    if (group) {
      const key = group.dataset.group;
      openRaceGroups.has(key) ? openRaceGroups.delete(key) : openRaceGroups.add(key);
      renderRaceList($("cc-race-search").value || "");
      return;
    }
    const opt = e.target.closest(".cc-county-opt[data-race]");
    if (!opt) return;
    closeRaceMenu();
    const id = opt.dataset.race;
    id ? loadRace(id) : clearRace();
  });
  document.addEventListener("click", (e) => {
    const sel = $("cc-race-select");
    if (sel && !sel.contains(e.target)) closeRaceMenu();
  });

  // precinct quick-search: a number jumps straight to that precinct; anything
  // with letters is treated as a street address (same heuristic as the
  // Find a Precinct page).
  $("cc-precinct-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim();
    if (!q) return;
    if (/[a-zA-Z]/.test(q) || q.length > 4) { findByAddress(q); return; }
    const layer = findLayerByCode(q);
    if (layer) { selectPrecinct(q); }
    else { searchStatus(`No precinct "${q}" here. You can also type a street address.`); }
  });

  // "My location" — find the precinct the user is standing in.
  $("cc-locate-btn").addEventListener("click", findByLocation);

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

  // readout card: "Full details" opens/focuses the dock briefing
  $("cc-readout-more").addEventListener("click", () => {
    openDockMobile();
    const title = $("cc-dock-title");
    title.setAttribute("tabindex", "-1");
    title.focus();
  });

  // tablet/phone: the details dock is a slide-over — give it a visible toggle
  $("cc-dock-toggle").addEventListener("click", () => $("cc-dock").classList.toggle("open"));

  // Escape closes menus / mobile dock
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeCountyMenu(); closeRaceMenu(); $("cc-dock").classList.remove("open"); }
  });
}

// =============================================================================
// ADDRESS / LOCATION SEARCH — plain-language status goes to the dock subtitle
// (same error copy as the Find a Precinct page).
// =============================================================================
function searchStatus(msg) {
  $("cc-dock-sub").textContent = msg;
  openDockMobile();
}

async function findByAddress(query) {
  searchStatus("Looking up that address…");
  try {
    const result = await findPrecinctForAddress(query, cc.geojson.features, fetch, TEXAS_VIEWBOX);
    if (!result) {
      searchStatus(`Couldn't find “${query}”. Try adding the city, e.g. “123 Main St, McKinney”.`);
      return;
    }
    if (!result.code) {
      searchStatus("That address appears to be outside this map's precincts.");
      return;
    }
    selectPrecinct(result.code);
  } catch (err) {
    console.error("[Command] address lookup failed:", err);
    searchStatus("The address search service is unavailable right now. Please try again in a moment.");
  }
}

function findByLocation() {
  if (!navigator.geolocation) {
    searchStatus("Your browser doesn't support location lookup. Type your address instead.");
    return;
  }
  searchStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const feature = findPrecinctForPoint(pos.coords.latitude, pos.coords.longitude, cc.geojson.features);
      if (feature) selectPrecinct(String(feature.properties.PRECINCT));
      else searchStatus("Your current location appears to be outside this map's precincts.");
    },
    () => searchStatus("Couldn't get your location. You can type your street address instead."),
    { timeout: 12000 }
  );
}

// hash params (county / race) for deep links + shareable state — via the one
// urlState vocabulary (REDESIGN.md §5.3)
function readHashParams() {
  return readParams();
}
function updateHash() {
  writeParams({
    county: getActiveCounty(),
    race: cc.raceId || null,
    precinct: cc.selectedCode || null,
    view: cc.view === "list" ? "list" : null,
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
    await populateCountyMenu();
    // Honour a #county= deep link — including a district slug (e.g. hd-89 from
    // Targets), which isn't in the county menu but is a valid map subject.
    const fullRegistry = await loadCountyRegistry();
    if (params.county && fullRegistry.find((c) => c.slug === params.county && c.status === "live")) {
      try { await setActiveCounty(params.county); } catch (_) { /* keep default */ }
    } else {
      // Load the default county's registry entry now so getBoundaryConfigs() is
      // populated before we choose the demographic boundary below (otherwise the
      // entry isn't cached until loadAllData and the 2026 default is missed).
      try { await setActiveCounty(getActiveCounty()); } catch (_) { /* keep default */ }
    }
    const activeEntry = fullRegistry.find((c) => c.slug === getActiveCounty());
    applyCountyBranding(activeEntry ? activeEntry.name : "Collin", activeEntry && activeEntry.kind === "district");
    setInitialBoundary(preferredDemographicBoundary()); // open on current (2026) precincts
    const { geojson } = await loadAllData();
    cc.geojson = geojson;
    buildMap(geojson);
    await refreshPrimaryTurnout();
    await populateRaceMenu();
    renderDataNote();
    // A #race= deep link (e.g. from the Elections catalog) shows that race.
    if (params.race) await loadRace(params.race);
    else renderCountyBriefing();
    // A #precinct= deep link (e.g. from Targets' "Map" link) jumps to + selects it.
    if (params.precinct && cc.geojson.features.some((f) => String(f.properties.PRECINCT) === params.precinct)) {
      selectPrecinct(params.precinct);
    }
    // A #view=list deep link opens the linear view directly.
    if (params.view === "list") setView("list");
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
