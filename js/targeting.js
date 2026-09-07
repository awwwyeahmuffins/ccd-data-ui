// targeting.js
// --------------------------------------------------------------------------------
// Pure scoring engine for the precinct-targeting view (targets.html). No DOM.
//
// Given the per-precinct signals the app already carries — modeled party
// universe (rep/mod/dem counts + shares + strength + winner from dnc_scores),
// racial composition, and per-election turnout (registered / ballots) — it ranks
// a county's precincts under a catalogue of campaign-targeting STRATEGIES.
//
// Each strategy is a small, transparent scoring function over derived metrics,
// grouped into four real-world targeting jobs: move the result (flip/persuade),
// turn out existing support (mobilize), grow the electorate (demographics), and
// spend effort where it counts (leverage). Strategies declare what data they
// `needs` so the UI can honestly mark ones a county can't support (N/A) rather
// than inventing numbers. Nothing here estimates or fabricates votes.

// ---- formatters (kept local so this module imports nothing) -----------------
const pct = (v) => (v == null || isNaN(v) ? "N/A" : `${Math.round(v * 100)}%`);
const num = (v) => (v == null || isNaN(v) ? "N/A" : Math.round(v).toLocaleString());

export const STRATEGY_CATEGORIES = [
  { id: "flip", label: "Flip & Persuade", blurb: "Move the result — close races and persuadable voters." },
  { id: "turnout", label: "Mobilize & Turn Out", blurb: "Turn out existing support that stayed home." },
  { id: "demo", label: "Grow the Electorate", blurb: "Demographics, registration, and shifting turf." },
  { id: "leverage", label: "Where Effort Pays Most", blurb: "Spend effort where it moves the most votes." },
];

// Build the normalized metric bundle a strategy scores. Returns null when a
// precinct has no modeled party data (can't be targeted on partisan terms).
//
// `turnout` is the precinct's marquee row `{ registered, ballots }` and MAY
// carry optional cross-election signals the targets loader fills in:
//   highRate / lowRate — the precinct's best & worst turnout rate across the
//     turnout files on file (drives Turnout Elasticity — how much a precinct's
//     turnout fluctuates between high- and low-propensity elections).
//   regFirst / regLast — registered totals in the earliest & latest turnout
//     years on file (drives registration growth / churn).
// All are optional: absent → the derived field is null (never fabricated).
export function derivePrecinctMetrics(p, turnout, primary) {
  if (p == null || p.repShare == null || isNaN(p.repShare) || !p.winningParty) return null;
  const repShare = +p.repShare;
  const demShare = +p.demShare;
  const modShare = +(p.modShare || 0);
  const demCount = +p.dem || 0;
  const repCount = +p.rep || 0;
  const votes = repCount + (+p.mod || 0) + demCount;
  // No modeled voters at all = no universe to target. Such a row still carries
  // repShare 0.0 / winningParty "Rep", so without this it ranks as a perfect
  // "Rep +0% -- within reach" tossup. NOTE: this is a >0 test, deliberately not
  // the literal 50 used by explore/campaign/trends -- those floors are on
  // ballots cast per race, `votes` here is the modeled DNC universe.
  if (!(votes > 0)) return null;
  const reg = turnout && turnout.registered != null && !isNaN(turnout.registered) ? +turnout.registered : null;
  const bal = turnout && turnout.ballots != null && !isNaN(turnout.ballots) ? +turnout.ballots : null;
  const rate = reg && reg > 0 && bal != null ? bal / reg : null;

  // Turnout elasticity: the spread between the precinct's best and worst turnout
  // rate on file. High = "the voters exist, they just skip low-salience
  // elections" → prime GOTV. Low (inelastic) = turnout is rock-solid every year
  // → winning here needs persuasion, not reminders. Null unless BOTH rates known.
  const highRate = numOrNull(turnout?.highRate);
  const lowRate = numOrNull(turnout?.lowRate);
  const elasticity = highRate != null && lowRate != null ? Math.max(0, highRate - lowRate) : null;

  // Net Vote Opportunity: modeled party universe still sitting home at the
  // marquee turnout rate — the gap campaigns actually target, not raw registration.
  const nvoDem = rate != null ? Math.round(demCount * (1 - rate)) : null;
  const nvoRep = rate != null ? Math.round(repCount * (1 - rate)) : null;
  const lean = repShare - demShare;
  const nvo = lean < 0 ? nvoDem : lean > 0 ? nvoRep : (nvoDem != null && nvoRep != null ? Math.max(nvoDem, nvoRep) : null);

  // Registration growth / churn: how much the roll has changed across cycles.
  // High growth in booming suburbs means the 2024 partisan snapshot decays fast
  // — register/address-update work must come before standard GOTV. Null unless
  // two registration snapshots exist.
  const regFirst = numOrNull(turnout?.regFirst);
  const regLast = numOrNull(turnout?.regLast);
  const regGrowth = regFirst != null && regFirst > 0 && regLast != null ? (regLast - regFirst) / regFirst : null;

  return {
    code: String(p.PRECINCT),
    winner: p.winningParty,
    repShare,
    demShare,
    modShare,
    lean,                                // >0 Rep, <0 Dem
    margin: Math.abs(repShare - demShare), // 0 = tossup, 1 = landslide
    strength: +p.partyStrength || 0,
    votes,
    demCount,
    repCount,
    pop: p.total != null && !isNaN(p.total) ? +p.total : null,
    nonWhite: p.pct_white != null && !isNaN(p.pct_white) ? 1 - +p.pct_white : null,
    registered: reg,
    ballots: bal,
    rate,
    dropoff: reg != null && bal != null ? Math.max(0, reg - bal) : null,
    elasticity,
    nvoDem,
    nvoRep,
    nvo,
    regGrowth,
    ...derivePrimaryMetrics(primary),
  };
}

