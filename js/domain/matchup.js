// domain/matchup.js
// --------------------------------------------------------------------------------
// General-election matchup projector: pairs the 2026 party primaries by office,
// finds each primary's county-wide leader, and synthesizes a two-candidate
// election (the primary winners' names over a chosen historical general's
// per-precinct votes) that the turnout simulator can run scenarios on. Pure
// domain module: no fetch, no DOM, no HTML strings — manifest entries, pivoted
// race rows, and candidate-column lists all arrive as arguments (the page gets
// candidate columns from electionSchema.getCandidateColumns, which domain/
// cannot import).
//
// The projection is honest about what it is: it RE-PLAYS the baseline race's
// two-party vote in every precinct with the 2026 nominees' names on it. It is
// an anchored what-if, not a prediction — the page copy owns that disclosure.

import { extractParty, determineWinner } from "./simulator.js";

// Office-name variants that appear with different strings on the two party
// ballots in the 2026 manifest; both map to one canonical office so the pair
// matches. Keyed by the variant, valued with the canonical form.
export const OFFICE_ALIASES = Object.freeze({
  "Commissioner General Land Office": "Commissioner of the General Land Office",
  "Justice Supreme Court Place 2 Unexpired Term": "Justice Supreme Court Place 2 Unexpired",
});

// Party-internal contests that have no November general election — never a
// matchup, even though both parties ran one.
export const MATCHUP_EXCLUDED = Object.freeze([
  /^Proposition\s/i,
  /^Precinct Chair\b/i,
  /^County Chair$/i,
]);

// Marquee contests listed before the rest (the order voters would look for).
const PROMINENT = ["Governor", "Lieutenant Governor", "US Senator", "Attorney General"];

const PRIMARY_PREFIX = /^(DEM|REP)\s+/;

/** Strip the DEM/REP ballot prefix and normalize known office-name variants. */
export function canonicalOffice(office) {
  if (!office || typeof office !== "string") return null;
  const bare = office.replace(PRIMARY_PREFIX, "").trim();
  return OFFICE_ALIASES[bare] || bare;
}

function isExcluded(office) {
  return MATCHUP_EXCLUDED.some((re) => re.test(office));
}

/**
 * Pair the 2026 DEM/REP primary manifest entries by office.
 * @param {Array<object>} elections - normalized manifest entries (svc.listRaces())
 * @returns {Array<{office, category, dem, rep}>} offices with BOTH primaries,
 *   marquee contests first, then Federal → State → County, then alphabetical.
 */
export function pairPrimaryOffices(elections) {
  if (!Array.isArray(elections)) return [];
  const byOffice = new Map();
  for (const e of elections) {
    if (!e || e.year !== 2026 || !PRIMARY_PREFIX.test(e.office || "")) continue;
    const office = canonicalOffice(e.office);
    if (!office || isExcluded(office)) continue;
    const side = e.office.startsWith("DEM") ? "dem" : "rep";
    const slot = byOffice.get(office) || { office, category: null, dem: null, rep: null };
    slot[side] = e;
    slot.category = slot.category || e.category || null;
    byOffice.set(office, slot);
  }
  const catRank = { Federal: 0, State: 1, County: 2 };
  return [...byOffice.values()]
    .filter((p) => p.dem && p.rep)
    .sort((a, b) => {
      const pa = PROMINENT.indexOf(a.office);
      const pb = PROMINENT.indexOf(b.office);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? PROMINENT.length : pa) - (pb === -1 ? PROMINENT.length : pb);
      const ca = catRank[a.category] ?? 3;
      const cb = catRank[b.category] ?? 3;
      return ca - cb || a.office.localeCompare(b.office);
    });
}

/**
 * County-wide candidate field for one primary: each candidate column summed
 * across the pivoted rows, sorted votes-descending. Ties keep the pivot's
 * alphabetical column order (stable sort), matching determineWinner's
 * first-max rule. The leader is field[0].
 * @param {Array<object>} rows - pivoted race rows (svc.loadRace)
 * @param {Array<string>} candidateCols - candidate column names (page-supplied)
 * @returns {Array<{column, name, votes, share}>}
 */
export function primaryField(rows, candidateCols) {
  if (!Array.isArray(rows) || !Array.isArray(candidateCols)) return [];
  const totals = candidateCols.map((column) => {
    let votes = 0;
    for (const row of rows) votes += Number(row[column]) || 0;
    return { column, name: column.replace(/^\S+\s+/, ""), votes };
  });
  const total = totals.reduce((s, c) => s + c.votes, 0);
  return totals
    .map((c) => ({ ...c, share: total > 0 ? c.votes / total : 0 }))
    .sort((a, b) => b.votes - a.votes);
}

// Normalize a candidate column's party into the two-party buckets. Anything
// that isn't Rep/Dem (Lib, Grn, Ind, write-ins, party-less columns) is "other".
function twoPartyBucket(column) {
  const party = extractParty(column);
  if (!party) return "other";
  const p = party.toUpperCase();
  if (p === "DEM") return "dem";
  if (p === "REP") return "rep";
  return "other";
}

/**
 * Build the synthetic two-candidate election the simulator runs on: one row
 * per baseline precinct with `DEM <demName>` = the baseline race's summed
 * Democratic votes and `REP <repName>` = its summed Republican votes.
 * Third-party/write-in votes are deliberately SET ASIDE (returned as
 * otherVotes for the disclosure line, never a candidate column): a party-less
 * column would be invisible to every turnout multiplier and could only
 * distort the winner rule. BALLOTS CAST TOTAL stays the real total so the
 * simulator's non-voter pool (registered − ballots) stays honest.
 * @returns {{rows, candidates: [demCol, repCol], otherVotes, twoPartyVotes}}
 */
