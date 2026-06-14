// targetsPage.js
// --------------------------------------------------------------------------------
// Orchestrator for targets.html — the precinct-targeting view. Pick a county and
// a campaign strategy; see its precincts ranked with the real numbers behind the
// ranking. Pure scoring lives in targeting.js. Must not import js/app/* modules.

import {
  loadCountyRegistry,
  setActiveCounty,
  loadAllData,
  getBoundaryConfigs,
  getActiveBoundary,
} from "./dataLoader.js";
import {
  STRATEGIES,
  STRATEGY_CATEGORIES,
  getStrategy,
  strategyAvailable,
  rankPrecincts,
} from "./targeting.js";
import { escapeHtml } from "./utils.js";

const pg = {
  county: "collin",
  strategy: "tossups",
  limit: 25,
  features: [],
  turnout: null,
  ctx: { hasTurnout: false, hasRacial: false },
};

const $ = (id) => document.getElementById(id);
const pct = (v) => (v == null || isNaN(v) ? "N/A" : `${Math.round(v * 100)}%`);
const num = (v) => (v == null || isNaN(v) ? "N/A" : Math.round(v).toLocaleString());

// category icons (consistent Feather line style)
const CAT_ICON = {
  flip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  turnout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 17l6-6 4 4 8-8"/><polyline points="14 7 21 7 21 14"/></svg>`,
  demo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
  leverage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>`,
};

// ---- county / district selector (mirrors elections.html) --------------------
async function initCountySelect() {
  const registry = await loadCountyRegistry();
  const sel = $("tg-county");
  const counties = registry.filter((c) => c.kind !== "district" && c.status === "live" && c.fips);
  const districts = registry.filter((c) => c.kind === "district" && c.status === "live");

  let html = counties
    .map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`)
    .join("");
  const groups = {};
  for (const d of districts) (groups[d.group || "Districts"] ||= []).push(d);
  for (const [label, items] of Object.entries(groups)) {
    html += `<optgroup label="${escapeHtml(label)}">` +
      items.map((d) => `<option value="${escapeHtml(d.slug)}">${escapeHtml(d.name)}</option>`).join("") +
      "</optgroup>";
  }
  sel.innerHTML = html;
  sel.value = pg.county;
  if (sel.value !== pg.county) pg.county = sel.value;
  sel.addEventListener("change", () => {
    pg.county = sel.value;
    updateURL();
    loadCounty();
  });
}

// ---- marquee turnout: the highest-turnout election on file -------------------
// Returns { [precinctCode]: { registered, ballots } } or null when unavailable.
async function loadMarqueeTurnout() {
  try {
    const cfg = getBoundaryConfigs()[getActiveBoundary()];
    if (!cfg) return null;
    const manifest = await fetch(`${cfg.dataDir}/elections.json`).then((r) => (r.ok ? r.json() : null));
    const files = [...new Set((manifest?.elections || []).map((e) => e.turnoutFile).filter(Boolean))];
    if (!files.length) return null;

    let best = null;
    let bestBallots = -1;
    for (const f of files) {
      try {
        const rows = await d3.csv(`${cfg.dataDir}/${f}`, (d) => ({
          precinct: d.precinct,
          registered: +d.registered,
          ballots: +d.ballots_cast,
        }));
        const sum = rows.reduce((s, r) => s + (isNaN(r.ballots) ? 0 : r.ballots), 0);
        if (sum > bestBallots) { bestBallots = sum; best = rows; }
      } catch (_) { /* skip a bad turnout file */ }
    }
    if (!best || bestBallots <= 0) return null;

    const lookup = {};
    for (const r of best) {
      if (r.precinct == null || r.precinct === "") continue;
      lookup[String(r.precinct)] = {
        registered: isNaN(r.registered) ? null : r.registered,
        ballots: isNaN(r.ballots) ? null : r.ballots,
      };
    }
    return Object.keys(lookup).length ? lookup : null;
  } catch (_) {
    return null;
  }
}

// ---- load a county + recompute everything -----------------------------------
async function loadCounty() {
  $("tg-list").innerHTML = '<div class="empty-note">Loading…</div>';
  $("tg-catalog").innerHTML = "";
  $("tg-na").innerHTML = "";
  try {
    await setActiveCounty(pg.county);
    const [{ geojson }, turnout] = await Promise.all([loadAllData(), loadMarqueeTurnout()]);
    pg.features = geojson.features || [];
    pg.turnout = turnout;
    pg.ctx = {
      hasTurnout: !!turnout,
      hasRacial: pg.features.some((f) => f.properties && f.properties.pct_white != null && !isNaN(f.properties.pct_white)),
    };
    // if the chosen strategy isn't supported here, fall back to a universal one
    if (!strategyAvailable(getStrategy(pg.strategy), pg.ctx)) pg.strategy = "tossups";
    renderCatalog();
    renderResults();
  } catch (err) {
    console.error("[Targets] load failed:", err);
    $("tg-list").innerHTML = '<div class="empty-note">Could not load this county’s data.</div>';
  }
}

