// matchupPage.js
// --------------------------------------------------------------------------------
// Orchestrator for matchup.html — the 2026 general-election matchup projector
// (campaign persona's second tab; the page itself works standalone for anyone).
// Flow: pick an office with both 2026 primaries → each party's primary field
// loads with the March leader pre-selected (overridable — runoffs happen) →
// pick a baseline general election (the environment) → the domain layer
// synthesizes a two-candidate race from the baseline's per-precinct two-party
// vote → the turnout simulator applies presets/sliders/persuasion → headline,
// flipped-precinct chips, and a restyle-only precinct map.
//
// Performance contract (campaignPage precedent): the Leaflet layer is built
// exactly once; every scenario change re-runs the simulation and only
// RESTYLES the polygons. Slider drags are debounced.

import { boundary } from "./data/dataService.js";
import { getCandidateColumns } from "./electionSchema.js";
import { runFullSimulation } from "./domain/simulator.js";
import {
  pairPrimaryOffices,
  primaryField,
  synthesizeMatchup,
  matchupParticipation,
  toRaceEnvByPrecinct,
  countyHeadline,
} from "./domain/matchup.js";
import { PARTY_COLORS } from "./lib/constants.js";
import { escapeHtml } from "./lib/dom.js";
import { formatPrecinctLabel } from "./lib/format.js";
import { readParams, writeParams } from "./lib/urlState.js";
import {
  createMapView,
  fitToLayer,
  decoratePrecinctPaths,
  wirePrecinctKeyboard,
} from "./map/mapView.js";
import { fillFor, notOnBallotFill, MAP_COSMETICS } from "./map/mapStyles.js";
import { describePrecinct, partyName } from "./map/mapBins.js";
import { patternFill, partyKind, swatchSVG } from "./map/mapPatterns.js";

// Same scenario presets as the forecast page (page copy, not engine logic).
const PRESETS = [
  { id: "baseline", name: "Baseline environment", desc: "Turnout exactly as in the baseline election", m: { Rep: 1.0, Mod: 1.0, Dem: 1.0 } },
  { id: "dem-surge", name: "Democratic surge", desc: "Dem voters turn out 25% stronger", m: { Rep: 1.0, Mod: 1.0, Dem: 1.25 } },
  { id: "rep-surge", name: "Republican surge", desc: "Rep voters turn out 25% stronger", m: { Rep: 1.25, Mod: 1.0, Dem: 1.0 } },
  { id: "high", name: "Everyone shows up", desc: "All groups +25% turnout", m: { Rep: 1.25, Mod: 1.25, Dem: 1.25 } },
  { id: "low", name: "Rainy Tuesday", desc: "All groups −25% turnout", m: { Rep: 0.75, Mod: 0.75, Dem: 0.75 } },
  { id: "custom", name: "Custom", desc: "Set each slider yourself", m: null },
];

const SLIDER_GROUPS = [
  { key: "Rep", label: "Republican-leaning voters", color: "var(--color-rep-text)" },
  { key: "Mod", label: "Moderate / swing voters", color: "var(--color-mod)" },
  { key: "Dem", label: "Democratic-leaning voters", color: "var(--color-dem-text)" },
];

// Persuasion sliders (percent 0–25; the engine clamps rates to [0, 0.25]).
const FLIPS = [
  { key: "Rep→Dem", param: "rd", label: "Republican → Democratic" },
  { key: "Dem→Rep", param: "dr", label: "Democratic → Republican" },
  { key: "Mod→Dem", param: "md", label: "Moderate → Democratic" },
  { key: "Mod→Rep", param: "mr", label: "Moderate → Republican" },
];

// Marquee baseline generals listed first in the baseline select.
const FEATURED_BASELINES = ["president-vice-president-2024", "united-states-senator-2024", "governor-2022"];
const DEFAULT_BASELINE = FEATURED_BASELINES[0];

const FLIP_STROKE = "#B8860B"; // flipped-precinct outline (never color alone: thick weight + legend row + aria text)

