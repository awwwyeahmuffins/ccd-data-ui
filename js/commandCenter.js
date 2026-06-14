// commandCenter.js
// --------------------------------------------------------------------------------
// Orchestrator for command.html — the "PRECINCT COMMAND" war-room view.
// A deliberately different surface from index.html: a no-basemap tactical map of
// precinct polygons, three analytic color modes (Lean / Margin / Diversity), and
// a live data dock that briefs the whole county or a single clicked precinct.
//
// Reuses the SAME data layer as the main app — loadAllData(), the locked party
// colors, and the county registry — so it never invents data and stays in sync.

import { loadAllData, setActiveCounty, loadCountyRegistry, getActiveCounty } from "./dataLoader.js";
import { PARTY_STRENGTH_COLORS, MAP_CONFIG } from "./constants.js";
import { escapeHtml } from "./utils.js";

// ---- module state (this page's own; no shared singleton) --------------------
const cc = {
  map: null,
  tiles: null,
  layer: null,
  geojson: null,
  mode: "lean",          // lean | margin | diversity
  selectedCode: null,
  countyName: "Collin",
  theme: "light",        // light "Paper Command" | dark "War Room"
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

function colorFor(p) {
  if (cc.mode === "margin") return marginColor(p);
  if (cc.mode === "diversity") return diversityColor(p);
  return leanColor(p);
}

// =============================================================================
// MAP RENDERING
// =============================================================================
function baseStyle(feature) {
  const isSel = cc.selectedCode != null && String(feature.properties.PRECINCT) === cc.selectedCode;
  return {
    fillColor: colorFor(feature.properties),
    fillOpacity: cc.theme === "dark" ? 0.78 : 0.74,
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

  $("cc-dock-body").innerHTML = `
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
  cc.mode = mode;
  document.querySelectorAll(".cc-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  restyle();
  // refresh tooltips for the new mode
  cc.layer.eachLayer((l) => l.setTooltipContent(tooltipFor(l.feature.properties)));
  renderLegend();
}

function renderLegend() {
  const el = $("cc-legend");
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
    applyCountyBranding(name);
    // rebuild map layer
    if (cc.layer) { cc.layer.remove(); }
    cc.layer = L.geoJSON(geojson, { style: baseStyle, onEachFeature: attachFeature }).addTo(cc.map);
    fitMap();
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

  // precinct quick-search
  $("cc-precinct-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const code = e.target.value.trim();
    if (!code) return;
    const layer = findLayerByCode(code);
    if (layer) { selectPrecinct(code); }
    else { $("cc-dock-sub").textContent = `No precinct "${code}" in ${cc.countyName}.`; }
  });

  // Escape closes county menu / mobile dock
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeCountyMenu(); $("cc-dock").classList.remove("open"); }
  });
}

// =============================================================================
// BOOT
// =============================================================================
async function init() {
  initTheme();
  wireUI();
  renderLegend();
  showLoading(true);
  try {
    await populateCountyMenu();
    // Brand to whatever county is actually active (defaults to Collin, but
    // honours a deep-linked / remembered county) instead of hardcoding it.
    const activeEntry = registryCache.find((c) => c.slug === getActiveCounty());
    applyCountyBranding(activeEntry ? activeEntry.name : "Collin");
    const { geojson } = await loadAllData();
    cc.geojson = geojson;
    buildMap(geojson);
    renderCountyBriefing();
  } catch (err) {
    console.error("[Command] boot failed:", err);
    $("cc-dock-sub").textContent = "Failed to load data.";
  } finally {
    showLoading(false);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