// ---- strategy catalogue -----------------------------------------------------
function renderCatalog() {
  const html = STRATEGY_CATEGORIES.map((cat) => {
    const cards = STRATEGIES.filter((s) => s.cat === cat.id)
      .map((s) => {
        const ok = strategyAvailable(s, pg.ctx);
        const active = s.id === pg.strategy ? " active" : "";
        const naLine = ok ? "" : `<div class="strat-card-na">Needs ${s.needs.join(" + ")} data</div>`;
        return `<button type="button" class="strat-card${active}" data-strat="${escapeHtml(s.id)}" ${ok ? "" : "disabled"}>
          <div class="strat-card-name">${escapeHtml(s.label)}</div>
          <div class="strat-card-blurb">${escapeHtml(s.blurb)}</div>
          ${naLine}
        </button>`;
      })
      .join("");
    return `<section class="strat-cat">
      <div class="strat-cat-head">
        <span class="strat-cat-ic">${CAT_ICON[cat.id] || ""}</span>
        <div><div class="strat-cat-title">${escapeHtml(cat.label)}</div><div class="strat-cat-blurb">${escapeHtml(cat.blurb)}</div></div>
      </div>
      <div class="strat-grid">${cards}</div>
    </section>`;
  }).join("");
  $("tg-catalog").innerHTML = html;

  $("tg-catalog").querySelectorAll(".strat-card[data-strat]:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      pg.strategy = btn.dataset.strat;
      updateURL();
      renderCatalog();
      renderResults();
    });
  });
}

// ---- results ----------------------------------------------------------------
function renderResults() {
  const strat = getStrategy(pg.strategy);
  if (!strat) return;
  $("tg-results-title").textContent = strat.label;
  $("tg-results-sub").textContent = strat.blurb;

  if (!strategyAvailable(strat, pg.ctx)) {
    $("tg-results-count").textContent = "";
    $("tg-na").innerHTML = `<div class="na-banner">This strategy needs ${escapeHtml(strat.needs.join(" + "))} data, which isn't on file for this county. Pick another strategy above.</div>`;
    $("tg-list").innerHTML = "";
    return;
  }
  $("tg-na").innerHTML = "";

  const ranked = rankPrecincts(pg.features, pg.strategy, { turnoutLookup: pg.turnout, limit: pg.limit });
  $("tg-results-count").textContent = ranked.length ? `Top ${ranked.length}` : "";
  if (!ranked.length) {
    $("tg-list").innerHTML = '<div class="empty-note">No precincts match this strategy here.</div>';
    return;
  }
  $("tg-list").innerHTML = ranked.map((row, i) => precinctCard(i + 1, row, strat)).join("");
}

function seg(cls, v) {
  return `<span class="tg-seg-${cls}" style="flex:${v}">${v > 8 ? v + "%" : ""}</span>`;
}

// the headline number for a row depends on the strategy's job
function headlineFor(id, m) {
  switch (id) {
    case "flip-dem-rep": case "flip-rep-dem": case "tossups":
      return { val: pct(m.margin), label: "Win margin" };
    case "defend-rep": case "defend-dem":
      return { val: pct(m.modShare), label: "Moderate bloc" };
    case "persuasion":
      return { val: num(m.modShare * m.votes), label: "Moderates" };
    case "turnout-gap":
      return { val: num(m.dropoff), label: "Non-voters" };
    case "mobilize-rep": case "mobilize-dem": case "low-turnout":
      return { val: pct(m.rate), label: "Turnout" };
    case "diversifying":
      return { val: pct(m.nonWhite), label: "Non-white" };
    case "register":
      return { val: num(Math.max(0, (m.pop || 0) - (m.registered || 0))), label: "Unregistered" };
    case "high-leverage": case "efficient-swing":
      return { val: num(m.votes), label: "Voters" };
    default:
      return { val: "", label: "" };
  }
}

function precinctCard(rank, row, strat) {
  const m = row.metrics;
  const r = Math.round(m.repShare * 100);
  const d = Math.round(m.demShare * 100);
  const mo = Math.max(0, 100 - r - d);
  const head = headlineFor(strat.id, m);
  const cParam = encodeURIComponent(pg.county);
  const pParam = encodeURIComponent(m.code);
  return `<div class="tg-precinct">
    <div class="tg-rank">${rank}</div>
    <div>
      <div class="tg-pcode">Precinct ${escapeHtml(m.code)}</div>
      <div class="tg-leanbar">${seg("rep", r)}${seg("mod", mo)}${seg("dem", d)}</div>
      <div class="tg-why">${escapeHtml(row.explain)}</div>
    </div>
    <div class="tg-pmeta">
      <div><div class="tg-metric-val">${escapeHtml(head.val)}</div><div class="tg-metric-label">${escapeHtml(head.label)}</div></div>
      <div class="tg-links">
        <a class="tg-link-report" href="precinct.html#county=${cParam}&precinct=${pParam}">Report</a>
        <a class="tg-link-map" href="classic.html?dl#county=${cParam}">Map</a>
      </div>
    </div>
  </div>`;
}

// ---- URL sync (deep-linkable) -----------------------------------------------
function updateURL() {
  const h = `county=${encodeURIComponent(pg.county)}&strategy=${encodeURIComponent(pg.strategy)}&top=${pg.limit}`;
  history.replaceState(null, "", `#${h}`);
}
function readURL() {
  const params = {};
  for (const part of window.location.hash.slice(1).split("&")) {
    const [k, v] = part.split("=");
    if (k && v) params[k] = decodeURIComponent(v);
  }
  if (params.county) pg.county = params.county;
  if (params.strategy && getStrategy(params.strategy)) pg.strategy = params.strategy;
  if (params.top && [15, 25, 50, 100].includes(+params.top)) pg.limit = +params.top;
}

// ---- boot -------------------------------------------------------------------
async function init() {
  readURL();
  $("tg-limit").value = String(pg.limit);
  $("tg-limit").addEventListener("change", (e) => {
    pg.limit = +e.target.value;
    updateURL();
    renderResults();
  });
  await initCountySelect();
  $("tg-county").value = pg.county;
  if ($("tg-county").value !== pg.county) pg.county = $("tg-county").value; // unknown slug → first option
  await loadCounty();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