const mp = {
  pairs: [],            // pairPrimaryOffices() output
  baselines: [],        // qualifying historical general entries
  pair: null,           // selected office pair
  demField: [],         // primaryField() for the DEM primary
  repField: [],
  demName: null,        // selected nominees (default = each primary's leader)
  repName: null,
  baselineEntry: null,
  baselineRows: null,
  baselineCols: [],
  synth: null,          // synthesizeMatchup() output
  participation: null,  // Set of precinct codes on this office's ballot
  dncByPrecinct: {},
  multipliers: { Rep: 1.0, Mod: 1.0, Dem: 1.0 },
  flipRates: {},
  preset: "baseline",
  raceEnv: null,        // { code: {winner, margin, total, flipped} } for the map
  headline: null,
  mapView: null,
  map: null,
  layer: null,
  kb: [],
  url: {},              // params read once at boot, applied as loads land
};

const $ = (id) => document.getElementById(id);
const svc = boundary(); // pinned to the 2026 set, like every page
const useCanvas = new URLSearchParams(location.search).get("renderer") === "canvas";

const fmtNum = (v) => (v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString());

// =============================================================================
// LOAD FLOW
// =============================================================================
function qualifyingBaselines(elections) {
  const eligible = elections.filter(
    (e) =>
      (e.year === 2022 || e.year === 2024) &&
      (e.category === "Federal" || e.category === "State") &&
      e.turnoutFile
  );
  const featured = FEATURED_BASELINES.map((id) => eligible.find((e) => e.raceKey === id)).filter(Boolean);
  const rest = eligible
    .filter((e) => !FEATURED_BASELINES.includes(e.raceKey))
    .sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.displayName).localeCompare(String(b.displayName)));
  return [...featured, ...rest];
}

// Candidate columns of a pivoted race: schema filter + the numeric guard
// (drops computeWinners' Winning Candidate/Party columns) — forecast pattern.
function candidateCols(rows) {
  if (!rows || !rows[0]) return [];
  return getCandidateColumns(Object.keys(rows[0])).filter((col) => {
    const v = rows[0][col];
    return v !== "" && !isNaN(Number(v));
  });
}

async function loadCatalog() {
  const [{ geojson, dncLookup }, elections] = await Promise.all([svc.loadAll(), svc.listRaces()]);

  mp.pairs = pairPrimaryOffices(elections);
  mp.baselines = qualifyingBaselines(elections);
  if (!mp.pairs.length) throw new Error("No paired 2026 primaries in the manifest");

  // Reshape the DNC lookup into the precinct-keyed form the simulator consumes.
  mp.dncByPrecinct = {};
  Object.entries(dncLookup || {}).forEach(([code, row]) => {
    mp.dncByPrecinct[code] = {
      Precinct: row.precinct,
      Rep: row.rep,
      Mod: row.mod,
      Dem: row.dem,
      Total: (row.rep ?? 0) + (row.mod ?? 0) + (row.dem ?? 0),
    };
  });

  populateOfficeSelect();
  populateBaselineSelect();
  buildMap(geojson.features || []);

  const office = mp.pairs.some((p) => p.office === mp.url.office) ? mp.url.office : mp.pairs[0].office;
  const baseline = mp.baselines.some((b) => b.raceKey === mp.url.baseline) ? mp.url.baseline : DEFAULT_BASELINE;
  $("mp-office").value = office;
  $("mp-baseline").value = baseline;
  await Promise.all([selectOffice(office), selectBaseline(baseline)]);
  // Nominee overrides from a shared URL, applied after the fields exist.
  if (mp.url.dem && mp.demField.some((c) => c.name === mp.url.dem)) mp.demName = mp.url.dem;
  if (mp.url.rep && mp.repField.some((c) => c.name === mp.url.rep)) mp.repName = mp.url.rep;
  mp.url = {};
  populateCandidateSelects();
  resynthesize();
}

async function selectOffice(office) {
  const pair = mp.pairs.find((p) => p.office === office);
  if (!pair) return;
  mp.pair = pair;
  $("mp-status").textContent = "Loading primary results…";
  const [demRows, repRows] = await Promise.all([svc.loadRace(pair.dem), svc.loadRace(pair.rep)]);
  const demCols = candidateCols(demRows);
  const repCols = candidateCols(repRows);
  mp.demField = primaryField(demRows, demCols);
  mp.repField = primaryField(repRows, repCols);
  mp.demName = mp.demField[0]?.name || null;
  mp.repName = mp.repField[0]?.name || null;
  mp.participation = matchupParticipation(demRows, demCols, repRows, repCols);
  $("mp-status").textContent = "";
  populateCandidateSelects();
}

