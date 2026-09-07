// targetsPage.js
// --------------------------------------------------------------------------------
// Orchestrator for targets.html — the precinct-targeting view. Pick a county and
// a campaign strategy; see its precincts ranked with the real numbers behind the
// ranking. Pure scoring lives in targeting.js. Must not import js/app/* modules.

import { boundary } from "./data/dataService.js";
import { DISTRICT_LIST, precinctsInDistrict } from "./data/districts.js";
import {
  STRATEGIES,
  STRATEGY_CATEGORIES,
  getStrategy,
  strategyAvailable,
  rankPrecincts,
} from "./targeting.js";
import { ELECTION_META_KEYS } from "./electionSchema.js";
import { escapeHtml } from "./lib/dom.js";
import { downloadFile } from "./lib/download.js";
import { toCsv, exportFilename } from "./domain/exportRows.js";
import { readParams, writeParams } from "./lib/urlState.js";
import { initGlossary, termButton } from "./glossary.js";

// Metric labels that have a plain-language glossary entry render as tappable
// term buttons (never hover-only tooltips — the audience is 60+ on iPads).
const METRIC_TERMS = {
  // keys must match headlineFor()'s labels exactly
  "Win margin": "margin",
  "Moderate bloc": "moderate",
  "Moderates": "moderate",
  "Turnout": "turnout",
  "Non-voters": "turnout",
  "Voters": "voter-universe",
  "Untapped supporters": "net-vote-opportunity",
  "Turnout swing": "elasticity",
  "Roll growth": "churn",
};
function metricLabelHTML(label) {
  const term = METRIC_TERMS[label];
  return term ? termButton(term, escapeHtml(label)) : escapeHtml(label);
}

const svc = boundary();

