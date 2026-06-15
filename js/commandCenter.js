// commandCenter.js
// --------------------------------------------------------------------------------
// Orchestrator for index.html — the "PRECINCT COMMAND" command-center view, the
// app's front door. A "peanut butter & chocolate" dashboard: a low-basemap
// tactical map of precinct polygons, three analytic color modes (Lean / Margin /
// Diversity), a live data dock that briefs the whole county or one clicked
// precinct, and a warm "Paper Command" ⇄ dark "War Room" theme toggle.
//
// Reuses the SAME data layer as the classic app — loadAllData(), the locked party
// colors, and the county registry — so it never invents data and stays in sync.
// Sits behind the same Cognito sign-in gate as the classic page on deployment
// (bypassed on localhost / e2e).

import { loadAllData, setActiveCounty, loadCountyRegistry, getActiveCounty, listElectionCSVs, loadElectionData } from "./dataLoader.js";
import { PARTY_STRENGTH_COLORS, PARTY_COLORS, ELECTION_META_KEYS, MAP_CONFIG } from "./constants.js";
import { escapeHtml } from "./utils.js";
import { initAuth, isAuthenticated, signOut, onAuthStateChange } from "./auth.js";
import { showAuthOverlay, hideAuthOverlay } from "./authUI.js";

// ---- module state (this page's own; no shared singleton) --------------------
const cc = {
  map: null,
  tiles: null,
  layer: null,
  geojson: null,
  mode: "lean",          // lean | margin | diversity (demographic modes)
  selectedCode: null,
  countyName: "Collin",
  theme: "light",        // light "Paper Command" | dark "War Room"
  races: [],             // this county's race manifest (for the picker)
  raceId: null,          // active race id, or null for demographics
  race: null,            // { id, label, byPrecinct: { code: {winner,total,margin,...} } }
};

// Subtle CartoDB basemaps for geographic grounding (precinct chairs orienting
// to their turf). Kept low-opacity in CSS so the choropleth dominates.
const BASEMAPS = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const BASEMAP_ATTR =
  '&copy; <a href="https://carto.com/">CARTO</a> · &copy; OpenStreetMap';

// Per-theme map cosmetics that can't come from CSS variables (canvas fills).
const THEME_MAP = {
  light: { noData: "#DAD3C6", stroke: "#FFFDF9", hover: "#C68A0C", sel: "#9A6F08" },
  dark: { noData: "#1b2330", stroke: "#0a0e14", hover: "#F5B312", sel: "#F5B312" },
};
const tm = () => THEME_MAP[cc.theme];

// ---- tiny DOM helpers -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const fmtPct = (v) => (v == null || isNaN(v) ? "N/A" : `${Math.round(v * 100)}%`);
const fmtNum = (v) => (v == null || isNaN(v) ? "N/A" : Number(v).toLocaleString());

// =============================================================================
// COLOR ENGINES — one per mode. Each takes a feature's merged properties and
// returns a fill color (or a muted "no data" gray).
// =============================================================================
// Heat ramps are theme-aware: cool→gold on the dark "war room", warm paper→gold
// on the light "paper command" surface (so pale precincts read on cream).
const RAMPS = {
  margin: {
    light: ["#EDE6D6", "#E9C97A", "#E6A92F", "#D98C12", "#B8740C"],
    dark: ["#15233a", "#3a3a2a", "#7a5d12", "#b8870f", "#F5B312"],
  },
  diversity: {
    light: ["#E4EAEA", "#A9CBC8", "#6FB0A0", "#C9B560", "#C68A0C"],
    dark: ["#13314a", "#1f5a6e", "#2f8f7a", "#9aa838", "#F5B312"],
  },
};

function leanColor(p) {
  const party = p.winningParty;
  const strength = p.partyStrength;
  if (!party || !PARTY_STRENGTH_COLORS[party]) return tm().noData;
  const ramp = PARTY_STRENGTH_COLORS[party];
  return ramp[strength] || ramp.default;
}