async function selectBaseline(raceKey) {
  const entry = mp.baselines.find((b) => b.raceKey === raceKey);
  if (!entry) return;
  mp.baselineEntry = entry;
  $("mp-status").textContent = "Loading baseline election…";
  mp.baselineRows = await svc.loadRace(entry);
  mp.baselineCols = candidateCols(mp.baselineRows);
  $("mp-status").textContent = "";
  $("mp-baseline-name").textContent = entry.displayName || raceKey;
}

// =============================================================================
// SYNTHESIS + SIMULATION — the one recompute per change
// =============================================================================
function resynthesize() {
  if (!mp.baselineRows || !mp.demName || !mp.repName) return;
  mp.synth = synthesizeMatchup(mp.baselineRows, mp.baselineCols, mp.demName, mp.repName);
  const [demCol, repCol] = mp.synth.candidates;
  const demTotal = mp.synth.rows.reduce((s, r) => s + (Number(r[demCol]) || 0), 0);
  const repTotal = mp.synth.rows.reduce((s, r) => s + (Number(r[repCol]) || 0), 0);
  if (!mp.synth.rows.length || demTotal === 0 || repTotal === 0) {
    mp.synth = null;
    mp.raceEnv = null;
    $("mp-status").textContent =
      "This baseline election doesn't have both a Democratic and a Republican candidate, so there's nothing to project from. Pick another baseline.";
    $("mp-headline").innerHTML = "";
    restyle();
    return;
  }
  runSim();
}

function runSim() {
  if (!mp.synth) return;
  const sim = runFullSimulation(mp.synth.rows, mp.dncByPrecinct, mp.synth.candidates, mp.multipliers, {
    voterFlipRates: mp.flipRates,
  });
  mp.raceEnv = toRaceEnvByPrecinct(sim, mp.synth.rows, mp.synth.candidates, mp.participation);
  mp.headline = countyHeadline(sim, mp.synth.candidates[0], mp.synth.candidates[1]);
  mp.simulatedCount = Object.keys(sim.precinctResults).length;
  renderHeadline();
  renderOtherNote();
  restyle();
  renderLegend();
  updateURL();
}

let simTimer = null;
function scheduleSim() {
  clearTimeout(simTimer);
  simTimer = setTimeout(runSim, 120);
}

// =============================================================================
// HEADLINE
// =============================================================================
function candidateBar(name, party, votes, share) {
  return `
    <div class="cand-row">
      <div class="cand-name">
        <span><strong>${escapeHtml(name)}</strong> (${escapeHtml(partyName(party))})</span>
        <span><strong>${fmtNum(votes)}</strong> · ${(share * 100).toFixed(1)}%</span>
      </div>
      <div class="cand-bar"><div style="width:${Math.round(share * 100)}%;background:${PARTY_COLORS[party]}"></div></div>
    </div>`;
}