function numOrNull(v) {
  return v == null || isNaN(v) ? null : +v;
}

// Party-primary ballots (official county reports): earliest vs latest cycle on
// file. Growth fields are null unless the precinct has 2+ cycles of history —
// new precincts never fabricate a trend.
function derivePrimaryMetrics(primary) {
  const years = primary ? Object.keys(primary).map(Number).sort((a, b) => a - b) : [];
  if (!years.length) {
    return { primaryDemNow: null, primaryRepNow: null, primaryDemFirst: null, primaryRepFirst: null, primaryDemGrowth: null, primaryRepGrowth: null, primaryFirstYear: null, primaryLastYear: null };
  }
  const first = primary[years[0]];
  const last = primary[years[years.length - 1]];
  const multi = years.length >= 2;
  return {
    primaryDemNow: last.dem,
    primaryRepNow: last.rep,
    primaryDemFirst: multi ? first.dem : null,
    primaryRepFirst: multi ? first.rep : null,
    primaryDemGrowth: multi ? last.dem - first.dem : null,
    primaryRepGrowth: multi ? last.rep - first.rep : null,
    primaryFirstYear: years[0],
    primaryLastYear: years[years.length - 1],
  };
}

// The catalogue. score(m) → higher = stronger target; null = ineligible (filtered).
export const STRATEGIES = [
  // ---- A. FLIP & PERSUADE ----------------------------------------------------
  {
    id: "flip-dem-rep", cat: "flip", icon: "flip", label: "Flippable to Republicans", needs: [], metricLabel: "Dem margin",
    blurb: "Dem-won precincts with a thin margin and a big persuadable middle — the most realistic Republican pickups.",
    score: (m) => (m.winner === "Dem" ? (1 - m.margin) * (0.6 + 0.4 * m.modShare) : null),
    explain: (m) => `Dem +${pct(m.margin)} · ${pct(m.modShare)} moderate`,
  },
  {
    id: "flip-rep-dem", cat: "flip", icon: "flip", label: "Flippable to Democrats", needs: [], metricLabel: "Rep margin",
    blurb: "Rep-won precincts with a thin margin and a big persuadable middle — the most realistic Democratic pickups.",
    score: (m) => (m.winner === "Rep" ? (1 - m.margin) * (0.6 + 0.4 * m.modShare) : null),
    explain: (m) => `Rep +${pct(m.margin)} · ${pct(m.modShare)} moderate`,
  },
  {
    id: "tossups", cat: "flip", icon: "scale", label: "Closest Races", needs: [], metricLabel: "Margin",
    blurb: "The genuine battlegrounds: the smallest win margins regardless of who currently leads.",
    score: (m) => 1 - m.margin,
    explain: (m) => `${m.winner} +${pct(m.margin)} — within reach`,
  },
  {
    id: "defend-rep", cat: "flip", icon: "shield", label: "Defend Republican Leads", needs: [], metricLabel: "How winnable",
    blurb: "Rep-held but exposed: a modest margin plus a large moderate bloc that could slip. Shore these up.",
    score: (m) => (m.winner === "Rep" ? m.modShare * (1 - m.margin) : null),
    explain: (m) => `Rep +${pct(m.margin)} · ${pct(m.modShare)} persuadable`,
  },
  {
    id: "defend-dem", cat: "flip", icon: "shield", label: "Defend Democratic Leads", needs: [], metricLabel: "How winnable",
    blurb: "Dem-held but exposed: a modest margin plus a large moderate bloc that could slip. Shore these up.",
    score: (m) => (m.winner === "Dem" ? m.modShare * (1 - m.margin) : null),
    explain: (m) => `Dem +${pct(m.margin)} · ${pct(m.modShare)} persuadable`,
  },
  {
    id: "persuasion", cat: "flip", icon: "chat", label: "Most Persuadable Voters", needs: [], metricLabel: "Moderate voters",
    blurb: "Where the most minds are movable: the largest absolute bloc of moderate / swing voters.",
    score: (m) => m.modShare * (m.votes || 1),
    explain: (m) => `${num(m.modShare * (m.votes || 0))} moderates · ${pct(m.modShare)}`,
  },
  {
    id: "winnable-elastic", cat: "flip", icon: "target", label: "Winnable & Not Maxed Out", needs: ["turnout"], metricLabel: "Room to move",
    blurb: "The tight-margin fix: close races where turnout still has room to grow — a thin margin multiplied by turnout elasticity. Skips the maxed-out trench wars where every mind is made up.",
    score: (m) => (m.elasticity != null ? (1 - m.margin) * m.elasticity : null),
    explain: (m) => `${m.winner} +${pct(m.margin)} · turnout swings ${pct(m.elasticity)} between elections`,
  },

  // ---- B. MOBILIZE & TURN OUT (need turnout) ---------------------------------
  {
    id: "turnout-gap", cat: "turnout", icon: "trend", label: "Turnout Opportunity", needs: ["turnout"], metricLabel: "Non-voters",
    blurb: "The most registered voters who sat out even the highest-turnout election — the biggest pool to bring to the polls.",
    score: (m) => m.dropoff,
    explain: (m) => `${num(m.dropoff)} sat out · ${pct(m.rate)} turnout`,
  },
  {
    id: "mobilize-rep", cat: "turnout", icon: "rep", label: "Mobilize Rep Base", needs: ["turnout"], metricLabel: "Untapped Rep",
    blurb: "Rep-leaning precincts with low turnout: untapped Republican votes waiting to be mobilized.",
    score: (m) => (m.lean > 0 && m.rate != null ? m.repShare * (1 - m.rate) * (m.registered || 0) : null),
    explain: (m) => `Rep ${pct(m.repShare)} · only ${pct(m.rate)} turned out`,
  },
  {
    id: "mobilize-dem", cat: "turnout", icon: "dem", label: "Mobilize Dem Base", needs: ["turnout"], metricLabel: "Untapped Dem",
    blurb: "Dem-leaning precincts with low turnout: untapped Democratic votes waiting to be mobilized.",
    score: (m) => (m.lean < 0 && m.rate != null ? m.demShare * (1 - m.rate) * (m.registered || 0) : null),
    explain: (m) => `Dem ${pct(m.demShare)} · only ${pct(m.rate)} turned out`,
  },
  {
    id: "low-turnout", cat: "turnout", icon: "sleep", label: "Chronic Low Turnout", needs: ["turnout"], metricLabel: "Turnout rate",
    blurb: "The lowest turnout rates of all — civic-engagement and GOTV targets regardless of which way they lean.",
    score: (m) => (m.rate != null ? 1 - m.rate : null),
    explain: (m) => `${pct(m.rate)} turnout · ${num(m.dropoff)} non-voters`,
  },
  {
    id: "primary-energy-dem", cat: "turnout", icon: "dem", label: "Dem Primary Energy", needs: ["primary"], metricLabel: "New Dem primary voters",
    blurb: "Where Democratic primary turnout grew the most — the most newly energized Democratic voters to organize (official county primary ballots).",
    score: (m) => m.primaryDemGrowth,
    explain: (m) => `${num(m.primaryDemFirst)} → ${num(m.primaryDemNow)} Dem primary ballots (${m.primaryFirstYear}→${m.primaryLastYear})`,
  },
  {
    id: "primary-energy-rep", cat: "turnout", icon: "rep", label: "Rep Primary Energy", needs: ["primary"], metricLabel: "New Rep primary voters",
    blurb: "Where Republican primary turnout grew the most — the most newly energized Republican voters to organize (official county primary ballots).",
    score: (m) => m.primaryRepGrowth,
    explain: (m) => `${num(m.primaryRepFirst)} → ${num(m.primaryRepNow)} Rep primary ballots (${m.primaryFirstYear}→${m.primaryLastYear})`,
  },
  {
    id: "net-vote-opportunity", cat: "turnout", icon: "trend", label: "Net Vote Opportunity", needs: ["turnout"], metricLabel: "Untapped supporters",
    blurb: "The Big-Blue-Block fix: the leading party's modeled supporters who still sat home — targets the GAP between your voters and your turnout, not the raw registration count. A precinct with fewer supporters but a bigger gap beats a big block that already all votes.",
    score: (m) => m.nvo,
    explain: (m) => `${num(m.nvo)} ${m.lean < 0 ? "Dem" : "Rep"} supporters home · ${pct(m.rate)} turnout`,
  },
  {
    id: "elastic-gotv-dem", cat: "turnout", icon: "dem", label: "Elastic Dem GOTV", needs: ["turnout"], metricLabel: "Elastic Dem voters",
    blurb: "Dem-leaning precincts whose turnout swings hardest between big and small elections — the voters exist, they just skip the off-years. The highest-ROI door-knocks in the final 30 days.",
    score: (m) => (m.lean < 0 && m.elasticity != null ? m.elasticity * m.demShare * (m.registered || m.votes || 0) : null),
    explain: (m) => `Dem ${pct(m.demShare)} · turnout swings ${pct(m.elasticity)} between elections`,
  },
  {
    id: "elastic-gotv-rep", cat: "turnout", icon: "rep", label: "Elastic Rep GOTV", needs: ["turnout"], metricLabel: "Elastic Rep voters",
    blurb: "Rep-leaning precincts whose turnout swings hardest between big and small elections — untapped base that shows up for presidentials but skips the off-years.",
    score: (m) => (m.lean > 0 && m.elasticity != null ? m.elasticity * m.repShare * (m.registered || m.votes || 0) : null),
    explain: (m) => `Rep ${pct(m.repShare)} · turnout swings ${pct(m.elasticity)} between elections`,
  },

  // ---- C. GROW THE ELECTORATE ------------------------------------------------
  {
    id: "diversifying", cat: "demo", icon: "globe", label: "Diversifying Precincts", needs: ["racial"], metricLabel: "Non-white",
    blurb: "The highest share of non-white residents — often the fastest-shifting and most under-engaged turf.",
    score: (m) => m.nonWhite,
    explain: (m) => `${pct(m.nonWhite)} non-white · ${m.winner} lean`,
  },
  {
    id: "register", cat: "demo", icon: "pen", label: "Registration Opportunity", needs: ["racial", "turnout"], metricLabel: "Unregistered (est.)",
    blurb: "The largest gap between residents and registered voters — the most room to register new voters.",
    score: (m) => (m.pop != null && m.registered != null ? Math.max(0, m.pop - m.registered) : null),
    explain: (m) => `~${num(Math.max(0, (m.pop || 0) - (m.registered || 0)))} unregistered residents`,
  },
  {
    id: "high-growth-register", cat: "demo", icon: "pen", label: "Fast-Growing Turf", needs: ["turnout"], metricLabel: "Roll growth",
    blurb: "The Static-Universe fix: precincts whose voter roll grew the most across cycles. New subdivisions and high turnover mean the old partisan read decays fast — run registration and address-update work here before standard GOTV.",
    score: (m) => (m.regGrowth != null && m.regGrowth > 0 ? m.regGrowth : null),
    explain: (m) => `Roll grew ${pct(m.regGrowth)} across cycles · verify addresses first`,
  },

  // ---- D. LEVERAGE & EFFICIENCY ----------------------------------------------
  {
    id: "high-leverage", cat: "leverage", icon: "weight", label: "Biggest Precincts", needs: [], metricLabel: "Voters to contact",
    blurb: "The largest voter universes — where a small percentage swing moves the most absolute votes.",
    score: (m) => m.votes,
    explain: (m) => `${num(m.votes)} modeled voters · ${m.winner} +${pct(m.margin)}`,
  },
  {
    id: "efficient-swing", cat: "leverage", icon: "target", label: "Big, Close Precincts", needs: [], metricLabel: "Payoff score",
    blurb: "Competitive and big at once: the best return on persuasion — a close margin multiplied by precinct size.",
    score: (m) => (1 - m.margin) * m.votes,
    explain: (m) => `${num(m.votes)} voters · ${m.winner} +${pct(m.margin)}`,
  },
];