// Margin = how lopsided. |demShare - repShare| → pale … hot gold.
function marginColor(p) {
  if (p.demShare == null || p.repShare == null || isNaN(p.demShare)) return tm().noData;
  const margin = Math.abs(p.demShare - p.repShare); // 0..1
  const stops = RAMPS.margin[cc.theme];
  const idx = Math.min(stops.length - 1, Math.floor(margin * stops.length));
  return stops[idx];
}

// Diversity = non-white share heat.
function diversityColor(p) {
  if (p.pct_white == null || isNaN(p.pct_white)) return tm().noData;
  const nonWhite = 1 - p.pct_white; // 0..1
  const stops = RAMPS.diversity[cc.theme];
  const idx = Math.min(stops.length - 1, Math.floor(nonWhite * stops.length));
  return stops[idx];
}

// Race results: color by the winning party — but ONLY for precincts that
// actually participated (candidate votes > 0). computeWinners() assigns a
// "winner" to every precinct via an alphabetical-first-max rule even when a
// precinct had 0 votes (it wasn't on that ballot), so a sub-county race like
// CD-3 would otherwise light up the whole county. Non-participants → no-data.
function raceColor(p) {
  if (!cc.race) return tm().noData;
  const r = cc.race.byPrecinct[String(p.PRECINCT)];
  if (!r || r.total === 0 || !r.winner) return tm().noData;
  return PARTY_COLORS[r.winner] || PARTY_COLORS.default;
}