const pg = {
  district: null,
  strategy: "tossups",
  limit: 25,
  electionId: "",        // "" = overall partisan lean; else a specific race
  features: [],          // county features (aggregate lean)
  electionFeatures: [],  // features re-scored on the selected election (subset on that ballot)
  elections: [],         // race manifest for the active county/district
  turnout: null,
  primary: null,   // party-primary ballots lookup (official county reports), null = N/A
  ctx: { hasTurnout: false, hasRacial: false, hasPrimary: false },
  electionError: null,   // race name we failed to load, surfaced once then cleared
  electionSeq: 0,        // bumped per election pick; a stale load must not win
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

// ---- district scope (REDESIGN §5.2: districts filter Collin, no county picker)
function initDistrictSelect() {
  const sel = $("tg-district");
  const groups = {};
  for (const d of DISTRICT_LIST) (groups[d.group || "Districts"] ||= []).push(d);
  let html = `<option value="">All of Collin County</option>`;
  for (const [label, items] of Object.entries(groups)) {
    html += `<optgroup label="${escapeHtml(label)}">` +
      items.map((d) => `<option value="${escapeHtml(d.slug)}">${escapeHtml(d.name)}</option>`).join("") +
      "</optgroup>";
  }
  sel.innerHTML = html;
  sel.value = pg.district || "";
  sel.addEventListener("change", () => {
    pg.district = sel.value || null;
    updateURL();
    renderResults();
  });
}

function scopeName() {
  if (!pg.district) return null;
  const d = DISTRICT_LIST.find((x) => x.slug === pg.district);
  return d ? d.name : pg.district;
}

// ---- turnout signals: marquee + cross-election elasticity & roll growth ------
// Loads every turnout file on file and returns, per precinct:
//   { registered, ballots }  from the marquee (highest-turnout) election, plus
//   { highRate, lowRate }    the precinct's best & worst turnout rate across all
//                            files (feeds Turnout Elasticity), and
//   { regFirst, regLast }    registered totals in the earliest & latest turnout
//                            years (feeds registration growth / churn).
// Null when no turnout files exist. Every field degrades to null when a precinct
// is absent from a file — nothing is fabricated.
async function loadTurnoutSignals() {
  try {
    const races = await svc.listRaces();
    const files = [...new Set(races.map((e) => e.turnoutFile).filter(Boolean))];
    if (!files.length) return null;

    // Load each file with its election year parsed from the filename (for
    // ordering the roll-growth endpoints). County-agnostic: no year is hardcoded.
    const loaded = [];
    for (const f of files) {
      try {
        const rows = await d3.csv(`${svc.config.dataDir}/${f}`, (d) => ({
          precinct: d.precinct,
          registered: +d.registered,
          ballots: +d.ballots_cast,
        }));
        const yearMatch = f.match(/(\d{4})/g);
        const year = yearMatch ? +yearMatch[yearMatch.length - 1] : null;
        const totalBallots = rows.reduce((s, r) => s + (isNaN(r.ballots) ? 0 : r.ballots), 0);
        loaded.push({ year, rows, totalBallots });
      } catch (_) { /* skip a bad turnout file */ }
    }
    if (!loaded.length) return null;

    const marquee = loaded.reduce((best, cur) => (cur.totalBallots > (best?.totalBallots ?? -1) ? cur : best), null);
    if (!marquee || marquee.totalBallots <= 0) return null;

    const withYear = loaded.filter((l) => l.year != null).sort((a, b) => a.year - b.year);
    const earliest = withYear[0] || null;
    const latest = withYear[withYear.length - 1] || null;

    const lookup = {};
    // seed from the marquee so every marquee precinct has registered/ballots
    for (const r of marquee.rows) {
      const code = r.precinct == null ? "" : String(r.precinct);
      if (code === "") continue;
      lookup[code] = {
        registered: isNaN(r.registered) ? null : r.registered,
        ballots: isNaN(r.ballots) ? null : r.ballots,
        highRate: null,
        lowRate: null,
        regFirst: null,
        regLast: null,
      };
    }
    // best/worst turnout rate across all files → elasticity
    for (const file of loaded) {
      for (const r of file.rows) {
        const code = r.precinct == null ? "" : String(r.precinct);
        if (code === "" || !(code in lookup)) continue;
        if (isNaN(r.registered) || r.registered <= 0 || isNaN(r.ballots)) continue;
        const rate = r.ballots / r.registered;
        const e = lookup[code];
        e.highRate = e.highRate == null ? rate : Math.max(e.highRate, rate);
        e.lowRate = e.lowRate == null ? rate : Math.min(e.lowRate, rate);
      }
    }
    // registration endpoints (earliest vs latest year) → roll growth / churn
    const stampReg = (file, key) => {
      if (!file) return;
      for (const r of file.rows) {
        const code = r.precinct == null ? "" : String(r.precinct);
        if (code === "" || !(code in lookup)) continue;
        lookup[code][key] = isNaN(r.registered) ? null : r.registered;
      }
    };
    if (earliest && latest && earliest !== latest) {
      stampReg(earliest, "regFirst");
      stampReg(latest, "regLast");
    }
    return Object.keys(lookup).length ? lookup : null;
  } catch (_) {
    return null;
  }
}

// ---- election scoring -------------------------------------------------------
// Populate the "Score on" dropdown with the active county/district's races, so a
// strategy can rank on ONE election's real per-precinct result instead of the
// precinct's overall partisan lean.
async function populateElectionSelect() {
  const sel = $("tg-election");
  try {
    pg.elections = await svc.listRaces();
  } catch (_) { pg.elections = []; }
  let html = `<option value="">Overall partisan lean</option>`;
  html += pg.elections
    .map((e) => {
      const id = e.raceKey || e.filename;
      const label = e.displayName || e.office || id;
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  sel.innerHTML = html;
  // keep the selection if the chosen race still exists here, else fall back
  if (pg.electionId && !pg.elections.some((e) => (e.raceKey || e.filename) === pg.electionId)) pg.electionId = "";
  sel.value = pg.electionId;
}

// Aggregate one race CSV to per-precinct {rep, dem, total}. Candidate columns are
// every column not in the metadata set; party is the column's first token.
async function loadElectionResults(entry) {
  const rows = await svc.loadRace(entry);
  const byCode = {};
  for (const row of rows) {
    let total = 0, rep = 0, dem = 0;
    for (const k in row) {
      if (ELECTION_META_KEYS.has(k) || k === "Write-in") continue;
      const v = +row[k] || 0;
      if (!v) continue;
      total += v;
      const party = k.split(" ")[0].toUpperCase();
      if (party === "REP") rep += v;
      else if (party === "DEM") dem += v;
    }
    if (total > 0) byCode[String(row["PRECINCT CODE"])] = { rep, dem, total };
  }
  return byCode;
}

// Re-cast the county features with one election's partisanship so targeting.js
// scores flips/defends/persuasion on THAT race. Demographics + population are
// kept from the base feature; only precincts that were on this ballot survive.
function buildElectionFeatures(results) {
  const out = [];
  for (const f of pg.features) {
    const p = f.properties || {};
    const er = results[String(p.PRECINCT)];
    if (!er || er.total <= 0) continue;
    const rep = er.rep, dem = er.dem, mod = Math.max(0, er.total - rep - dem);
    out.push({
      ...f,
      properties: {
        ...p,
        repShare: rep / er.total,
        demShare: dem / er.total,
        modShare: mod / er.total,
        rep, dem, mod,
        winningParty: rep === dem ? (p.winningParty || "Rep") : rep > dem ? "Rep" : "Dem",
      },
    });
  }
  return out;
}

async function applyElection() {
  if (!pg.electionId) { pg.electionFeatures = []; return; }
  const entry = pg.elections.find((e) => (e.raceKey || e.filename) === pg.electionId);
  if (!entry) { pg.electionId = ""; pg.electionFeatures = []; return; }
  try {
    const results = await loadElectionResults(entry);
    pg.electionFeatures = buildElectionFeatures(results);
  } catch (err) {
    console.error("[Targets] election scoring failed:", err);
    // Falling back to overall partisan lean is reasonable; doing it silently is
    // not. The select and the hash would still name the race, so the user reads
    // a lean ranking believing it is that race's result.
    pg.electionError = entry.displayName || entry.office || pg.electionId;
    pg.electionId = ""; pg.electionFeatures = [];
  }
}

function activeElectionLabel() {
  if (!pg.electionId) return null;
  const e = pg.elections.find((x) => (x.raceKey || x.filename) === pg.electionId);
  return e ? (e.displayName || e.office || pg.electionId) : null;
}

// ---- load a county + recompute everything -----------------------------------
async function loadData() {
  $("tg-list").innerHTML = '<div class="empty-note">Loading…</div>';
  $("tg-catalog").innerHTML = "";
  $("tg-na").innerHTML = "";
  try {
    const [{ geojson }, turnout, primary] = await Promise.all([svc.loadAll(), loadTurnoutSignals(), svc.loadPrimaryTurnout()]);
    pg.features = geojson.features || [];
    pg.turnout = turnout;
    pg.primary = primary;
    pg.ctx = {
      hasTurnout: !!turnout,
      hasRacial: pg.features.some((f) => f.properties && f.properties.pct_white != null && !isNaN(f.properties.pct_white)),
      hasPrimary: !!primary,
    };
    // if the chosen strategy isn't supported here, fall back to a universal one
    if (!strategyAvailable(getStrategy(pg.strategy), pg.ctx)) pg.strategy = "tossups";
    await populateElectionSelect();
    await applyElection();
    renderCatalog();
    renderResults();
  } catch (err) {
    console.error("[Targets] load failed:", err);
    $("tg-list").innerHTML = '<div class="empty-note">We couldn’t load the precinct data. Check your internet connection, then <button type="button" class="retry-link" onclick="location.reload()">try again</button>.</div>';
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
      setCatalogOpen(false); // back to the ranked list — the payoff
      const title = $("tg-results-title");
      title.setAttribute("tabindex", "-1");
      title.focus();
    });
  });
}