function renderHeadline() {
  const el = $("mp-headline");
  const h = mp.headline;
  if (!h) {
    el.innerHTML = '<p class="mp-note">No projectable votes for this combination.</p>';
    return;
  }
  const inScope = mp.participation ? mp.participation.size : null;
  const isBaseline =
    Object.values(mp.multipliers).every((m) => m === 1.0) &&
    !Object.values(mp.flipRates).some((r) => r > 0);

  const flips = h.flippedPrecincts.filter((c) => !mp.participation || mp.participation.has(String(c)));
  const chips = flips
    .slice(0, 24)
    .map(
      (code) =>
        `<a class="flip-chip" href="precinct.html#precinct=${encodeURIComponent(code)}">${escapeHtml(formatPrecinctLabel({ PRECINCT: code }))}</a>`
    )
    .join("") + (flips.length > 24 ? `<span class="flip-chip">+${flips.length - 24} more</span>` : "");

  const flipHtml = isBaseline
    ? `<div class="flip-callout no-change">This is the baseline environment with the 2026 nominees' names on it. Pick a scenario above to see what changes.</div>`
    : h.countyFlipped
      ? `<div class="flip-callout"><strong>The county flips under this scenario.</strong></div>`
      : `<div class="flip-callout no-change">The county-wide winner doesn't change under this scenario${
          flips.length ? `, but ${flips.length} precinct${flips.length === 1 ? "" : "s"} flip` : ""
        }.</div>`;

  el.innerHTML = `
    <p class="mp-winner">Projected winner:
      <span class="mp-party-${h.winnerParty}">${escapeHtml(h.winnerName || "—")}</span>
      by ${h.marginPts.toFixed(1)} points</p>
    ${candidateBar(mp.demName, "Dem", h.demVotes, h.demShare)}
    ${candidateBar(mp.repName, "Rep", h.repVotes, h.repShare)}
    ${flipHtml}
    ${flips.length && !isBaseline ? `<div class="flip-chips">${chips}</div>` : ""}
    <p class="mp-note">${mp.simulatedCount} precincts simulated${
      inScope != null ? ` · ${inScope} precincts are on this office's ballot` : ""
    } · precincts without modeled-party data are left at their baseline result.</p>`;
}

function renderOtherNote() {
  const el = $("mp-other-note");
  if (!el) return;
  el.textContent = mp.synth?.otherVotes
    ? `${fmtNum(mp.synth.otherVotes)} third-party and write-in votes in the baseline election are set aside — this is a two-party projection.`
    : "";
}

// =============================================================================
// MAP — built once; scenario changes only restyle
// =============================================================================
function styleEnv() {
  return {
    svg: mp.mapView ? mp.mapView.svgRoot() : null,
    raceId: "matchup",
    race: { partisan: true, byPrecinct: mp.raceEnv || {} },
    mode: null,
    primary: null,
  };
}

function baseStyle(feature) {
  const env = styleEnv();
  const code = String(feature.properties.PRECINCT);
  const r = mp.raceEnv ? mp.raceEnv[code] : null;
  if (!r || r.total === 0) {
    // Not on this office's ballot (or nothing computed yet): distinct
    // cross-hatch, never a plain ghost.
    return {
      fillColor: mp.raceEnv ? notOnBallotFill(env) : MAP_COSMETICS.noData,
      fillOpacity: 0.6,
      color: MAP_COSMETICS.stroke,
      weight: 0.7,
      opacity: 1,
    };
  }
  return {
    fillColor: fillFor(feature.properties, env),
    fillOpacity: 0.74,
    // Flipped precincts get a thick gold outline on top of their party fill
    // (plus a legend row and an aria-label suffix — never color alone).
    color: r.flipped ? FLIP_STROKE : MAP_COSMETICS.stroke,
    weight: r.flipped ? 3 : 0.7,
    opacity: 1,
  };
}

function describeFeature(props) {
  const base = describePrecinct(props, { race: { partisan: true, byPrecinct: mp.raceEnv || {} } });
  const r = mp.raceEnv ? mp.raceEnv[String(props.PRECINCT)] : null;
  return r?.flipped ? `${base} · flips under this scenario` : base;
}

function restyle() {
  if (!mp.layer) return;
  mp.layer.eachLayer((l) => {
    l.setStyle(baseStyle(l.feature));
    if (l._path) l._path.setAttribute("aria-label", describeFeature(l.feature.properties));
  });
}

function buildMap(features) {
  mp.mapView = createMapView({ containerId: "mp-map", useCanvas });
  mp.map = mp.mapView.map;
  mp.layer = L.geoJSON(
    { type: "FeatureCollection", features },
    {
      style: baseStyle,
      onEachFeature: (feature, layer) => {
        layer.on({
          mouseover: () => layer.setStyle({ weight: 2.2, color: MAP_COSMETICS.hover }),
          mouseout: () => layer.setStyle(baseStyle(feature)),
        });
      },
    }
  ).addTo(mp.map);
  // Fit FIRST: the overlay SVG that hosts the pattern <defs> exists only after
  // the map has a view — then restyle into patterns (campaignPage precedent).
  fitToLayer(mp.map, mp.layer);
  restyle();
  mp.kb = decoratePrecinctPaths(mp.layer, { useCanvas, describe: describeFeature });
  wirePrecinctKeyboard($("mp-map"), { useCanvas, getKb: () => mp.kb, onPick: () => {} });
}

function renderLegend() {
  const env = styleEnv();
  const sw = (fill) => swatchSVG(fill);
  $("mp-legend").innerHTML = `
    <div class="cc-legend-title">Projected precinct winner</div>
    <p class="cc-legend-desc">Anchored on ${escapeHtml(mp.baselineEntry?.displayName || "the baseline election")} under your scenario.</p>
    <div class="cc-legend-row">${sw(patternFill(env.svg, partyKind("Dem"), 2, PARTY_COLORS.Dem))}<span>Projected Democratic precinct</span></div>
    <div class="cc-legend-row">${sw(patternFill(env.svg, partyKind("Rep"), 2, PARTY_COLORS.Rep))}<span>Projected Republican precinct</span></div>
    <div class="cc-legend-row"><span class="mp-sw-flip" aria-hidden="true"></span><span>Flips under this scenario (gold outline)</span></div>
    <div class="cc-legend-row">${sw(notOnBallotFill(env))}<span>Not on this office's ballot</span></div>`;
}

