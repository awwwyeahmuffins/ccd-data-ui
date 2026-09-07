// domain/trends.js
// ====================
// Module for election trends and comparison functionality
// Supports comparing elections across years and computing margin deltas

// ============================================================================
// RACE KEY NORMALIZATION
// ============================================================================

/**
 * Normalizes a race name to a consistent race FAMILY key for cross-year
 * comparison (strips years, maps aliases). Renamed from getRaceKey in Phase 1:
 * the one `getRaceKey` (manifest identity, no normalization) lives in
 * electionSchema.js — this does a different job and now says so.
 * @param {Object|string} entry - Manifest entry (object with filename) or filename string
 * @returns {string} Normalized race key (e.g. "governor", "president", "county_commissioner_precinct_4")
 */
export function getRaceFamilyKey(entry) {
  let filename;
  if (typeof entry === 'string') {
    filename = entry;
  } else if (entry && typeof entry === 'object' && entry.filename) {
    filename = entry.filename;
  } else {
    return '';
  }

  // Remove file extension
  let raceKey = filename.replace(/\.csv$/i, '');

  // Remove year patterns (e.g. "_2024", "_2022")
  raceKey = raceKey.replace(/_(\d{4})/g, '');

  // Map known aliases
  let aliases = {
    'president/vice president': 'president',
    'president_vice_president': 'president',
    'u._s._representative': 'us_representative',
    'united_states_representative': 'us_representative',
    'united_states_senator': 'us_senator',
    'u._s._senator': 'us_senator',
    'lieutenant_governor': 'lt_governor',
    'attorney_general': 'attorney_general',
    'comptroller_of_public_accounts': 'comptroller',
    'commissioner_of_agriculture': 'commissioner_agriculture',
    'commissioner_of_the_general_land_office': 'commissioner_land_office',
    'railroad_commissioner': 'railroad_commissioner',
    'state_representative': 'state_representative',
    'state_senator': 'state_senator',
    'county_commissioner': 'county_commissioner',
    'county_commissioner,_precinct': 'county_commissioner',
    'county_commissioner,_precinct_no': 'county_commissioner',
    'justice_of_the_peace': 'justice_of_the_peace',
    'constable': 'constable',
    'sheriff': 'sheriff',
    'county_judge': 'county_judge',
    'district_judge': 'district_judge',
    'city_council': 'city_council',
    'mayor': 'mayor'
  };
  
  // Normalize to lowercase
  raceKey = raceKey.toLowerCase();
  
  // Apply alias mapping
  for (let [alias, normalized] of Object.entries(aliases)) {
    if (raceKey.includes(alias)) {
      raceKey = normalized;
      break;
    }
  }
  
  // Extract precinct/district numbers and append
  let precinctMatch = raceKey.match(/precinct[_\s]*(\d+)/i);
  let districtMatch = raceKey.match(/district[_\s]*(\d+)/i);
  let placeMatch = raceKey.match(/place[_\s]*(\d+)/i);
  let seatMatch = raceKey.match(/seat[_\s]*no[_\s]*[._]*(\d+)/i);
  
  if (precinctMatch) {
    raceKey = raceKey.replace(/precinct[_\s]*\d+/i, '').trim() + '_precinct_' + precinctMatch[1];
  } else if (districtMatch) {
    raceKey = raceKey.replace(/district[_\s]*\d+/i, '').trim() + '_district_' + districtMatch[1];
  } else if (placeMatch) {
    raceKey = raceKey.replace(/place[_\s]*\d+/i, '').trim() + '_place_' + placeMatch[1];
  } else if (seatMatch) {
    raceKey = raceKey.replace(/seat[_\s]*no[_\s]*[._]*\d+/i, '').trim() + '_seat_' + seatMatch[1];
  }
  
  // Remove special characters, collapse spaces/underscores
  raceKey = raceKey
    .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, '_')      // Collapse spaces to underscore
    .replace(/_+/g, '_')       // Collapse multiple underscores
    .replace(/^_+|_+$/g, '');  // Trim underscores
  
  return raceKey || 'unknown';
}

// ============================================================================
// TREND COLOR CONSTANTS
// ============================================================================

/**
 * Color constants for trend visualization
 */