// ---- "Change strategy" disclosure (single-level, results-first IA) ----------
function setCatalogOpen(open) {
  $("tg-catalog-wrap").hidden = !open;
  const btn = $("tg-strategy-btn");
  btn.setAttribute("aria-expanded", String(open));
  btn.querySelector(".tg-disclose-mark").textContent = open ? "▴" : "▾";
}

function updateStrategyButton() {
  const strat = getStrategy(pg.strategy);
  $("tg-strategy-current").textContent = strat ? `— now: ${strat.label}` : "";
}

// ---- results ----------------------------------------------------------------
function renderResults() {
  const strat = getStrategy(pg.strategy);
  if (!strat) return;
  $("tg-results-title").textContent = pg.district ? `${strat.label} — ${scopeName()}` : strat.label;
  updateStrategyButton();
  const elLabel = activeElectionLabel();
  $("tg-results-sub").textContent = elLabel ? `${strat.blurb} · Scored on ${elLabel}` : strat.blurb;

  if (!strategyAvailable(strat, pg.ctx)) {
    $("tg-results-count").textContent = "";
    $("tg-na").innerHTML = `<div class="na-banner">This strategy needs ${escapeHtml(strat.needs.join(" + "))} data, which isn't on file for this county. Pick another strategy above.</div>`;
    $("tg-list").innerHTML = "";
    return;
  }
  $("tg-na").innerHTML = "";
  if (pg.electionError) {
    $("tg-na").innerHTML = `<div class="na-banner">We couldn't load ${escapeHtml(pg.electionError)} — showing overall partisan lean instead.</div>`;
    pg.electionError = null;
  }

  const base = pg.electionId ? pg.electionFeatures : pg.features;
  // District scope: rank only the scoped district's Collin precincts.
  let feats = base;
  if (pg.district) {
    const codes = new Set(precinctsInDistrict(pg.district, pg.features).map(String));
    feats = base.filter((f) => codes.has(String(f.properties.PRECINCT)));
  }
  const ranked = rankPrecincts(feats, pg.strategy, { turnoutLookup: pg.turnout, primaryLookup: pg.primary, limit: pg.limit });
  // The export ships exactly the ranking on screen — same strategy, same
  // district scope, same limit — so the file and the page can never disagree.
  pg.ranked = ranked;
  const exportBtn = $("tg-export");
  if (exportBtn) exportBtn.hidden = !ranked.length;
  $("tg-results-count").textContent = ranked.length ? `Top ${ranked.length}` : "";
  if (!ranked.length) {
    $("tg-list").innerHTML = pg.electionId
      ? '<div class="empty-note">No precincts on this ballot match this strategy.</div>'
      : '<div class="empty-note">No precincts match this strategy here.</div>';
    return;
  }
  $("tg-list").innerHTML = ranked.map((row, i) => precinctCard(i + 1, row, strat)).join("");
}