export function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) || null;
}

// A strategy is available when the county carries the data it needs.
export function strategyAvailable(strategy, ctx) {
  if (!strategy) return false;
  const needs = strategy.needs || [];
  if (needs.includes("turnout") && !ctx.hasTurnout) return false;
  if (needs.includes("racial") && !ctx.hasRacial) return false;
  if (needs.includes("primary") && !ctx.hasPrimary) return false;
  return true;
}

// Rank a county's precincts under one strategy.
//   features      — GeoJSON features with merged precinct properties
//   strategyId    — which strategy
//   turnoutLookup — { [precinctCode]: { registered, ballots } } (optional)
//   limit         — max rows (default 50)
// Returns [{ code, score, explain, metrics }] sorted strongest-first.
export function rankPrecincts(features, strategyId, { turnoutLookup = null, primaryLookup = null, limit = 50 } = {}) {
  const strat = getStrategy(strategyId);
  if (!strat) return [];
  const rows = [];
  for (const f of features || []) {
    const p = f.properties || f; // accept raw props too (tests)
    const t = turnoutLookup ? turnoutLookup[String(p.PRECINCT)] : null;
    const m = derivePrecinctMetrics(p, t, primaryLookup ? primaryLookup[String(p.PRECINCT)] : null);
    if (!m) continue;
    const score = strat.score(m);
    if (score == null || isNaN(score)) continue;
    rows.push({ code: m.code, score, explain: strat.explain(m), metrics: m });
  }
  rows.sort((a, b) => b.score - a.score);
  return limit ? rows.slice(0, limit) : rows;
}