// =============================================================================
// SCENARIO CONTROLS (forecast page's presets + sliders pattern)
// =============================================================================
function renderPresets() {
  $("mp-presets").innerHTML = PRESETS.map(
    (p) => `
    <button type="button" class="preset-btn${mp.preset === p.id ? " active" : ""}" data-preset="${p.id}">
      <span class="preset-name">${escapeHtml(p.name)}</span>
      <span class="preset-desc">${escapeHtml(p.desc)}</span>
    </button>`
  ).join("");
  $("mp-presets").querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mp.preset = btn.dataset.preset;
      const preset = PRESETS.find((p) => p.id === mp.preset);
      if (preset?.m) mp.multipliers = { ...preset.m };
      renderPresets();
      renderSliders();
      runSim();
    });
  });
}

function meaning(pct) {
  if (pct === 100) return "turnout as in the baseline (100%)";
  if (pct > 100) return `${pct}% — turns out ${pct - 100}% stronger`;
  return `${pct}% — ${100 - pct}% of them stay home`;
}

function renderSliders() {
  $("mp-sliders").innerHTML = SLIDER_GROUPS.map((g) => {
    const pct = Math.round(mp.multipliers[g.key] * 100);
    return `
      <div class="slider-block">
        <div class="slider-label">
          <span class="who" style="color:${g.color}">${g.label}</span>
          <span class="meaning" id="mp-meaning-${g.key}">${meaning(pct)}</span>
        </div>
        <input type="range" min="50" max="150" step="5" value="${pct}"
               data-party="${g.key}" aria-label="${g.label} turnout percent" />
      </div>`;
  }).join("");
  $("mp-sliders").querySelectorAll("input[type=range]").forEach((input) => {
    input.addEventListener("input", () => {
      const pct = Number(input.value);
      mp.multipliers[input.dataset.party] = pct / 100;
      $(`mp-meaning-${input.dataset.party}`).textContent = meaning(pct);
      if (mp.preset !== "custom") {
        mp.preset = "custom";
        renderPresets();
      }
      scheduleSim();
    });
  });
}

function renderFlips() {
  $("mp-flips-controls").innerHTML = FLIPS.map((f) => {
    const pct = Math.round((mp.flipRates[f.key] || 0) * 100);
    return `
      <div class="slider-block">
        <div class="slider-label">
          <span class="who">${f.label}</span>
          <span class="meaning" id="mp-flip-meaning-${f.param}">${pct}% switch sides</span>
        </div>
        <input type="range" min="0" max="25" step="1" value="${pct}"
               data-flip="${f.key}" data-param="${f.param}" aria-label="${f.label} flip percent" />
      </div>`;
  }).join("");
  $("mp-flips-controls").querySelectorAll("input[type=range]").forEach((input) => {
    input.addEventListener("input", () => {
      const pct = Number(input.value);
      mp.flipRates[input.dataset.flip] = pct / 100;
      $(`mp-flip-meaning-${input.dataset.param}`).textContent = `${pct}% switch sides`;
      if (mp.preset !== "custom") {
        mp.preset = "custom";
        renderPresets();
      }
      scheduleSim();
    });
  });
}

function resetScenario() {
  mp.multipliers = { Rep: 1.0, Mod: 1.0, Dem: 1.0 };
  mp.flipRates = {};
  mp.preset = "baseline";
  renderPresets();
  renderSliders();
  renderFlips();
  runSim();
}

// =============================================================================
// MATCHUP CONTROLS
// =============================================================================
function populateOfficeSelect() {
  $("mp-office").innerHTML = mp.pairs
    .map((p) => `<option value="${escapeHtml(p.office)}">${escapeHtml(p.office)}</option>`)
    .join("");
}

