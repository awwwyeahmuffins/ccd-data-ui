// domain/campaign.js
// --------------------------------------------------------------------------------
// Pure computation for the Campaign ("Detailed View") dashboard: win numbers,
// persuasion-vs-turnout classification, district roll-ups, multi-key sorting,
// and the VAN-ready target-list CSV. No fetch, no DOM — data comes in as
// arguments (records from precinctMetrics.buildRecords, turnout lookups from
// the data service) and plain rows/strings come out.
//
// Vote counts are the modeled party universe (dnc_scores rep/mod/dem), not
// actual ballots; unknown inputs stay null and flow through as null — never
// fabricate a number.

import { csvEscape } from "../lib/dom.js";

// Raw votes needed to carry a precinct (or district): 50% of expected ballots
// plus one. Null-safe: no baseline ballots → no win number.
export function winNumber(expectedBallots) {
  if (expectedBallots == null || isNaN(expectedBallots) || expectedBallots <= 0) return null;
  return Math.floor(expectedBallots / 2) + 1;
}

// Median of the finite values in a list (null when none). Used for the
// county-median turnout rate the classifier compares against.
export function median(values) {
  const nums = (values || []).filter((v) => v != null && !isNaN(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

// Persuasion-vs-turnout classification, ordered rules from the selected
// party's perspective:
//   1. Persuasion — close margin with a real moderate bloc to persuade
//   2. Turnout    — already ours, but turning out below the county median
//   3. Base       — already ours and voting
//   4. Watch      — everything else (the other side's ground)
// Null when the precinct has no modeled partisan data at all.
export function classifyPrecinct({ winner, margin, modShare, rate }, { party, medianRate }) {
  if (!winner || margin == null || isNaN(margin)) return null;
  if (margin < 0.10 && modShare != null && modShare >= 0.15) return "Persuasion";
  if (winner === party && rate != null && medianRate != null && rate < medianRate) return "Turnout";
  if (winner === party) return "Base";
  return "Watch";
}

function rateOf(t) {
  if (!t || t.registered == null || !(+t.registered > 0)) return null;
  if (t.ballots == null || isNaN(t.ballots)) return null;
  return +t.ballots / +t.registered;
}

function cnt(v) {
  return v == null || v === "" || isNaN(v) ? null : +v;
}

// Extend precinctMetrics records with the campaign fields.
//   records  buildRecords() output (margin, winner, modShare, shares, nonWhite…)
//   raw      { code: {rep, mod, dem, white, total} } — raw modeled/racial counts
//            straight off feature.properties, for summable roll-ups
//   t2024 / t2022 / tBase   { code: {registered, ballots} } turnout lookups;
//            tBase drives expected ballots (the win-number baseline)
//   party    "Dem" | "Rep" — whose win number / margin sign / classification
//   medianRate  county median 2024 turnout rate; computed from the rows when omitted
//   canvass  { code: {demVoters, share, canvassed} } — door-knock coverage of
//            the precinct's Dem universe (profile extra; absent codes → null)
export function buildCampaignRows(records, raw, { t2024, t2022, tBase, party = "Dem", medianRate, canvass } = {}) {
  const prepped = (records || []).map((r) => {
    const code = r.precinct;
    const counts = raw ? raw[code] : null;
    const rate2024 = rateOf(t2024 && t2024[code]);
    const rateMidterm = rateOf(t2022 && t2022[code]);
    const tb = tBase ? tBase[code] : null;
    const expectedBallots = tb && tb.ballots != null && !isNaN(tb.ballots) ? +tb.ballots : null;
    const cv = canvass ? canvass[code] : null;
    return { r, code, counts, rate2024, rateMidterm, expectedBallots, cv };
  });

  const mr = medianRate != null ? medianRate : median(prepped.map((p) => p.rate2024));

  return prepped.map(({ r, code, counts, rate2024, rateMidterm, expectedBallots, cv }) => {
    const win = winNumber(expectedBallots);
    const partyVotes = counts ? cnt(party === "Rep" ? counts.rep : counts.dem) : null;
    const voteGap = win != null && partyVotes != null ? win - partyVotes : null;
    // Net Vote Opportunity: the selected party's modeled supporters still sitting
    // home at the marquee turnout rate — the GOTV gap, not the raw supporter count.
    const nvo = partyVotes != null && rate2024 != null ? Math.round(partyVotes * (1 - rate2024)) : null;
    const signedMargin =
      r.demShare != null && r.repShare != null
        ? party === "Rep"
          ? r.repShare - r.demShare
          : r.demShare - r.repShare
        : null;
    const turnoutDropoff =
      rate2024 != null && rateMidterm != null ? rate2024 - rateMidterm : null;
    const classification = classifyPrecinct(
      { winner: r.winner, margin: r.margin, modShare: r.modShare, rate: rate2024 },
      { party, medianRate: mr }
    );
    const t24 = t2024 ? t2024[code] : null;
    const t22 = t2022 ? t2022[code] : null;
    return {
      ...r,
      expectedBallots,
      winNumber: win,
      partyVotes,
      voteGap,
      nvo,
      signedMargin,
      rate2024,
      rateMidterm,
      turnoutDropoff,
      classification,
      canvassShare: cv && cv.share != null ? cv.share : null,
      canvassed: cv && cv.canvassed != null ? cv.canvassed : null,
      _raw: {
        rep: counts ? cnt(counts.rep) : null,
        mod: counts ? cnt(counts.mod) : null,
        dem: counts ? cnt(counts.dem) : null,
        white: counts ? cnt(counts.white) : null,
        total: counts ? cnt(counts.total) : null,
        reg2024: t24 ? cnt(t24.registered) : null,
        ball2024: t24 ? cnt(t24.ballots) : null,
        reg2022: t22 ? cnt(t22.registered) : null,
        ball2022: t22 ? cnt(t22.ballots) : null,
        expected: expectedBallots,
        canvassDem: cv ? cnt(cv.demVoters) : null,
        canvassed: cv ? cnt(cv.canvassed) : null,
      },
    };
  });
}

function sumField(rows, field) {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    const v = row._raw ? row._raw[field] : null;
    if (v != null && !isNaN(v)) {
      sum += +v;
      any = true;
    }
  }
  return any ? sum : null;
}

// Alphabetical first-max winner from summed modeled counts — mirrors the
// v3Pivot winner rule so district roll-ups can't disagree with precinct data.
function winnerOf(dem, mod, rep) {
  const entries = [
    ["Dem", dem],
    ["Mod", mod],
    ["Rep", rep],
  ].filter(([, v]) => v != null);
  if (!entries.length) return null;
  let best = entries[0];
  for (const e of entries.slice(1)) if (e[1] > best[1]) best = e;
  return best[1] > 0 ? best[0] : null;
}

// Roll precinct campaign rows up to district rows. Sums raw counts and
// recomputes every share/rate/margin from the sums — NEVER averages
// percentages. District rows reuse the precinct field names so filterRecords
// and the table column model work unchanged.
//   memberOf  { precinctCode: districtKey } — codes absent from the map are skipped
//   labels    { districtKey: displayLabel } (optional)
export function aggregateByDistrict(rows, memberOf, labels, { party = "Dem", medianRate } = {}) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = memberOf ? memberOf[row.precinct] : null;
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const out = [];
  for (const [key, members] of groups) {
    const dem = sumField(members, "dem");
    const mod = sumField(members, "mod");
    const rep = sumField(members, "rep");
    const white = sumField(members, "white");
    const total = sumField(members, "total");
    const reg2024 = sumField(members, "reg2024");
    const ball2024 = sumField(members, "ball2024");
    const reg2022 = sumField(members, "reg2022");
    const ball2022 = sumField(members, "ball2022");
    const expected = sumField(members, "expected");
    const canvassDem = sumField(members, "canvassDem");
    const canvassed = sumField(members, "canvassed");

    const votes = (dem || 0) + (mod || 0) + (rep || 0);
    const hasParty = dem != null && rep != null && votes > 0;
    const demShare = hasParty ? dem / votes : null;
    const repShare = hasParty ? rep / votes : null;
    const modShare = hasParty && mod != null ? mod / votes : null;
    const margin = hasParty ? Math.abs(repShare - demShare) : null;
    const signedMargin = hasParty
      ? party === "Rep"
        ? repShare - demShare
        : demShare - repShare
      : null;
    const winner = winnerOf(dem, mod, rep);
    const nonWhite = white != null && total != null && total > 0 ? 1 - white / total : null;
    const rate2024 = reg2024 > 0 && ball2024 != null ? ball2024 / reg2024 : null;
    const rateMidterm = reg2022 > 0 && ball2022 != null ? ball2022 / reg2022 : null;
    const turnoutDropoff =
      rate2024 != null && rateMidterm != null ? rate2024 - rateMidterm : null;
    const win = winNumber(expected);
    const partyVotes = party === "Rep" ? rep : dem;
    const voteGap = win != null && partyVotes != null ? win - partyVotes : null;
    const nvo = partyVotes != null && rate2024 != null ? Math.round(partyVotes * (1 - rate2024)) : null;
    const canvassShare =
      canvassDem != null && canvassDem > 0 && canvassed != null ? canvassed / canvassDem : null;

    out.push({
      precinct: String(key),
      label: (labels && labels[key]) || String(key),
      memberCodes: members.map((m) => m.precinct),
      isDistrict: true,
      winner,
      demShare,
      repShare,
      modShare,
      margin,
      signedMargin,
      votes: hasParty ? votes : null,
      nonWhite,
      registered: reg2024,
      ballots: ball2024,
      turnoutRate: rate2024,
      rate2024,
      rateMidterm,
      turnoutDropoff,
      expectedBallots: expected,
      winNumber: win,
      partyVotes,
      voteGap,
      nvo,
      canvassShare,
      canvassed,
      classification: classifyPrecinct(
        { winner, margin, modShare, rate: rate2024 },
        { party, medianRate }
      ),
    });
  }

  return out.sort((a, b) =>
    a.precinct.localeCompare(b.precinct, undefined, { numeric: true })
  );
}

// Stable multi-key sort. sorts = [{key, dir: "asc"|"desc"}, …]; nulls always
// sink to the bottom regardless of direction (the sortRecords convention).
export function sortRowsMulti(rows, sorts) {
  if (!sorts || !sorts.length) return [...(rows || [])];
  return [...(rows || [])].sort((a, b) => {
    for (const { key, dir } of sorts) {
      const sign = dir === "asc" ? 1 : -1;
      const av = a[key];
      const bv = b[key];
      const an = av == null;
      const bn = bv == null;
      if (an && bn) continue;
      if (an) return 1;
      if (bn) return -1;
      const cmp =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv), undefined, { numeric: true })
          : av - bv;
      if (cmp !== 0) return sign * cmp;
    }
    return 0;
  });
}

