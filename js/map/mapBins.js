// mapBins.js — the single source of truth for how map values become words.
//
// Every encoding on the map is binned (5 named steps with explicit numeric
// ranges — never a continuous ramp a 60+ eye must decode), and every bin has
// a plain-language name. The same functions feed:
//   - the polygon fill (commandCenter.js),
//   - the legend rows,
//   - each polygon's aria-label,
//   - the tap readout card,
//   - the List View rows (listView.js).
// One formatter everywhere means the map and its text can never disagree.

// Ramp colors (warm paper → deep color, pale steps read on cream).
export const RAMPS = {
  margin: ["#EDF1F8", "#B9CCEB", "#7FA6DD", "#3D74C4", "#0B4DA2"],
  diversity: ["#E8EEEA", "#A9CBC8", "#6FB0A0", "#3E9377", "#1C6B4F"],
  nonpartisan: ["#EAF1EE", "#BFD9CF", "#8DBBA8", "#579A7F", "#23745A"],
};

// Victory margin, in |dem − rep| share points. Ranges chosen so "close"
// matches how organizers actually talk about races.
export const MARGIN_BINS = [
  { max: 0.05, name: "Very close", range: "under 5 points" },
  { max: 0.15, name: "Close", range: "5–15 points" },
  { max: 0.3, name: "Clear", range: "15–30 points" },
  { max: 0.5, name: "Strong", range: "30–50 points" },
  { max: Infinity, name: "Landslide", range: "over 50 points" },
];

// Share of residents who are not non-Hispanic white.
export const DIVERSITY_BINS = [
  { max: 0.2, name: "Under 20%", range: "under 20% non-white" },
  { max: 0.4, name: "20–40%", range: "20–40% non-white" },
  { max: 0.6, name: "40–60%", range: "40–60% non-white" },
  { max: 0.8, name: "60–80%", range: "60–80% non-white" },
  { max: Infinity, name: "Over 80%", range: "over 80% non-white" },
];

// Non-partisan race decisiveness reuses the margin ranges.
export const NONPARTISAN_BINS = MARGIN_BINS;

// value (0..1) -> bin index, or -1 for missing data. NaN never bins.
export function binIndex(value, bins) {
  if (value == null || isNaN(value)) return -1;
  const v = Math.max(0, value);
  for (let i = 0; i < bins.length; i++) if (v < bins[i].max || i === bins.length - 1) return i;
  return bins.length - 1;
}

export const marginBin = (v) => binIndex(v, MARGIN_BINS);
export const diversityBin = (v) => binIndex(v, DIVERSITY_BINS);

// Spelled-out party names — abbreviations are jargon.
export const PARTY_NAMES = {
  Rep: "Republican",
  REP: "Republican",
  Dem: "Democratic",
  DEM: "Democratic",
  Mod: "Moderate / mixed",
  Lib: "Libertarian",
  Grn: "Green",
  Ind: "Independent",
};
export const partyName = (p) => PARTY_NAMES[p] || p || "Unknown";

export const STRENGTH_WORDS = { 1: "slight", 2: "solid", 3: "strong" };

const pctPts = (v) => `${Math.round(Math.abs(v) * 100)} points`;
const pct = (v) => `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------------------
// describePrecinct — the one plain-language sentence for a precinct in the
// current view. Used verbatim as the polygon aria-label, the readout card
// text, and the List View card line.
//   p:   merged feature properties (winningParty, partyStrength, demShare,
//        repShare, pct_white, PRECINCT)
//   ctx: { mode: "lean"|"margin"|"diversity"|"primary",
//          race?: {partisan, byPrecinct},
//          primary?: { code: { year: {dem,rep} } }, primaryYear?: number }
// ---------------------------------------------------------------------------
export function describePrecinct(p, ctx = {}) {
  const code = String(p.PRECINCT ?? "?");
  const prefix = `Precinct ${code}`;

  if (ctx.race) {
    const r = ctx.race.byPrecinct?.[code];
    if (!r || r.total === 0 || !r.winner) return `${prefix} — not on this ballot`;
    const who = ctx.race.partisan === false ? r.winnerName || r.winner : partyName(r.winner);
    const bin = MARGIN_BINS[binIndex(r.margin, MARGIN_BINS)];
    return `${prefix} — ${who} won by ${pctPts(r.margin)} (${bin.name.toLowerCase()}) · ${Number(r.total).toLocaleString()} votes`;
  }

  if (ctx.mode === "margin") {
    if (p.demShare == null || isNaN(p.demShare)) return `${prefix} — no margin data (N/A)`;
    const m = Math.abs(p.demShare - p.repShare);
    const bin = MARGIN_BINS[marginBin(m)];
    return `${prefix} — decided by ${pctPts(m)}: ${bin.name.toLowerCase()} (${bin.range})`;
  }

  if (ctx.mode === "diversity") {
    if (p.pct_white == null || isNaN(p.pct_white)) return `${prefix} — no Census data (N/A)`;
    const nw = 1 - p.pct_white;
    return `${prefix} — ${pct(nw)} of residents are not white`;
  }

  if (ctx.mode === "primary") {
    const rec = ctx.primary?.[code]?.[ctx.primaryYear];
    if (!rec || rec.dem + rec.rep === 0) return `${prefix} — no primary turnout data (N/A)`;
    const share = rec.dem / (rec.dem + rec.rep);
    return `${prefix} — ${Number(rec.dem).toLocaleString()} Democratic vs ${Number(rec.rep).toLocaleString()} Republican primary ballots (${pct(share)} Dem)`;
  }

  // lean (default)
  if (!p.winningParty) return `${prefix} — no party data (N/A)`;
  const strength = STRENGTH_WORDS[p.partyStrength] || "";
  return `${prefix} — leans ${partyName(p.winningParty)}${strength ? ` (${strength} lean)` : ""}`;
}

// Legend model per view: rows of { name, range } matching the bins above.
export function legendBins(kind) {
  const bins = kind === "diversity" ? DIVERSITY_BINS : MARGIN_BINS;
  return bins.map((b, i) => ({ ...b, index: i }));
}