function colorFor(p) {
  if (cc.raceId) return raceColor(p);
  if (cc.mode === "margin") return marginColor(p);
  if (cc.mode === "diversity") return diversityColor(p);
  return leanColor(p);
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
  let fillOpacity = cc.theme === "dark" ? 0.78 : 0.74;
  // In a race view, fade precincts that weren't on that ballot so the race's
  // real footprint (e.g. CD-3 inside Collin) stands out.
  if (cc.raceId && !inActiveRace(code)) fillOpacity = 0.06;
  return {
    fillColor: colorFor(feature.properties),
    fillOpacity,
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
  cc.map = L.map("cc-map", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    zoomSnap: 0,
    minZoom: 6,
    maxZoom: 16,
  });

  // Subtle basemap underlay (geographic grounding) — swaps with theme.
  cc.tiles = L.tileLayer(BASEMAPS[cc.theme], {
    attribution: BASEMAP_ATTR,
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(cc.map);

  cc.layer = L.geoJSON(geojson, { style: baseStyle, onEachFeature: attachFeature }).addTo(cc.map);

  fitMap();
}

// Wire tooltip + hover + click for one precinct polygon (shared by build &
// county-switch so the two render paths never drift).
function attachFeature(feature, layer) {
  const code = String(feature.properties.PRECINCT);
  layer.bindTooltip(tooltipFor(feature.properties), { sticky: true, direction: "top", className: "cc-tip-map" });
  layer.on({
    mouseover: () => layer.setStyle({ weight: 2.2, color: tm().hover }),
    mouseout: () => layer.setStyle(baseStyle(feature)),
    click: () => selectPrecinct(code),
  });
}

function fitMap() {
  try {
    const b = cc.layer.getBounds();
    if (b.isValid()) { cc.map.fitBounds(b, { padding: [30, 30] }); return; }
  } catch (_) { /* fall through */ }
  cc.map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
}

function tooltipFor(p) {
  const code = escapeHtml(String(p.PRECINCT));
  if (cc.raceId && cc.race) {
    const r = cc.race.byPrecinct[String(p.PRECINCT)];
    if (!r || r.total === 0 || !r.winner) return `<b>PCT ${code}</b> · not on this ballot`;
    return `<b>PCT ${code}</b> · ${escapeHtml(r.winner)} +${fmtPct(r.margin)} · ${fmtNum(r.total)} votes`;
  }
  if (cc.mode === "diversity") {
    const nw = p.pct_white == null ? "N/A" : fmtPct(1 - p.pct_white);
    return `<b>PCT ${code}</b> · ${nw} non-white`;
  }
  if (cc.mode === "margin") {
    const m = (p.demShare == null) ? "N/A" : fmtPct(Math.abs(p.demShare - p.repShare));
    return `<b>PCT ${code}</b> · margin ${m}`;
  }
  const party = p.winningParty || "N/A";
  return `<b>PCT ${code}</b> · ${escapeHtml(party)} lean`;
}

// =============================================================================
// DOCK — county briefing + per-precinct detail
// =============================================================================
function leanCounts(features) {
  let rep = 0, dem = 0, mod = 0, nd = 0;
  for (const f of features) {
    const w = f.properties.winningParty;
    if (w === "Rep") rep++;
    else if (w === "Dem") dem++;
    else if (w === "Mod") mod++;
    else nd++;
  }
  return { rep, dem, mod, nd, total: features.length };
}

function renderCountyBriefing() {
  if (cc.raceId && cc.race) return renderRaceBriefing();
  const features = cc.geojson.features;
  const c = leanCounts(features);
  const scored = c.rep + c.dem + c.mod;

  // aggregate share-weighted county lean (avg of precinct shares that exist)
  let sumR = 0, sumD = 0, n = 0;
  let sumNonWhite = 0, racialN = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.demShare != null && !isNaN(p.demShare)) { sumR += p.repShare; sumD += p.demShare; n++; }
    if (p.pct_white != null && !isNaN(p.pct_white)) { sumNonWhite += (1 - p.pct_white); racialN++; }
  }
  const avgR = n ? sumR / n : null;
  const avgD = n ? sumD / n : null;
  const avgNonWhite = racialN ? sumNonWhite / racialN : null;

  $("cc-dock-eyebrow").textContent = "County Briefing";
  $("cc-dock-title").textContent = `${cc.countyName} County`;
  $("cc-dock-sub").textContent = `${features.length} precincts · ${scored} with party data`;


  let leanBar = "";
  if (avgR != null) {
    const r = Math.round(avgR * 100), d = Math.round(avgD * 100), m = Math.max(0, 100 - r - d);
    leanBar = `
      <div class="cc-stat wide">
        <div class="cc-stat-label">County Partisan Lean (avg precinct share)</div>
        <div class="cc-leanbar">
          ${r > 6 ? `<span class="seg-rep" style="flex:${r}">${r}%</span>` : `<span class="seg-rep" style="flex:${r}"></span>`}
          ${m > 6 ? `<span class="seg-mod" style="flex:${m}">${m}%</span>` : `<span class="seg-mod" style="flex:${m}"></span>`}
          ${d > 6 ? `<span class="seg-dem" style="flex:${d}">${d}%</span>` : `<span class="seg-dem" style="flex:${d}"></span>`}
        </div>
      </div>`;
  }

  $("cc-dock-body").innerHTML = `
    <div class="cc-stat-grid">
      <div class="cc-stat">
        <div class="cc-stat-label">Rep Precincts</div>
        <div class="cc-stat-value" style="color:#ff8d92">${c.rep}<small> / ${features.length}</small></div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">Dem Precincts</div>
        <div class="cc-stat-value" style="color:#79d4ff">${c.dem}<small> / ${features.length}</small></div>
      </div>
      ${leanBar}
      <div class="cc-stat">
        <div class="cc-stat-label">Non-White</div>
        <div class="cc-stat-value">${avgNonWhite == null ? "N/A" : fmtPct(avgNonWhite)}</div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">Competitive</div>
        <div class="cc-stat-value">${competitiveCount(features)}</div>
      </div>
    </div>

    <div class="cc-section-label">Reach the toolkit</div>
    ${deeplink("elections.html", "search", "Elections Catalog", "Browse every race")}
    ${deeplink("forecast.html", "chart", "Forecast Tool", "Build turnout scenarios")}
    ${deeplink("precinct.html", "pin", "Precinct Report", "Door-knock one-pagers")}

    <div class="cc-section-label">Operate</div>
    <p style="font-size:13px;color:var(--ink-dim);line-height:1.55">
      Click any precinct on the tactical map for a live briefing — party lean,
      racial composition, and a direct jump to its full report.
    </p>
  `;
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
    ? `Collin: ${inRace} precincts + ${others.map((o) => titleCase(o.county)).join(", ")} (county totals)`
    : `${inRace} of ${features.length} precincts were on this ballot`;

  // per-county breakdown rows (full-district races only)
  const countyRows = !multi ? "" : [
    { name: "Collin", rep: cRep, dem: cDem, total: cTotal, lvl: "precinct-level" },
    ...others.map((o) => ({ name: titleCase(o.county), rep: o.rep, dem: o.dem, total: o.total, lvl: "county total" })),
  ].map((c) => {
    const win = c.rep === c.dem ? "—" : c.rep > c.dem ? "Rep" : "Dem";
    const col = win === "Rep" ? "#ff8d92" : win === "Dem" ? "#79d4ff" : "var(--ink-dim)";
    return `<div class="cc-demo-row">
      <div class="cc-demo-top"><span class="name">${escapeHtml(c.name)} <span style="color:var(--ink-faint);font-size:11px">· ${c.lvl}</span></span>
        <span class="val" style="color:${col}">${win} · ${fmtNum(c.total)}</span></div>
      <div class="cc-demo-track"><div class="cc-demo-fill" style="width:${c.total ? Math.round((c.rep) / c.total * 100) : 0}%;background:var(--rep)"></div></div>
    </div>`;
  }).join("");

  $("cc-dock-body").innerHTML = `
    <div class="cc-stat-grid">
      <div class="cc-stat wide">
        <div class="cc-stat-label">${multi ? "Full district result" : "County result (precincts on this ballot)"}</div>
        <div class="cc-leanbar">
          ${repPct > 6 ? `<span class="seg-rep" style="flex:${repPct}">${repPct}%</span>` : `<span class="seg-rep" style="flex:${repPct}"></span>`}
          ${other > 6 ? `<span class="seg-mod" style="flex:${other}">${other}%</span>` : `<span class="seg-mod" style="flex:${other}"></span>`}
          ${demPct > 6 ? `<span class="seg-dem" style="flex:${demPct}">${demPct}%</span>` : `<span class="seg-dem" style="flex:${demPct}"></span>`}
        </div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">${multi ? "District winner" : "Leads"}</div>
        <div class="cc-stat-value" style="color:${winner === "Rep" ? "#ff8d92" : winner === "Dem" ? "#79d4ff" : "var(--ink)"}">${winner}</div>
      </div>
      <div class="cc-stat">
        <div class="cc-stat-label">Total Votes</div>
        <div class="cc-stat-value" style="font-size:21px">${fmtNum(total)}</div>
      </div>
    </div>

    ${multi ? `<div class="cc-section-label">By county</div>${countyRows}` : ""}

    <button class="cc-deeplink" id="cc-clear-race" style="margin-top:14px">
      <span class="dl-l"><span class="dl-ic">${ICON.back}</span><span><span class="dl-t">Back to Demographics</span><span class="dl-s">Clear this race</span></span></span>
      <span class="dl-arrow">↺</span>
    </button>

    <div class="cc-section-label">Go deeper</div>
    ${deeplink("elections.html", "search", "Elections Catalog", "Browse & open another race")}

    <p style="font-size:13px;color:var(--ink-dim);line-height:1.55;margin-top:12px">
      ${multi ? "Collin precincts are shown on the map; other counties are folded in as county totals (their precinct detail isn’t carried). " : ""}Faded precincts weren’t on this ballot.
    </p>
  `;
  const back = $("cc-clear-race");
  if (back) back.addEventListener("click", clearRace);
}