// ---- VAN-ready CSV ----------------------------------------------------------
// Raw data payload for ingestion (NGP VAN etc.): Precinct_ID is the bare
// precinct number VAN joins on; integers stay bare (no thousands separators);
// fractions are plain decimals rounded to 4 places (no % signs); Vote_Gap and
// Partisan_Margin are signed from the selected party's perspective (positive
// margin = selected party leads). RFC 4180: CRLF line endings, csvEscape per
// cell (quote-doubling + spreadsheet formula-injection guard).
export const TARGET_CSV_COLUMNS = Object.freeze([
  "Precinct_ID",
  "Total_Registered",
  "Expected_Ballots",
  "Target_Win_Number",
  "Modeled_Party_Votes",
  "Vote_Gap",
  "Partisan_Margin",
  "Classification",
  "Turnout_Dropoff",
  "Pct_NonWhite",
  "Canvass_Share",
  "Canvassed_Dem_Voters",
  "District",
]);

function intCell(v) {
  return v == null || isNaN(v) ? "" : Math.round(v);
}

function dec4Cell(v) {
  return v == null || isNaN(v) ? "" : Math.round(v * 10000) / 10000;
}

// rows: precinct-level campaign rows (roll-up expansion happens in the caller).
// districtLabels: optional { precinctCode: districtLabel } for the District column.
export function buildTargetCSV(rows, { districtLabels = null } = {}) {
  const lines = [TARGET_CSV_COLUMNS.join(",")];
  for (const r of rows || []) {
    lines.push(
      [
        csvEscape(r.precinct),
        csvEscape(intCell(r.registered)),
        csvEscape(intCell(r.expectedBallots)),
        csvEscape(intCell(r.winNumber)),
        csvEscape(intCell(r.partyVotes)),
        csvEscape(intCell(r.voteGap)),
        csvEscape(dec4Cell(r.signedMargin)),
        csvEscape(r.classification || ""),
        csvEscape(dec4Cell(r.turnoutDropoff)),
        csvEscape(dec4Cell(r.nonWhite)),
        csvEscape(dec4Cell(r.canvassShare)),
        csvEscape(intCell(r.canvassed)),
        csvEscape((districtLabels && districtLabels[r.precinct]) || ""),
      ].join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