function populateBaselineSelect() {
  const featured = mp.baselines.filter((b) => FEATURED_BASELINES.includes(b.raceKey));
  const rest = mp.baselines.filter((b) => !FEATURED_BASELINES.includes(b.raceKey));
  const opt = (b) => `<option value="${escapeHtml(b.raceKey)}">${escapeHtml(b.displayName || b.raceKey)}</option>`;
  $("mp-baseline").innerHTML =
    featured.map(opt).join("") +
    (rest.length ? `<optgroup label="More races">${rest.map(opt).join("")}</optgroup>` : "");
}

function candidateOptions(field, selectedName) {
  return field
    .map(
      (c, i) =>
        `<option value="${escapeHtml(c.name)}"${c.name === selectedName ? " selected" : ""}>${escapeHtml(c.name)} — ${fmtNum(c.votes)} votes (${Math.round(c.share * 100)}%)${i === 0 ? " · March leader" : ""}</option>`
    )
    .join("");
}

function populateCandidateSelects() {
  $("mp-dem").innerHTML = candidateOptions(mp.demField, mp.demName);
  $("mp-rep").innerHTML = candidateOptions(mp.repField, mp.repName);
}

function wireControls() {
  $("mp-office").addEventListener("change", async (e) => {
    await selectOffice(e.target.value);
    resynthesize();
  });
  $("mp-dem").addEventListener("change", (e) => {
    mp.demName = e.target.value;
    resynthesize();
  });
  $("mp-rep").addEventListener("change", (e) => {
    mp.repName = e.target.value;
    resynthesize();
  });
  $("mp-baseline").addEventListener("change", async (e) => {
    await selectBaseline(e.target.value);
    resynthesize();
  });
  $("mp-reset").addEventListener("click", resetScenario);
}

// =============================================================================
// URL STATE — shareable scenarios; everything omitted at its default so the
// #persona= entry-param hygiene is untouched
// =============================================================================
function readURL() {
  const p = readParams();
  mp.url = { office: p.office, dem: p.dem, rep: p.rep, baseline: p.baseline };
  for (const [key, param] of [["Rep", "tr"], ["Mod", "tm"], ["Dem", "td"]]) {
    const pct = Number(p[param]);
    if (!isNaN(pct) && p[param] != null) mp.multipliers[key] = Math.max(50, Math.min(150, pct)) / 100;
  }
  for (const f of FLIPS) {
    const pct = Number(p[f.param]);
    if (!isNaN(pct) && p[f.param] != null) mp.flipRates[f.key] = Math.max(0, Math.min(25, pct)) / 100;
  }
  if (Object.values(mp.multipliers).some((m) => m !== 1) || Object.values(mp.flipRates).some((r) => r > 0)) {
    mp.preset = "custom";
  }
}

function updateURL() {
  const pctOrNull = (m) => (m === 1 ? null : String(Math.round(m * 100)));
  const params = {
    office: mp.pair && mp.pair.office !== mp.pairs[0]?.office ? mp.pair.office : null,
    dem: mp.demName && mp.demName !== mp.demField[0]?.name ? mp.demName : null,
    rep: mp.repName && mp.repName !== mp.repField[0]?.name ? mp.repName : null,
    baseline: mp.baselineEntry && mp.baselineEntry.raceKey !== DEFAULT_BASELINE ? mp.baselineEntry.raceKey : null,
    tr: pctOrNull(mp.multipliers.Rep),
    tm: pctOrNull(mp.multipliers.Mod),
    td: pctOrNull(mp.multipliers.Dem),
  };
  for (const f of FLIPS) {
    const rate = mp.flipRates[f.key] || 0;
    params[f.param] = rate > 0 ? String(Math.round(rate * 100)) : null;
  }
  writeParams(params);
}

// =============================================================================
// BOOT
// =============================================================================
async function init() {
  readURL();
  renderPresets();
  renderSliders();
  renderFlips();
  wireControls();
  try {
    await loadCatalog();
  } catch (err) {
    console.error("[Matchup] load failed:", err);
    $("mp-status").innerHTML =
      'We couldn’t load the election data. Check your internet connection, then <button type="button" class="retry-link" onclick="location.reload()">try again</button>.';
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