function competitiveCount(features) {
  let n = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.demShare != null && !isNaN(p.demShare) && Math.abs(p.demShare - p.repShare) < 0.1) n++;
  }
  return n;
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

  $("cc-dock-sub").textContent = hasParty
    ? `${p.winningParty} lean · strength ${p.partyStrength || "—"}`
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
        <div class="cc-leanbar">
          ${r > 6 ? `<span class="seg-rep" style="flex:${r}">${r}%</span>` : `<span class="seg-rep" style="flex:${r}"></span>`}
          ${m > 6 ? `<span class="seg-mod" style="flex:${m}">${m}%</span>` : `<span class="seg-mod" style="flex:${m}"></span>`}
          ${d > 6 ? `<span class="seg-dem" style="flex:${d}">${d}%</span>` : `<span class="seg-dem" style="flex:${d}"></span>`}
        </div>
      </div>`
    : `<div class="cc-stat wide"><div class="cc-stat-label">Partisan Share</div><div class="cc-stat-value" style="font-size:18px;color:var(--ink-faint)">N/A</div></div>`;

  const margin = hasParty ? Math.abs(p.demShare - p.repShare) : null;
  const totalPop = p.total;

  // When a race is showing, lead the detail with this precinct's actual result.
  let raceBlock = "";
  if (cc.raceId && cc.race) {
    const rr = cc.race.byPrecinct[code];
    if (rr && rr.total > 0 && rr.winner) {
      const rp = Math.round((rr.rep / rr.total) * 100);
      const dp = Math.round((rr.dem / rr.total) * 100);
      const op = Math.max(0, 100 - rp - dp);
      const sg = (cls, v) => `<span class="seg-${cls}" style="flex:${v}">${v > 6 ? v + "%" : ""}</span>`;
      raceBlock = `<div class="cc-section-label">${escapeHtml(cc.race.label)}</div>
        <div class="cc-stat wide" style="margin-bottom:14px">
          <div class="cc-stat-label">${escapeHtml(rr.winnerName || rr.winner)} won · ${fmtNum(rr.total)} votes</div>
          <div class="cc-leanbar">${sg("rep", rp)}${sg("mod", op)}${sg("dem", dp)}</div>
        </div>`;
    } else {
      raceBlock = `<div class="cc-section-label">${escapeHtml(cc.race.label)}</div>
        <p style="font-size:13px;color:var(--ink-faint);margin-bottom:14px">This precinct wasn’t on this ballot.</p>`;
    }
  }

  $("cc-dock-body").innerHTML = `
    ${raceBlock}
    <div class="cc-pill-row" style="margin-bottom:16px">
      ${hasParty ? `<span class="cc-pill ${p.winningParty === "Rep" ? "rep" : p.winningParty === "Dem" ? "dem" : ""}">${escapeHtml(p.winningParty)} LEAN</span>` : ""}
      ${margin != null ? `<span class="cc-pill ${margin < 0.1 ? "gold" : ""}">${margin < 0.1 ? "COMPETITIVE" : "SAFE"} · ${fmtPct(margin)}</span>` : ""}
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
  restyle();
  if (code == null) {
    renderCountyBriefing();
  } else {
    renderPrecinctDetail(code);
    openDockMobile();
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
function setMode(mode) {
  const wasRace = !!cc.raceId;
  cc.mode = mode;
  if (wasRace) { cc.raceId = null; cc.race = null; applyRaceLabel(); } // picking a demo mode exits the race
  document.querySelectorAll(".cc-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  restyle();
  // refresh tooltips for the new mode
  cc.layer.eachLayer((l) => l.setTooltipContent(tooltipFor(l.feature.properties)));
  renderLegend();
  if (wasRace) { cc.selectedCode ? renderPrecinctDetail(cc.selectedCode) : renderCountyBriefing(); }
}

function renderLegend() {
  const el = $("cc-legend");
  if (cc.raceId && cc.race) {
    el.innerHTML = `
      <div class="cc-legend-title">${escapeHtml(cc.race.label)}</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:${PARTY_COLORS.Rep}"></span>Rep win</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:${PARTY_COLORS.Dem}"></span>Dem win</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:${PARTY_COLORS.Mod || "#800080"}"></span>Other / Mod</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:${tm().noData};opacity:.45"></span>Not on this ballot</div>`;
    return;
  }
  if (cc.mode === "lean") {
    el.innerHTML = `
      <div class="cc-legend-title">Partisan Lean</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:#630202"></span>Strong Rep</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:#fc9a9a"></span>Lean Rep</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:#D6EAF8"></span>Lean Dem</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:#27408B"></span>Strong Dem</div>
      <div class="cc-legend-row"><span class="cc-legend-sw" style="background:${tm().noData}"></span>No data</div>`;
  } else if (cc.mode === "margin") {
    el.innerHTML = `
      <div class="cc-legend-title">Victory Margin</div>
      <div class="cc-legend-ramp" style="background:linear-gradient(90deg,${RAMPS.margin[cc.theme].join(",")})"></div>
      <div class="cc-legend-scale"><span>Tossup</span><span>Landslide</span></div>`;
  } else {
    el.innerHTML = `
      <div class="cc-legend-title">Non-White Share</div>
      <div class="cc-legend-ramp" style="background:linear-gradient(90deg,${RAMPS.diversity[cc.theme].join(",")})"></div>
      <div class="cc-legend-scale"><span>0%</span><span>100%</span></div>`;
  }
}

// =============================================================================
// THEME — "Paper Command" (light) ⇄ "War Room" (dark)
// =============================================================================
const THEME_KEY = "cc_theme";

function applyTheme(theme) {
  cc.theme = theme === "dark" ? "dark" : "light";
  if (cc.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem(THEME_KEY, cc.theme); } catch (_) { /* ignore */ }

  // keep the browser chrome (mobile address bar) in sync with the surface
  const themeColor = document.getElementById("cc-theme-color");
  if (themeColor) themeColor.setAttribute("content", cc.theme === "dark" ? "#0a0e14" : "#EFEBE2");

  // swap basemap + recolor canvas (which can't read CSS vars)
  if (cc.tiles) cc.tiles.setUrl(BASEMAPS[cc.theme]);
  if (cc.layer) {
    restyle();
    renderLegend();
  }
}

function toggleTheme() {
  applyTheme(cc.theme === "dark" ? "light" : "dark");
}

function initTheme() {
  let saved = "light";
  try { saved = localStorage.getItem(THEME_KEY) || "light"; } catch (_) { /* ignore */ }
  applyTheme(saved);
}

// =============================================================================
// COUNTY SWITCHING
// =============================================================================
let registryCache = null;

async function populateCountyMenu() {
  const registry = await loadCountyRegistry();
  // Real counties only — district/statewide entries lack a FIPS code.
  registryCache = registry.filter((c) => c.status === "live" && c.fips);
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
        <span>${escapeHtml(c.name)}</span><small>${c.fips}</small>
      </div>`
    )
    .join("");
  list.innerHTML = items || `<div class="cc-county-opt" style="cursor:default;color:var(--ink-faint)">No match</div>`;
}

// One source of truth for "what county am I looking at" — drives the topbar
// label AND the browser tab title, so branding follows the active county
// instead of being hardcoded to Collin.
function applyCountyBranding(name) {
  cc.countyName = name;
  $("cc-county-name").textContent = `${name} County`;
  document.title = `${name} County — Precinct Command`;
}

async function switchCounty(slug, name) {
  showLoading(true);
  closeCountyMenu();
  try {
    await setActiveCounty(slug);
    const { geojson } = await loadAllData();
    cc.geojson = geojson;
    cc.selectedCode = null;
    cc.raceId = null; cc.race = null; // races are county-specific
    applyCountyBranding(name);
    applyRaceLabel();
    // rebuild map layer
    if (cc.layer) { cc.layer.remove(); }
    cc.layer = L.geoJSON(geojson, { style: baseStyle, onEachFeature: attachFeature }).addTo(cc.map);
    fitMap();
    renderLegend();
    await populateRaceMenu();
    renderCountyBriefing();
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
    if (!txt) return [];
    const lines = txt.trim().split("\n");
    const agg = {};
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      const pc = c[0];
      if (!pc || !pc.endsWith(":ALL")) continue; // only the collapsed non-Collin counties
      const county = pc.split(":")[0];
      if (county === "collin") continue;
      const party = (c[1] || "").toUpperCase();
      if (!party) continue; // skip Over/Under/Write-in
      const votes = +c[3] || 0;
      const a = agg[county] || (agg[county] = { county, rep: 0, dem: 0, total: 0 });
      a.total += votes;
      if (party === "REP") a.rep += votes;
      else if (party === "DEM") a.dem += votes;
    }
    return Object.values(agg).filter((a) => a.total > 0).map((a) => ({ ...a, winner: a.rep >= a.dem ? "Rep" : "Dem" }));
  } catch (_) {
    return [];
  }
}

function renderRaceList(filter) {
  const list = $("cc-race-list");
  if (!list) return;
  const f = filter.toLowerCase();
  let html = `<div class="cc-county-opt ${cc.raceId ? "" : "active"}" data-race="">
      <span>Demographics (lean / margin / diversity)</span></div>`;
  html += cc.races
    .filter((e) => (e.displayName || e.office || e.filename || "").toLowerCase().includes(f))
    .slice(0, 80)
    .map((e) => {
      const id = e.raceKey || e.filename;
      const label = e.displayName || e.office || id;
      return `<div class="cc-county-opt ${id === cc.raceId ? "active" : ""}" data-race="${escapeHtml(id)}">
        <span>${escapeHtml(label)}</span><small>${escapeHtml(String(e.year || e.category || ""))}</small></div>`;
    })
    .join("");
  list.innerHTML = html;
}

function applyRaceLabel() {
  const el = $("cc-race-name");
  if (el) el.textContent = cc.race ? cc.race.label : "Demographics";
  // visually mute the demographic mode switch while a race is showing
  const modes = $("cc-modes");
  if (modes) modes.style.opacity = cc.raceId ? "0.45" : "1";
}

async function loadRace(raceIdOrEntry) {
  const entry = typeof raceIdOrEntry === "object"
    ? raceIdOrEntry
    : cc.races.find((e) => (e.raceKey || e.filename) === raceIdOrEntry);
  if (!entry) return;
  showLoading(true);
  try {
    const rows = await loadElectionData(entry);
    const byPrecinct = {};
    for (const row of rows) byPrecinct[String(row["PRECINCT CODE"])] = precinctRaceResult(row);
    cc.raceId = entry.raceKey || entry.filename;
    cc.race = { id: cc.raceId, label: entry.displayName || entry.office || cc.raceId, byPrecinct, otherCounties: [] };
    // For multi-county federal/state DISTRICT races, fold in the other counties'
    // results (kept as county-level aggregates) so the dock shows the FULL
    // district, not just Collin's slice.
    const slug = districtSlugFor(entry);
    if (slug && entry.raceFile) cc.race.otherCounties = await loadDistrictAggregates(slug, entry.raceFile);
    applyRaceLabel();
    updateHash();
    restyle();
    cc.layer.eachLayer((l) => l.setTooltipContent(tooltipFor(l.feature.properties)));
    renderLegend();
    if (cc.selectedCode) renderPrecinctDetail(cc.selectedCode);
    else renderCountyBriefing();
  } catch (err) {
    console.error("[Command] race load failed:", err);
  } finally {
    showLoading(false);
  }
}

function clearRace() {
  if (!cc.raceId) return;
  cc.raceId = null; cc.race = null;
  applyRaceLabel();
  updateHash();
  restyle();
  cc.layer.eachLayer((l) => l.setTooltipContent(tooltipFor(l.feature.properties)));
  renderLegend();
  if (cc.selectedCode) renderPrecinctDetail(cc.selectedCode);
  else renderCountyBriefing();
}

function openRaceMenu() { $("cc-race-menu").classList.add("open"); $("cc-race-search").focus(); }
function closeRaceMenu() { $("cc-race-menu").classList.remove("open"); }

// =============================================================================
// MOBILE DOCK
// =============================================================================
function openDockMobile() { if (window.innerWidth <= 1100) $("cc-dock").classList.add("open"); }

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

  // theme toggle
  $("cc-theme-btn").addEventListener("click", toggleTheme);

  // rail active state (map button is local; others are real links)
  document.querySelectorAll(".cc-rail-btn[data-rail]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".cc-rail-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
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

  // precinct quick-search
  $("cc-precinct-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const code = e.target.value.trim();
    if (!code) return;
    const layer = findLayerByCode(code);
    if (layer) { selectPrecinct(code); }
    else { $("cc-dock-sub").textContent = `No precinct "${code}" in ${cc.countyName}.`; }
  });

  // Escape closes menus / mobile dock
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeCountyMenu(); closeRaceMenu(); $("cc-dock").classList.remove("open"); }
  });
}

// hash params (county / race) for deep links + shareable state
function readHashParams() {
  const params = {};
  for (const part of window.location.hash.slice(1).split("&")) {
    const [k, v] = part.split("=");
    if (k && v) params[k] = decodeURIComponent(v);
  }
  return params;
}
function updateHash() {
  const county = getActiveCounty();
  history.replaceState(null, "", `#county=${encodeURIComponent(county)}${cc.raceId ? `&race=${encodeURIComponent(cc.raceId)}` : ""}`);
}

// =============================================================================
// BOOT
// =============================================================================
async function init() {
  if (cc.map) return; // guard: the auth path can fire boot twice
  initTheme();
  wireUI();
  renderLegend();
  showLoading(true);
  try {
    const params = readHashParams();
    await populateCountyMenu();
    // Honour a #county= deep link (defaults to Collin otherwise).
    if (params.county && registryCache.find((c) => c.slug === params.county)) {
      try { await setActiveCounty(params.county); } catch (_) { /* keep default */ }
    }
    const activeEntry = registryCache.find((c) => c.slug === getActiveCounty());
    applyCountyBranding(activeEntry ? activeEntry.name : "Collin");
    const { geojson } = await loadAllData();
    cc.geojson = geojson;
    buildMap(geojson);
    await populateRaceMenu();
    // A #race= deep link (e.g. from the Elections catalog) shows that race.
    if (params.race) await loadRace(params.race);
    else renderCountyBriefing();
  } catch (err) {
    console.error("[Command] boot failed:", err);
    $("cc-dock-sub").textContent = "Failed to load data.";
  } finally {
    showLoading(false);
  }
}

// Reveal + wire the rail's Sign Out button once we're authenticated.
let logoutWired = false;
function setupLogout() {
  if (logoutWired) return;
  const btn = $("cc-logout");
  if (!btn) return;
  logoutWired = true;
  btn.style.display = "";
  btn.addEventListener("click", () => { signOut(); location.reload(); });
}

// Auth gate — identical posture to the classic page: the public deployment sits
// behind Cognito sign-in; localhost and e2e bypass it. init() is idempotent, so
// running it on both the initial check and the auth-state change is safe.
async function boot() {
  initAuth();
  const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocalDev || (await isAuthenticated())) {
    hideAuthOverlay();
    init();
    setupLogout();
  } else {
    showAuthOverlay();
  }
  onAuthStateChange((authenticated) => {
    if (authenticated) { hideAuthOverlay(); init(); setupLogout(); }
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