export let TREND_COLORS = {
  // Swing to Democrat (more Dem in year2)
  swingDem: {
    light: '#D6EAF8',    // Very light blue
    medium: '#6D9EEB',   // Medium blue
    dark: '#27408B',     // Dark blue
    default: '#00AEF3'   // Standard Dem blue
  },
  // Swing to Republican (more Rep in year2)
  swingRep: {
    light: '#fc9a9a',    // Very light red
    medium: '#d13636',   // Medium red
    dark: '#630202',     // Dark red
    default: '#E81B23'   // Standard Rep red
  },
  // No change / neutral
  neutral: '#888888',
  // Flipped (winner changed)
  flipped: '#FFD700',    // Gold
  // No data / missing precinct
  noData: '#f5f5f5'
};

/**
 * Gets a color for a margin delta value
 * @param {number} delta - Margin delta (year2 - year1), typically -100 to +100
 * @param {string} side - Which side to measure ('Dem' or 'Rep')
 * @returns {string} Hex color code
 */
export function getTrendColor(delta, side = 'Dem') {
  if (delta == null || isNaN(delta)) {
    return TREND_COLORS.noData;
  }

  // Normalize delta: positive = swing to Dem, negative = swing to Rep
  // If measuring Rep side, flip the sign
  let normalizedDelta = side === 'Rep' ? -delta : delta;
  
  if (Math.abs(normalizedDelta) < 0.1) {
    return TREND_COLORS.neutral;
  }
  
  let absDelta = Math.abs(normalizedDelta);
  
  if (normalizedDelta > 0) {
    // Swing to Dem
    if (absDelta > 10) return TREND_COLORS.swingDem.dark;
    if (absDelta > 5) return TREND_COLORS.swingDem.medium;
    return TREND_COLORS.swingDem.light;
  } else {
    // Swing to Rep
    if (absDelta > 10) return TREND_COLORS.swingRep.dark;
    if (absDelta > 5) return TREND_COLORS.swingRep.medium;
    return TREND_COLORS.swingRep.light;
  }
}

// ============================================================================
// DELTA COMPUTATION
// ============================================================================

// ============================================================================
// TWO-PARTY COMPOSITE INDEX + SWING
// ============================================================================
//
// What this section exists for: the trends page compares one election CYCLE to
// the next at precinct level. Texas staggers its ballot, so NO office appears in
// both 2022 and 2024 — Governor/Lt Gov/AG run in the midterm, President/US
// Senator in the presidential, and even the high courts alternate places (2022 =
// Supreme Court Places 3/5/9, 2024 = Places 2/4/6). A strict same-race
// comparison is therefore impossible with this data.
//
// The answer is a COMPOSITE: each cycle's index is a precinct's mean two-party
// margin across every statewide partisan race on that cycle's ballot. Averaging
// the whole ticket cancels candidate-specific noise (Beto over-performed the
// 2022 ticket; Paxton under-performed it), so the cycle-to-cycle change reflects
// the precinct rather than one candidate's personal appeal.
//
// These helpers are pure: rows, candidate columns, and precinct counts all
// arrive as arguments. The page composes them with the data service.

// A race joins the composite only if it has two-party votes in at least this
// share of the county's precincts. This is what separates a statewide office
// (~267 of 273 precincts) from a district-limited one (State Representative
// District 33 covers ~18) WITHOUT hardcoding an office list that would rot the
// next time a manifest is regenerated.
export const COMPOSITE_MIN_COVERAGE = 0.95;

// Swings smaller than this read as noise, not movement — used for the neutral
// bucket in summaries and for the scatter's "no real change" dot shape.
export const SWING_EPSILON = 0.5;

// Below this many two-party votes PER RACE, a precinct's margin is arithmetic
// noise rather than a measurement: Collin has precincts casting one or two
// votes per contest, where a single ballot reads as "100% Democratic". Matches
// the tiny-electorate threshold the Data Table already uses. Such precincts keep
// their real vote counts everywhere — they are flagged, never deleted — but a
// percentage built on one ballot must not be plotted as a position.
export const TINY_ELECTORATE_PER_RACE = 50;

// Party prefix off a pivoted candidate column ("DEM Beto O'Rourke" -> "DEM").
// Upper-cased because the two cycles disagree: the 2022 files use DEM/REP and
// the 2024 files use Dem/Rep. Never compare these raw.
function partyOf(candidateColumn) {
  return String(candidateColumn).split(" ")[0].toUpperCase();
}