export function synthesizeMatchup(baselineRows, baselineCandidateCols, demName, repName) {
  const empty = { rows: [], candidates: [], otherVotes: 0, twoPartyVotes: 0 };
  if (!Array.isArray(baselineRows) || !Array.isArray(baselineCandidateCols)) return empty;
  if (!demName || !repName) return empty;

  const buckets = baselineCandidateCols.map((col) => [col, twoPartyBucket(col)]);
  const demCol = `DEM ${demName}`;
  const repCol = `REP ${repName}`;
  const rows = [];
  let otherVotes = 0;
  let twoPartyVotes = 0;

  for (const row of baselineRows) {
    const code = row?.["PRECINCT CODE"];
    if (code == null || code === "") continue;
    let dem = 0;
    let rep = 0;
    for (const [col, bucket] of buckets) {
      const v = Number(row[col]) || 0;
      if (bucket === "dem") dem += v;
      else if (bucket === "rep") rep += v;
      else otherVotes += v;
    }
    twoPartyVotes += dem + rep;
    rows.push({
      "PRECINCT CODE": String(code),
      "REGISTERED VOTERS TOTAL": row["REGISTERED VOTERS TOTAL"] ?? "",
      "BALLOTS CAST TOTAL": row["BALLOTS CAST TOTAL"] ?? "",
      // String values match the legacy pivoted-row convention.
      [demCol]: String(dem),
      [repCol]: String(rep),
    });
  }
  if (!rows.length) return empty;
  return { rows, candidates: [demCol, repCol], otherVotes, twoPartyVotes };
}

/**
 * Precincts actually on this office's ballot: candidate votes > 0 in EITHER
 * 2026 primary. Checks candidate votes, never BALLOTS CAST TOTAL — the
 * turnout file is county-wide, so ballots-cast would light up every precinct
 * for a district office (the explore-page gotcha).
 * @returns {Set<string>} participating precinct codes
 */
export function matchupParticipation(demRows, demCols, repRows, repCols) {
  const codes = new Set();
  const scan = (rows, cols) => {
    if (!Array.isArray(rows) || !Array.isArray(cols)) return;
    for (const row of rows) {
      const code = row?.["PRECINCT CODE"];
      if (code == null || code === "") continue;
      for (const col of cols) {
        if ((Number(row[col]) || 0) > 0) {
          codes.add(String(code));
          break;
        }
      }
    }
  };
  scan(demRows, demCols);
  scan(repRows, repCols);
  return codes;
}

/**
 * Convert a runFullSimulation result over synthesized rows into the
 * { [code]: {winner: 'Dem'|'Rep', margin, total, flipped} } shape the map's
 * raceFill/describePrecinct consume. Precincts the simulator skipped (no
 * modeled-party data) fall back to the baseline-derived votes, unflipped;
 * precincts outside the participation set get { total: 0 } — the map's
 * "not on this ballot" treatment.
 * @param {object} simResult - runFullSimulation output
 * @param {Array<object>} synthRows - synthesizeMatchup().rows
 * @param {[string, string]} candidates - [demCol, repCol]
 * @param {Set<string>|null} participation - matchupParticipation() (null = all)
 */
export function toRaceEnvByPrecinct(simResult, synthRows, candidates, participation = null) {
  const byPrecinct = {};
  if (!Array.isArray(synthRows) || !Array.isArray(candidates) || candidates.length < 2) {
    return byPrecinct;
  }
  const [demCol, repCol] = candidates;
  for (const row of synthRows) {
    const code = String(row["PRECINCT CODE"]);
    if (participation && !participation.has(code)) {
      byPrecinct[code] = { winner: null, margin: 0, total: 0, flipped: false };
      continue;
    }
    const sim = simResult?.precinctResults?.[code];
    const votes = sim?.adjustedVotes ?? row;
    const dem = Number(votes[demCol]) || 0;
    const rep = Number(votes[repCol]) || 0;
    const total = dem + rep;
    byPrecinct[code] = {
      // Tie → Dem, matching determineWinner's alphabetical first-max over
      // [DEM …, REP …] columns.
      winner: total === 0 ? null : dem >= rep ? "Dem" : "Rep",
      margin: total > 0 ? Math.abs(dem - rep) / total : 0,
      total,
      flipped: Boolean(sim?.flipped),
    };
  }
  return byPrecinct;
}

/**
 * County-wide headline for the scenario: projected winner, both candidates'
 * totals/shares, margin in points, flips. Thin reader over the simulator's
 * summaries — never reimplements scenario math.
 */
export function countyHeadline(simResult, demCol, repCol) {
  const sum = simResult?.simulatedSummary;
  if (!sum || !sum.totalVotes) return null;
  const dem = sum.candidateTotals?.[demCol] || 0;
  const rep = sum.candidateTotals?.[repCol] || 0;
  const total = dem + rep;
  const winner = determineWinner({ [demCol]: dem, [repCol]: rep });
  return {
    winnerName: winner.name ? winner.name.replace(/^\S+\s+/, "") : null,
    winnerParty: winner.party ? (winner.party.toUpperCase() === "DEM" ? "Dem" : "Rep") : null,
    demVotes: dem,
    repVotes: rep,
    demShare: total > 0 ? dem / total : 0,
    repShare: total > 0 ? rep / total : 0,
    marginPts: total > 0 ? (Math.abs(dem - rep) / total) * 100 : 0,
    flippedPrecincts: simResult.flippedPrecincts || [],
    countyFlipped: Boolean(simResult.countyFlipped),
    totalVotes: total,
  };
}
