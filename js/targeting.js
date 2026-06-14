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
  { id: "leverage", label: "Leverage & Efficiency", blurb: "Spend effort where it moves the most votes." },
];

// Build the normalized metric bundle a strategy scores. Returns null when a
// precinct has no modeled party data (can't be targeted on partisan terms).
export function derivePrecinctMetrics(p, turnout) {
  if (p == null || p.repShare == null || isNaN(p.repShare) || !p.winningParty) return null;
  const repShare = +p.repShare;
  const demShare = +p.demShare;
  const modShare = +(p.modShare || 0);
  const votes = (+p.rep || 0) + (+p.mod || 0) + (+p.dem || 0);
  const reg = turnout && turnout.registered != null && !isNaN(turnout.registered) ? +turnout.registered : null;
  const bal = turnout && turnout.ballots != null && !isNaN(turnout.ballots) ? +turnout.ballots : null;
  return {
    code: String(p.PRECINCT),
    winner: p.winningParty,
    repShare,
    demShare,
    modShare,
    lean: repShare - demShare,           // >0 Rep, <0 Dem
    margin: Math.abs(repShare - demShare), // 0 = tossup, 1 = landslide
    strength: +p.partyStrength || 0,
    votes,
    pop: p.total != null && !isNaN(p.total) ? +p.total : null,
    nonWhite: p.pct_white != null && !isNaN(p.pct_white) ? 1 - +p.pct_white : null,
    registered: reg,
    ballots: bal,
    rate: reg && reg > 0 && bal != null ? bal / reg : null,
    dropoff: reg != null && bal != null ? Math.max(0, reg - bal) : null,
  };
}

// The catalogue. score(m) → higher = stronger target; null = ineligible (filtered).
export const STRATEGIES = [
  // ---- A. FLIP & PERSUADE ----------------------------------------------------
  {
    id: "flip-dem-rep", cat: "flip", icon: "flip", label: "Flip Dem → Rep", needs: [], metricLabel: "Dem margin",
    blurb: "Dem-won precincts with a thin margin and a big persuadable middle — the most realistic Republican pickups.",
    score: (m) => (m.winner === "Dem" ? (1 - m.margin) * (0.6 + 0.4 * m.modShare) : null),
    explain: (m) => `Dem +${pct(m.margin)} · ${pct(m.modShare)} moderate`,
  },
  {
    id: "flip-rep-dem", cat: "flip", icon: "flip", label: "Flip Rep → Dem", needs: [], metricLabel: "Rep margin",
    blurb: "Rep-won precincts with a thin margin and a big persuadable middle — the most realistic Democratic pickups.",
    score: (m) => (m.winner === "Rep" ? (1 - m.margin) * (0.6 + 0.4 * m.modShare) : null),
    explain: (m) => `Rep +${pct(m.margin)} · ${pct(m.modShare)} moderate`,
  },
  {
    id: "tossups", cat: "flip", icon: "scale", label: "Pure Tossups", needs: [], metricLabel: "Margin",
    blurb: "The genuine battlegrounds: the smallest win margins regardless of who currently leads.",
    score: (m) => 1 - m.margin,
    explain: (m) => `${m.winner} +${pct(m.margin)} — within reach`,
  },
  {
    id: "defend-rep", cat: "flip", icon: "shield", label: "Soft Rep — Defend", needs: [], metricLabel: "Vulnerability",
    blurb: "Rep-held but exposed: a modest margin plus a large moderate bloc that could slip. Shore these up.",
    score: (m) => (m.winner === "Rep" ? m.modShare * (1 - m.margin) : null),
    explain: (m) => `Rep +${pct(m.margin)} · ${pct(m.modShare)} persuadable`,
  },
  {
    id: "defend-dem", cat: "flip", icon: "shield", label: "Soft Dem — Defend", needs: [], metricLabel: "Vulnerability",
    blurb: "Dem-held but exposed: a modest margin plus a large moderate bloc that could slip. Shore these up.",
    score: (m) => (m.winner === "Dem" ? m.modShare * (1 - m.margin) : null),
    explain: (m) => `Dem +${pct(m.margin)} · ${pct(m.modShare)} persuadable`,
  },
  {
    id: "persuasion", cat: "flip", icon: "chat", label: "Persuasion-Rich", needs: [], metricLabel: "Moderate voters",
    blurb: "Where the most minds are movable: the largest absolute bloc of moderate / swing voters.",
    score: (m) => m.modShare * (m.votes || 1),
    explain: (m) => `${num(m.modShare * (m.votes || 0))} moderates · ${pct(m.modShare)}`,
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

  // ---- D. LEVERAGE & EFFICIENCY ----------------------------------------------
  {
    id: "high-leverage", cat: "leverage", icon: "weight", label: "Biggest Precincts", needs: [], metricLabel: "Voter universe",
    blurb: "The largest voter universes — where a small percentage swing moves the most absolute votes.",
    score: (m) => m.votes,
    explain: (m) => `${num(m.votes)} modeled voters · ${m.winner} +${pct(m.margin)}`,
  },
  {
    id: "efficient-swing", cat: "leverage", icon: "target", label: "Efficient Swing", needs: [], metricLabel: "Swing value",
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
  return true;
}

// Rank a county's precincts under one strategy.
//   features      — GeoJSON features with merged precinct properties
//   strategyId    — which strategy
//   turnoutLookup — { [precinctCode]: { registered, ballots } } (optional)
//   limit         — max rows (default 50)
// Returns [{ code, score, explain, metrics }] sorted strongest-first.
export function rankPrecincts(features, strategyId, { turnoutLookup = null, limit = 50 } = {}) {
  const strat = getStrategy(strategyId);
  if (!strat) return [];
  const rows = [];
  for (const f of features || []) {
    const p = f.properties || f; // accept raw props too (tests)
    const t = turnoutLookup ? turnoutLookup[String(p.PRECINCT)] : null;
    const m = derivePrecinctMetrics(p, t);
    if (!m) continue;
    const score = strat.score(m);
    if (score == null || isNaN(score)) continue;
    rows.push({ code: m.code, score, explain: strat.explain(m), metrics: m });
  }
  rows.sort((a, b) => b.score - a.score);
  return limit ? rows.slice(0, limit) : rows;
}