/**
 * Split candidate columns into their Dem and Rep buckets. Third parties
 * (LIB/GRN/IND/write-ins) land in neither — the two-party metric excludes them
 * from the numerator AND the denominator.
 * @param {Array<string>} candidateCols
 * @returns {{dem: Array<string>, rep: Array<string>}}
 */
export function twoPartyColumns(candidateCols) {
  const dem = [];
  const rep = [];
  for (const col of candidateCols || []) {
    const party = partyOf(col);
    if (party === "DEM") dem.push(col);
    else if (party === "REP") rep.push(col);
  }
  return { dem, rep };
}

/**
 * One precinct's two-party margin for one race, in PERCENTAGE POINTS.
 * Positive = Democratic advantage.
 *
 *   (dem - rep) / (dem + rep) * 100
 *
 * Third-party votes are excluded from BOTH sides. That is deliberate, and it
 * makes these margins non-comparable with a raw winner-minus-runner-up gap,
 * which counts Libertarians and Greens against the leader.
 * @param {Object} row - pivoted race row for one precinct
 * @param {Array<string>} candidateCols - candidate column names
 * @returns {{margin: number, demVotes: number, repVotes: number}|null}
 *   null when the precinct cast no two-party votes (not on this ballot)
 */
export function twoPartyMargin(row, candidateCols) {
  if (!row) return null;
  const { dem, rep } = twoPartyColumns(candidateCols);
  let demVotes = 0;
  let repVotes = 0;
  for (const col of dem) demVotes += Number(row[col]) || 0;
  for (const col of rep) repVotes += Number(row[col]) || 0;
  const total = demVotes + repVotes;
  if (total <= 0) return null;
  return { margin: ((demVotes - repVotes) / total) * 100, demVotes, repVotes };
}

/**
 * Pick the races that belong in a cycle's composite index.
 *
 * A race qualifies when it fields BOTH major parties and reaches
 * COMPOSITE_MIN_COVERAGE of the county's precincts. The coverage test is what
 * keeps district-limited contests (US Rep, State Rep, State Senate, JP,
 * Constable, county commissioner precincts) out of an index that is supposed to
 * mean the same thing in every precinct.
 *
 * @param {Array<{entry: Object, rows: Array<Object>, candidateCols: Array<string>}>} races
 * @param {number} precinctCount - precincts in the county (the coverage denominator)
 * @param {number} [minCoverage=COMPOSITE_MIN_COVERAGE]
 * @returns {Array<{entry, rows, candidateCols, coverage: number}>} qualifying races
 */
export function selectCompositeRaces(races, precinctCount, minCoverage = COMPOSITE_MIN_COVERAGE) {
  if (!Array.isArray(races) || !precinctCount) return [];
  const selected = [];
  for (const race of races) {
    if (!race || !Array.isArray(race.rows)) continue;
    const { dem, rep } = twoPartyColumns(race.candidateCols);
    // A one-party race has no margin to speak of — a contest, not a referendum.
    if (!dem.length || !rep.length) continue;

    let covered = 0;
    for (const row of race.rows) {
      if (twoPartyMargin(row, race.candidateCols)) covered += 1;
    }
    const coverage = covered / precinctCount;
    if (coverage >= minCoverage) selected.push({ ...race, coverage });
  }
  return selected;
}

/**
 * Build one cycle's composite partisan index, per precinct.
 *
 * The index is the UNWEIGHTED MEAN of the precinct's two-party margin in each
 * selected race — deliberately not a pooled vote ratio. Equal weighting is what
 * cancels candidate-specific noise: pooling would let the highest-turnout race
 * (President, always) dominate the average and reintroduce exactly the
 * single-candidate effect the composite exists to remove.
 *
 * A precinct is only included in the index for races it actually voted in, and
 * `raceCount` records how many that was, so callers can disclose a thin sample
 * rather than present it as equivalent to a full one.
 *
 * @param {Array<{rows, candidateCols}>} selectedRaces - output of selectCompositeRaces
 * @returns {Object} { [precinctCode]: { margin, demVotes, repVotes, raceCount } }
 */
