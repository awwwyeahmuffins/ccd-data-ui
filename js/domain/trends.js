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

/**
 * Groups elections by race key
 * @param {Array<Object>} manifest - Array of election entries with { filename, year, category?, ... }
 * @returns {Object} Map of raceKey -> Array of entries for that race
 */
export function getElectionsByRaceKey(manifest) {
  let grouped = {};

  for (let entry of manifest) {
    let raceKey = getRaceFamilyKey(entry);
    if (!grouped[raceKey]) {
      grouped[raceKey] = [];
    }
    grouped[raceKey].push(entry);
  }

  // Sort entries within each race by year (descending)
  for (let raceKey of Object.keys(grouped)) {
    grouped[raceKey].sort(function compareYear(a, b) {
      let yearA = a.year || 0;
      let yearB = b.year || 0;
      return yearB - yearA;
    });
  }

  return grouped;
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

/**
 * Computes precinct-level deltas between two elections
 *
 * NOTE ON THE METRIC: this measures `side` against EVERY other candidate, so
 * Libertarian and Green votes count against the target party. That is not the
 * two-party margin — for cycle-over-cycle comparison use `twoPartyMargin` /
 * `buildPartisanIndex` below, which exclude third parties from both sides.
 *
 * @param {Array<Object>} electionData1 - First election data (array of precinct records)
 * @param {Array<Object>} electionData2 - Second election data (array of precinct records)
 * @param {Array<string>} candidates1 - Candidate names from first election
 * @param {Array<string>} candidates2 - Candidate names from second election
 * @param {string} side - Which side to measure ('Dem' or 'Rep')
 * @returns {Object} Map of precinct code -> { delta, margin1, margin2, flipped, winner1, winner2, ... }
 */
export function computePrecinctDeltas(electionData1, electionData2, candidates1, candidates2, side = 'Dem') {
  let deltas = {};

  // Build lookup maps by precinct code
  let data1ByPrecinct = {};
  let data2ByPrecinct = {};

  for (let row of electionData1) {
    let code = String(row['PRECINCT CODE'] || '');
    if (code) {
      data1ByPrecinct[code] = row;
    }
  }

  for (let row of electionData2) {
    let code = String(row['PRECINCT CODE'] || '');
    if (code) {
      data2ByPrecinct[code] = row;
    }
  }

  // Get all unique precinct codes
  let allPrecincts = new Set([
    ...Object.keys(data1ByPrecinct),
    ...Object.keys(data2ByPrecinct)
  ]);

  // Helper to compute margin for a side
  function computeMargin(row, candidates, targetSide) {
    let targetVotes = 0;
    let otherVotes = 0;
    let totalVotes = 0;

    for (let candidate of candidates) {
      let votes = Number(row[candidate]) || 0;
      totalVotes += votes;

      let party = candidate.split(' ')[0].toUpperCase();
      if (party === targetSide.toUpperCase()) {
        targetVotes += votes;
      } else {
        otherVotes += votes;
      }
    }

    if (totalVotes === 0) return null;

    let margin = ((targetVotes - otherVotes) / totalVotes) * 100;
    return margin;
  }

  // Helper to get winner
  function getWinner(row, candidates) {
    let topCandidate = null;
    let topVotes = 0;

    for (let candidate of candidates) {
      let votes = Number(row[candidate]) || 0;
      if (votes > topVotes) {
        topVotes = votes;
        topCandidate = candidate;
      }
    }

    return topCandidate;
  }

  // Compute deltas for each precinct
  for (let precinctCode of allPrecincts) {
    let row1 = data1ByPrecinct[precinctCode];
    let row2 = data2ByPrecinct[precinctCode];

    if (!row1 || !row2) {
      // Precinct missing in one election
      deltas[precinctCode] = {
        delta: null,
        margin1: null,
        margin2: null,
        flipped: false,
        winner1: row1 ? getWinner(row1, candidates1) : null,
        winner2: row2 ? getWinner(row2, candidates2) : null,
        votes1: row1 ? candidates1.reduce((sum, c) => sum + (Number(row1[c]) || 0), 0) : null,
        votes2: row2 ? candidates2.reduce((sum, c) => sum + (Number(row2[c]) || 0), 0) : null,
        missing: !row1 ? 'year1' : 'year2'
      };
      continue;
    }

    let margin1 = computeMargin(row1, candidates1, side);
    let margin2 = computeMargin(row2, candidates2, side);
    let winner1 = getWinner(row1, candidates1);
    let winner2 = getWinner(row2, candidates2);

    // Determine if flipped (winner changed)
    let flipped = winner1 && winner2 && winner1 !== winner2;

    // Compute delta (year2 - year1)
    let delta = (margin1 !== null && margin2 !== null) ? margin2 - margin1 : null;

    deltas[precinctCode] = {
      delta,
      margin1,
      margin2,
      flipped,
      winner1,
      winner2,
      votes1: candidates1.reduce((sum, c) => sum + (Number(row1[c]) || 0), 0),
      votes2: candidates2.reduce((sum, c) => sum + (Number(row2[c]) || 0), 0)
    };
  }

  return deltas;
}

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
 * Third-party votes are excluded from both sides — this is deliberately NOT the
 * same as computePrecinctDeltas' margin, which measures a side against every
 * other candidate and so counts Libertarians against the Democrat.
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
    series.push({
      precinct: code,
      marginA,
      marginB,
      swing,
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
  };
}

/**
 * Computes county-wide summary statistics for a trend
 * @param {Object} deltas - Result from computePrecinctDeltas
 * @returns {Object} Summary stats
 */
export function computeTrendSummary(deltas) {
  let precincts = Object.values(deltas);

  let validDeltas = precincts.filter(p => p.delta != null);
  let flippedPrecincts = precincts.filter(p => p.flipped);

  let avgDelta = validDeltas.length > 0
    ? validDeltas.reduce((sum, p) => sum + p.delta, 0) / validDeltas.length
    : null;

  let totalVotes1 = precincts.reduce((sum, p) => sum + (p.votes1 || 0), 0);
  let totalVotes2 = precincts.reduce((sum, p) => sum + (p.votes2 || 0), 0);

  return {
    totalPrecincts: precincts.length,
    validPrecincts: validDeltas.length,
    flippedPrecincts: flippedPrecincts.length,
    avgDelta,
    totalVotes1,
    totalVotes2,
    flippedPrecinctCodes: flippedPrecincts.map(function findCode(p) {
      let code = Object.keys(deltas).find(k => deltas[k] === p);
      return code;
    }).filter(Boolean)
  };
}