function seg(cls, v) {
  return v > 0 ? `<span class="tg-seg-${cls}" style="flex:${v}"></span>` : "";
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
    case "net-vote-opportunity":
      return { val: num(m.nvo), label: "Untapped supporters" };
    case "elastic-gotv-dem": case "elastic-gotv-rep": case "winnable-elastic":
      return { val: pct(m.elasticity), label: "Turnout swing" };
    case "high-growth-register":
      return { val: pct(m.regGrowth), label: "Roll growth" };
    case "diversifying":
      return { val: pct(m.nonWhite), label: "Non-white" };
    case "register":
      return { val: num(Math.max(0, (m.pop || 0) - (m.registered || 0))), label: "Unregistered" };
    case "high-leverage": case "efficient-swing":
      return { val: num(m.votes), label: "Voters" };
    // Labels mirror each strategy's own metricLabel (js/targeting.js). num()
    // maps null -> "N/A", so a precinct with only one primary cycle on file
    // reads N/A rather than a fabricated 0. Deliberately NOT a generic
    // `num(strat.score(m))` fallback: score() returns raw counts here but
    // fractions elsewhere (low-turnout returns 1 - rate), so a generic
    // fallback would print "1" for a 50%-turnout precinct -- trading a
    // visible blank for a silently wrong number.
    case "primary-energy-dem":
      return { val: num(m.primaryDemGrowth), label: "New Dem primary voters" };
    case "primary-energy-rep":
      return { val: num(m.primaryRepGrowth), label: "New Rep primary voters" };
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
  const pParam = encodeURIComponent(m.code);
  const dParam = pg.district ? `district=${encodeURIComponent(pg.district)}&` : "";
  return `<div class="tg-precinct">
    <div class="tg-rank">${rank}</div>
    <div>
      <div class="tg-pcode">Precinct ${escapeHtml(m.code)}</div>
      <div class="tg-leanbar" role="img" aria-label="${r}% Republican, ${mo}% moderate or other, ${d}% Democratic">${seg("rep", r)}${seg("mod", mo)}${seg("dem", d)}</div>
      <div class="tg-why">${escapeHtml(row.explain)}</div>
    </div>
    <div class="tg-pmeta">
      <div><div class="tg-metric-val">${escapeHtml(head.val)}</div><div class="tg-metric-label">${metricLabelHTML(head.label)}</div></div>
      <div class="tg-links">
        <a class="tg-link-report" href="precinct.html#precinct=${pParam}">Report</a>
        <a class="tg-link-map" href="index.html#${dParam}${pg.electionId ? `race=${encodeURIComponent(pg.electionId)}&` : ""}precinct=${pParam}">Map</a>
      </div>
    </div>
  </div>`;
}

// ---- URL sync (deep-linkable) — via the one urlState vocabulary (§5.3) ------
function updateURL() {
  writeParams({
    strategy: pg.strategy,
    top: pg.limit,
    race: pg.electionId || null,
    district: pg.district || null,
  });
}
function readURL() {
  const params = readParams();
  // district= scopes the ranking; legacy county=<district slug> is read-
  // tolerated for old bookmarks (county=collin is simply ignored).
  const wanted = params.district || params.county;
  if (wanted && DISTRICT_LIST.some((d) => d.slug === wanted)) pg.district = wanted;
  if (params.strategy && getStrategy(params.strategy)) pg.strategy = params.strategy;
  if (params.top && [15, 25, 50, 100].includes(+params.top)) pg.limit = +params.top;
  if (params.race) pg.electionId = params.race; // validated against the manifest after load
}