export function buildPartisanIndex(selectedRaces) {
  const acc = {};
  if (!Array.isArray(selectedRaces)) return acc;

  for (const race of selectedRaces) {
    if (!race || !Array.isArray(race.rows)) continue;
    for (const row of race.rows) {
      const code = String(row?.["PRECINCT CODE"] ?? "");
      if (!code) continue;
      const result = twoPartyMargin(row, race.candidateCols);
      if (!result) continue;
      const slot = acc[code] || (acc[code] = { marginSum: 0, demVotes: 0, repVotes: 0, raceCount: 0 });
      slot.marginSum += result.margin;
      slot.demVotes += result.demVotes;
      slot.repVotes += result.repVotes;
      slot.raceCount += 1;
    }
  }

  const index = {};
  for (const [code, slot] of Object.entries(acc)) {
    index[code] = {
      margin: slot.marginSum / slot.raceCount,
      demVotes: slot.demVotes,
      repVotes: slot.repVotes,
      raceCount: slot.raceCount,
    };
  }
  return index;
}

/**
 * Build a cycle's index from PRIMARY PARTICIPATION instead of general-election
 * results: which party's primary ballot each precinct's voters asked for.
 *
 * This is the page's second metric and its answer to "partisan sentiment". It
 * is behavioural, not modelled — nobody is scored, they either walked in and
 * took a Democratic ballot or they didn't. It is also the only measure on file
 * with THREE cycles (2022, 2024, 2026), so it is what makes a real
 * year-to-year picker possible; the general-election composite has exactly one
 * comparable pair because Texas staggers its ballot.
 *
 * Read it for what it is: primary turnout is a fraction of a general
 * electorate and is pushed around by whether a contested race was on either
 * ballot that year. It measures engagement, not vote share, and the page copy
 * has to say so.
 *
 * Shape matches buildPartisanIndex exactly so buildSwingSeries/summarizeSwing
 * work on either metric with no branching.
 *
 * @param {Object} primaryTurnout - svc.loadPrimaryTurnout(): { [precinct]: { [year]: {dem, rep} } }
 * @param {number|string} year
 * @returns {Object} { [precinct]: { margin, demVotes, repVotes, raceCount } }
 */
export function buildPrimaryIndex(primaryTurnout, year) {
  const index = {};
  if (!primaryTurnout || year == null) return index;
  for (const [code, byYear] of Object.entries(primaryTurnout)) {
    const rec = byYear?.[year] ?? byYear?.[String(year)] ?? byYear?.[Number(year)];
    if (!rec) continue;
    const dem = Number(rec.dem) || 0;
    const rep = Number(rec.rep) || 0;
    const total = dem + rep;
    if (total <= 0) continue;
    index[String(code)] = {
      margin: ((dem - rep) / total) * 100,
      demVotes: dem,
      repVotes: rep,
      // One "race" — the primary itself. Keeps the per-race vote maths in
      // buildSwingSeries (and so the tiny-electorate test) meaningful.
      raceCount: 1,
    };
  }
  return index;
}