// The ranked list as a spreadsheet. Raw values, not the display strings — a
// column of "62%" is text to a spreadsheet, and an em dash is not a number.
const EXPORT_COLUMNS = [
  { key: "rank", label: "Rank" },
  { key: "precinct", label: "Precinct" },
  { key: "headline", label: "Headline_Metric" },
  { key: "headlineLabel", label: "Headline_Metric_Name" },
  { key: "winner", label: "Modeled_Winner" },
  { key: "margin", label: "Modeled_Margin" },
  { key: "repShare", label: "Rep_Share" },
  { key: "demShare", label: "Dem_Share" },
  { key: "modShare", label: "Mod_Share" },
  { key: "votes", label: "Modeled_Voters" },
  { key: "registered", label: "Registered" },
  { key: "ballots", label: "Ballots_Cast" },
  { key: "rate", label: "Turnout_Rate" },
  { key: "dropoff", label: "Non_Voters" },
  { key: "nonWhite", label: "Pct_NonWhite" },
  { key: "why", label: "Why" },
];

function exportRanked() {
  const ranked = pg.ranked || [];
  if (!ranked.length) return;
  const rows = ranked.map((r, i) => {
    const m = r.metrics;
    const head = headlineFor(pg.strategy, m);
    return {
      rank: i + 1,
      precinct: m.code,
      // headlineFor returns display text ("N/A", "62%"); the CSV wants the
      // number, so re-read the raw metric and let N/A fall through as empty.
      headline: rawHeadline(pg.strategy, m),
      headlineLabel: head.label,
      winner: m.winner,
      margin: m.margin,
      repShare: m.repShare,
      demShare: m.demShare,
      modShare: m.modShare,
      votes: m.votes,
      registered: m.registered,
      ballots: m.ballots,
      rate: m.rate,
      dropoff: m.dropoff,
      nonWhite: m.nonWhite,
      why: r.explain,
    };
  });
  const name = exportFilename("collin-priority-precincts", [pg.strategy, pg.district]);
  downloadFile(toCsv(EXPORT_COLUMNS, rows), name, "text/csv");
  const sub = $("tg-results-sub");
  if (sub) sub.textContent = `Downloaded ${name} (${rows.length} precincts).`;
}

// The raw number behind headlineFor's display string, so the CSV stays numeric.
function rawHeadline(id, m) {
  switch (id) {
    case "tossups": case "flip-dem-rep": case "flip-rep-dem": return m.margin;
    case "mobilize-rep": case "mobilize-dem": case "low-turnout": return m.rate;
    case "net-vote-opportunity": return m.nvo;
    case "elastic-gotv-dem": case "elastic-gotv-rep": case "winnable-elastic": return m.elasticity;
    case "high-growth-register": return m.regGrowth;
    case "diversifying": return m.nonWhite;
    case "register": return Math.max(0, (m.pop || 0) - (m.registered || 0));
    case "high-leverage": case "efficient-swing": return m.votes;
    case "primary-energy-dem": return m.primaryDemGrowth;
    case "primary-energy-rep": return m.primaryRepGrowth;
    default: return null;
  }
}

// ---- boot -------------------------------------------------------------------
async function init() {
  readURL();
  initGlossary(); // tap-to-define popovers on metric labels
  $("tg-strategy-btn").addEventListener("click", () => {
    setCatalogOpen($("tg-catalog-wrap").hidden);
  });
  $("tg-limit").value = String(pg.limit);
  $("tg-limit").addEventListener("change", (e) => {
    pg.limit = +e.target.value;
    updateURL();
    renderResults();
  });
  $("tg-election").addEventListener("change", async (e) => {
    pg.electionId = e.target.value;
    updateURL();
    // A slow earlier pick must not overwrite a later one's features.
    const t = ++pg.electionSeq;
    await applyElection();
    if (t !== pg.electionSeq) return;
    // applyElection clears electionId on failure — resync the select and the
    // hash so neither keeps claiming a race we are not scoring on.
    if (pg.electionError) {
      e.target.value = "";
      updateURL();
    }
    renderResults();
  });
  $("tg-export").addEventListener("click", exportRanked);
  initDistrictSelect();
  await loadData();
  $("tg-election").value = pg.electionId; // reflect a deep-linked race once the manifest is in
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