/** Years present in a primary-turnout lookup, ascending. */
export function primaryYearsAvailable(primaryTurnout) {
  const years = new Set();
  for (const byYear of Object.values(primaryTurnout || {})) {
    for (const y of Object.keys(byYear || {})) {
      const n = Number(y);
      if (!isNaN(n)) years.add(n);
    }
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Pair two cycles' indices into the per-precinct series the scatter plots.
 *
 * `swing` is marginB - marginA in points; positive = movement toward Democrats.
 * Precincts present in only ONE cycle keep their known margin and get
 * `swing: null` — never dropped silently and never zero-filled, which would
 * plant a fabricated "no change" dot on the diagonal.
 *
 * @param {Object} indexA - earlier cycle (buildPartisanIndex output)
 * @param {Object} indexB - later cycle
 * @returns {Array<Object>} sorted by precinct code (numeric where possible)
 */
export function buildSwingSeries(indexA, indexB) {
  const a = indexA || {};
  const b = indexB || {};
  const codes = new Set([...Object.keys(a), ...Object.keys(b)]);
  const series = [];

  for (const code of codes) {
    const entryA = a[code] || null;
    const entryB = b[code] || null;
    const marginA = entryA ? entryA.margin : null;
    const marginB = entryB ? entryB.margin : null;
    const swing = marginA !== null && marginB !== null ? marginB - marginA : null;
    // Votes per race, not total: the composite sums across 17–18 contests, so a
    // raw total of 34 looks respectable while being two votes per race.
    const perRaceA = entryA && entryA.raceCount ? (entryA.demVotes + entryA.repVotes) / entryA.raceCount : 0;
    const perRaceB = entryB && entryB.raceCount ? (entryB.demVotes + entryB.repVotes) / entryB.raceCount : 0;

    // IMPACT, in votes rather than points. A 40-point swing across ten ballots
    // and a 4-point swing across four thousand look identical in percentage
    // terms; only one of them changes an outcome. This is the change in the
    // Dem-minus-Rep gap, averaged per race so the two metrics stay comparable
    // (the general composite spans 17–18 races, a primary exactly one).
    //
    // Summed across precincts it equals the county's own margin change, so the
    // measure decomposes exactly — that is what makes it worth trusting.
    //
    // It counts TURNOUT change as well as persuasion: a precinct that simply
    // grew between a midterm and a presidential year moves real votes without
    // anybody changing their mind. That is a true statement about impact, and
    // the page says so rather than pretending the number is pure persuasion.
    const gapA = entryA && entryA.raceCount ? (entryA.demVotes - entryA.repVotes) / entryA.raceCount : null;
    const gapB = entryB && entryB.raceCount ? (entryB.demVotes - entryB.repVotes) / entryB.raceCount : null;
    const netVotes = gapA !== null && gapB !== null ? gapB - gapA : null;

    // EACH BASE ON ITS OWN. Margin is a ratio, and a ratio hides the thing
    // organizers most need to know: a precinct can add 300 Democratic votes and
    // still move Republican, because it added 500 Republican ones. Reporting
    // only the swing would call that precinct a loss when the Democratic base
    // in it actually grew. Per-race averages, so a 17-race composite and a
    // one-race primary stay comparable.
    const demA = entryA && entryA.raceCount ? entryA.demVotes / entryA.raceCount : null;
    const repA = entryA && entryA.raceCount ? entryA.repVotes / entryA.raceCount : null;
    const demB = entryB && entryB.raceCount ? entryB.demVotes / entryB.raceCount : null;
    const repB = entryB && entryB.raceCount ? entryB.repVotes / entryB.raceCount : null;
    const demChange = demA !== null && demB !== null ? demB - demA : null;
    const repChange = repA !== null && repB !== null ? repB - repA : null;
    series.push({
      precinct: code,
      marginA,
      marginB,
      swing,
      netVotes,
      demA,
      repA,
      demB,
      repB,
      demChange,
      repChange,
      // The case the margin alone would hide: the Democratic base grew, yet
      // the precinct still moved Republican (or vice versa).
      demGrewButMovedRep: demChange > 0 && swing != null && swing < -SWING_EPSILON,
      repGrewButMovedDem: repChange > 0 && swing != null && swing > SWING_EPSILON,
      // True when EITHER cycle is too thin to support a percentage.
      tinyElectorate:
        Math.min(entryA ? perRaceA : Infinity, entryB ? perRaceB : Infinity) < TINY_ELECTORATE_PER_RACE,
      votesPerRaceA: entryA ? perRaceA : null,
      votesPerRaceB: entryB ? perRaceB : null,
      // A flip is a change of which party leads, not merely a big swing.
      flipped: marginA !== null && marginB !== null && marginA >= 0 !== marginB >= 0,
      votesA: entryA ? entryA.demVotes + entryA.repVotes : null,
      votesB: entryB ? entryB.demVotes + entryB.repVotes : null,
      raceCountA: entryA ? entryA.raceCount : 0,
      raceCountB: entryB ? entryB.raceCount : 0,
    });
  }

  return series.sort((x, y) => {
    const nx = Number(x.precinct);
    const ny = Number(y.precinct);
    if (!isNaN(nx) && !isNaN(ny)) return nx - ny;
    return String(x.precinct).localeCompare(String(y.precinct));
  });
}

/**
 * County-wide read on a swing series.
 *
 * Reports BOTH the unweighted mean (how the typical precinct moved) and the
 * vote-weighted mean (how the county's actual electorate moved) — they answer
 * different questions and a single number would hide the difference between a
 * county whose small precincts moved and one whose big ones did.
 *
 * @param {Array<Object>} series - buildSwingSeries output
 * @returns {Object} summary stats; nulls when nothing is comparable
 */
const sum = (rows, key) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

export function summarizeSwing(series) {
  const rows = Array.isArray(series) ? series : [];
  const comparable = rows.filter((r) => r.swing != null);

  const empty = {
    totalPrecincts: rows.length,
    comparablePrecincts: 0,
    meanSwing: null,
    medianSwing: null,
    voteWeightedSwing: null,
    towardDem: 0,
    towardRep: 0,
    unchanged: 0,
    flippedToDem: 0,
    flippedToRep: 0,
    netVotes: 0,
    demChange: 0,
    repChange: 0,
    demBaseGrew: 0,
    repBaseGrew: 0,
    demGrewButMovedRep: 0,
    repGrewButMovedDem: 0,
  };
  if (!comparable.length) return empty;

  const sorted = comparable.map((r) => r.swing).sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  const medianSwing =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  let weightSum = 0;
  let weightedTotal = 0;
  for (const r of comparable) {
    const weight = (r.votesA || 0) + (r.votesB || 0);
    if (weight <= 0) continue;
    weightSum += weight;
    weightedTotal += r.swing * weight;
  }

  return {
    totalPrecincts: rows.length,
    comparablePrecincts: comparable.length,
    meanSwing: comparable.reduce((s, r) => s + r.swing, 0) / comparable.length,
    medianSwing,
    voteWeightedSwing: weightSum > 0 ? weightedTotal / weightSum : null,
    towardDem: comparable.filter((r) => r.swing > SWING_EPSILON).length,
    towardRep: comparable.filter((r) => r.swing < -SWING_EPSILON).length,
    unchanged: comparable.filter((r) => Math.abs(r.swing) <= SWING_EPSILON).length,
    flippedToDem: comparable.filter((r) => r.flipped && r.marginB >= 0).length,
    flippedToRep: comparable.filter((r) => r.flipped && r.marginB < 0).length,
    // Vote counts, not points — these sum, so the county total is just the sum
    // of its precincts and the decomposition can be checked by hand.
    //
    // The sum is over `comparable` — precincts with a composite in BOTH years.
    // It therefore does NOT equal the county's full margin change: measured
    // 2022->2024 it is -22,943 against the county's -23,875 (3.9%), almost all
    // of it precinct 252, which has 2024 results but no 2022 composite entry.
    // That is the honest number to report, so say "across the N precincts with
    // results in both years" rather than renormalising — renormalising would
    // change every precinct's displayed netVotes and every map arrow length to
    // close a 3.9% identity.
    netVotes: sum(comparable, "netVotes"),
    demChange: sum(comparable, "demChange"),
    repChange: sum(comparable, "repChange"),
    demBaseGrew: comparable.filter((r) => r.demChange > 0).length,
    repBaseGrew: comparable.filter((r) => r.repChange > 0).length,
    // The headline the margin alone would never show.
    demGrewButMovedRep: comparable.filter((r) => r.demGrewButMovedRep).length,
    repGrewButMovedDem: comparable.filter((r) => r.repGrewButMovedDem).length,
  };
}

// ============================================================================
// MAP BINS + FILTERING
// ============================================================================

// Diverging swing bins for the choropleth, in percentage points. The middle
// band is SWING_EPSILON so the map's "no real change" means exactly what the
// scatter's circle mark and the summary's `unchanged` count mean — three
// surfaces, one threshold.
export const SWING_BINS = Object.freeze([
  { max: -10, key: "rep-strong", name: "Strong move to Rep", range: "more than 10 points" },
  { max: -SWING_EPSILON, key: "rep", name: "Moved to Rep", range: `${SWING_EPSILON}–10 points` },
  { max: SWING_EPSILON, key: "flat", name: "No real change", range: `within ${SWING_EPSILON} points` },
  { max: 10, key: "dem", name: "Moved to Dem", range: `${SWING_EPSILON}–10 points` },
  { max: Infinity, key: "dem-strong", name: "Strong move to Dem", range: "more than 10 points" },
]);

/**
 * Swing (points) -> SWING_BINS index, or -1 when there is nothing to bin.
 * A precinct with no comparison is NOT binned to the middle — "unknown" and
 * "unchanged" are different answers and the map colours them differently.
 */
export function swingBin(swing) {
  if (swing == null || isNaN(swing)) return -1;
  for (let i = 0; i < SWING_BINS.length; i++) {
    if (swing < SWING_BINS[i].max || i === SWING_BINS.length - 1) return i;
  }
  return SWING_BINS.length - 1;
}

// Every filter off. Spread this rather than building literals, so a new filter
// can never be silently absent from a caller's state object.
export const EMPTY_FILTERS = Object.freeze({
  direction: "all", // "all" | "dem" | "rep" | "flat"
  flippedOnly: false,
  swingMin: null, // signed points, inclusive
  swingMax: null,
  marginAMin: null, // earlier-cycle margin window (competitiveness)
  marginAMax: null,
  marginBMin: null, // later-cycle margin window
  marginBMax: null,
  maxAbsMarginB: null, // |margin| in the later cycle — "close races only"
  minVotes: null, // two-party votes in the later cycle
  minNetVotes: null, // |net votes| — impact, so a 10-ballot precinct can't headline
  base: "any", // "any" | "dem-grew" | "dem-shrank" | "dem-grew-moved-rep"
  precincts: null, // Set/array of codes to keep, or null for all
  // Tiny electorates stay IN by default — they are flagged everywhere they
  // appear, never deleted. The scatter still declines to plot them (a position
  // built on one ballot is not a position) and the map marks them as
  // "too few votes to say", but they keep their row and their real counts.
  includeTiny: true,
});

const inRange = (value, min, max) => {
  if (value == null || isNaN(value)) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
};

/**
 * Apply the page's filters to a swing series. Pure — no DOM, no page state.
 *
 * Precincts with no comparison (`swing == null`) are dropped by ANY active
 * filter: a filter is a question about movement, and a precinct that was on
 * only one cycle's ballot has no movement to test. They survive only the
 * untouched default, where they are still shown as N/A.
 *
 * @param {Array<Object>} series - buildSwingSeries output
 * @param {Object} filters - partial; missing keys fall back to EMPTY_FILTERS
 * @returns {Array<Object>} the surviving rows, original order preserved
 */
export function filterSwingSeries(series, filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const rows = Array.isArray(series) ? series : [];
  const keep = f.precincts
    ? f.precincts instanceof Set
      ? f.precincts
      : new Set([...f.precincts].map(String))
    : null;

  const touched =
    f.direction !== "all" ||
    f.flippedOnly ||
    f.swingMin != null ||
    f.swingMax != null ||
    f.marginAMin != null ||
    f.marginAMax != null ||
    f.marginBMin != null ||
    f.marginBMax != null ||
    f.maxAbsMarginB != null ||
    f.minVotes != null ||
    f.minNetVotes != null ||
    f.base !== "any";

  return rows.filter((r) => {
    if (keep && !keep.has(String(r.precinct))) return false;
    if (!f.includeTiny && r.tinyElectorate) return false;
    if (r.swing == null) return !touched;

    if (f.direction !== "all") {
      const dir =
        r.swing > SWING_EPSILON ? "dem" : r.swing < -SWING_EPSILON ? "rep" : "flat";
      if (dir !== f.direction) return false;
    }
    if (f.flippedOnly && !r.flipped) return false;
    if ((f.swingMin != null || f.swingMax != null) && !inRange(r.swing, f.swingMin, f.swingMax)) {
      return false;
    }
    if (
      (f.marginAMin != null || f.marginAMax != null) &&
      !inRange(r.marginA, f.marginAMin, f.marginAMax)
    ) {
      return false;
    }
    if (
      (f.marginBMin != null || f.marginBMax != null) &&
      !inRange(r.marginB, f.marginBMin, f.marginBMax)
    ) {
      return false;
    }
    if (f.maxAbsMarginB != null) {
      if (r.marginB == null || Math.abs(r.marginB) > f.maxAbsMarginB) return false;
    }
    if (f.minVotes != null && (r.votesB || 0) < f.minVotes) return false;
    // Impact threshold: measured on the ABSOLUTE net-vote change, so it keeps
    // big movers in either direction rather than quietly favouring one party.
    if (f.minNetVotes != null && Math.abs(r.netVotes ?? 0) < f.minNetVotes) return false;
    if (f.base === "dem-grew" && !(r.demChange > 0)) return false;
    if (f.base === "dem-shrank" && !(r.demChange < 0)) return false;
    if (f.base === "dem-grew-moved-rep" && !r.demGrewButMovedRep) return false;
    return true;
  });
}

