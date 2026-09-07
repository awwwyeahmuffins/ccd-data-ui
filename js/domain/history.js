// domain/history.js
// ===================
// Per-precinct voting history: results, candidate breakdowns, cross-election
// comparison, and the federal-trend computation (REDESIGN.md §4.1). PURE —
// no fetch, no DOM; election data comes in as arguments (pages compose these
// with the data service). The old fetch-coupled wrappers
// (getPrecinctVotingHistory/computePrecinctTrend/…) became one-line
// compositions in their consumers when precinctHistory.js was dissolved.

import { getRaceFamilyKey } from "./trends.js";
import { categorizeRace, CATEGORY_ORDER } from "./races.js";
export { categorizeRace, CATEGORY_ORDER };

/**
 * Format a filename for display
 * @param {string} filename - Election CSV filename
 * @returns {string} - Human-readable race name
 */
export function formatRaceName(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'Unknown Race';
  }
  return filename
    .split('/').pop()           // v3 filenames carry a path ("races/Governor_2022.csv")
    .replace(/\.csv$/i, '')
    .replace(/_/g, ' ')
    .replace(/,/g, ', ');
}

// ============================================================================
// PRECINCT RESULT FUNCTIONS
// ============================================================================

// Keys to skip when iterating candidate columns
const SKIP_KEYS = new Set([
  'COUNTY NUMBER', 'PRECINCT CODE', 'PRECINCT NAME',
  'REGISTERED VOTERS TOTAL', 'BALLOTS CAST TOTAL', 'BALLOTS CAST BLANK',
  'OVER VOTES', 'UNDER VOTES', 'Write-in',
  'Winning Candidate', 'Winning Party', 'Tie'
]);

/**
 * Parse a candidate column header into party + name.
 * Columns look like "Dem Kamala D. Harris/Tim Walz" or "Rep Donald J. Trump/JD Vance"
 * @param {string} colName - Column header
 * @returns {{ party: string, name: string }}
 */
function parseCandidateColumn(colName) {
  let match = colName.match(/^(Dem|Rep|Grn|Lib|Ind)\s+(.+)$/i);
  if (match) {
    return { party: match[1], name: match[2] };
  }
  return { party: 'Other', name: colName };
}

/**
 * Get precinct's result for a specific race
 * @param {Array} electionData - Array of precinct records for the race
 * @param {string} precinctCode - Precinct code to look up
 * @returns {Object|null} - Result object or null if not found
 */
export function getPrecinctResult(electionData, precinctCode) {
  if (!Array.isArray(electionData) || !precinctCode) {
    return null;
  }

  const codeStr = String(precinctCode);
  let record = electionData.find(row => String(row['PRECINCT CODE']) === codeStr);

  if (!record) {
    return null;
  }

  // Check if precinct actually participated in this race by summing candidate votes.
  // BALLOTS CAST TOTAL is precinct-wide and unreliable for district-specific races
  // (e.g. precinct outside a congressional district still shows total ballots).
  let candidateVotes = 0;
  for (let key of Object.keys(record)) {
    if (!SKIP_KEYS.has(key)) {
      candidateVotes += Number(record[key]) || 0;
    }
  }
  if (candidateVotes === 0) {
    return null;
  }

  return {
    precinctCode: codeStr,
    winner: record['Winning Candidate'] || 'N/A',
    winningParty: record['Winning Party'] || 'N/A',
    tie: record['Tie'] === true,
    totalVotes: candidateVotes,
    registeredVoters: Number(record['REGISTERED VOTERS TOTAL']) || 0
  };
}

/**
 * Extract candidate-level vote data for a precinct from already-loaded election data.
 * Returns detailed breakdown: each candidate with party, votes, percentage, and Dem/Rep totals.
 * @param {Array} electionData - Array of precinct records for the race
 * @param {string} precinctCode - Precinct code
 * @returns {Object|null} - { candidates: [{name,party,votes,pct}], demVotes, repVotes, totalVotes, demPct, repPct, margin, registeredVoters }
 */
export function getPrecinctCandidateData(electionData, precinctCode) {
  if (!Array.isArray(electionData) || !precinctCode) return null;

  let codeStr = String(precinctCode);
  let record = electionData.find(row => String(row['PRECINCT CODE']) === codeStr);
  if (!record) return null;

  let candidates = [];
  let totalVotes = 0;
  let demVotes = 0;
  let repVotes = 0;

  for (let key of Object.keys(record)) {
    if (SKIP_KEYS.has(key)) continue;
    let votes = Number(record[key]) || 0;
    if (votes === 0) continue;
    totalVotes += votes;
    let parsed = parseCandidateColumn(key);
    candidates.push({ name: parsed.name, party: parsed.party, votes });
    if (parsed.party.toLowerCase() === 'dem') demVotes += votes;
    if (parsed.party.toLowerCase() === 'rep') repVotes += votes;
  }

  if (totalVotes === 0) return null;

  // Add percentages and sort by votes descending
  for (let c of candidates) {
    c.pct = c.votes / totalVotes;
  }
  candidates.sort((a, b) => b.votes - a.votes);

  let demPct = demVotes / totalVotes;
  let repPct = repVotes / totalVotes;
  let margin = demPct - repPct; // positive = Dem advantage

  return {
    candidates,
    demVotes,
    repVotes,
    totalVotes,
    demPct,
    repPct,
    margin,
    registeredVoters: Number(record['REGISTERED VOTERS TOTAL']) || 0,
    winner: record['Winning Candidate'] || 'N/A',
    winningParty: record['Winning Party'] || 'N/A',
    tie: record['Tie'] === true,
  };
}

/**
 * Compute county-wide Dem vote share for a given election.
 * Sums all precincts' Dem votes / total votes.
 * @param {Array} electionData - Array of all precinct records for the race
 * @returns {number} - County-wide Dem vote share (0-1)
 */
export function computeCountyDemShare(electionData) {
  if (!Array.isArray(electionData)) return 0;

  let countyDem = 0;
  let countyTotal = 0;

  for (let record of electionData) {
    for (let key of Object.keys(record)) {
      if (SKIP_KEYS.has(key)) continue;
      let votes = Number(record[key]) || 0;
      countyTotal += votes;
      let parsed = parseCandidateColumn(key);
      if (parsed.party.toLowerCase() === 'dem') countyDem += votes;
    }
  }

  return countyTotal > 0 ? countyDem / countyTotal : 0;
}

/**
 * Build voting history for a precinct across all elections
 * @param {string} precinctCode - Precinct code
 * @param {Object} allElectionData - Map of filename -> election data array
 * @returns {Object} - Voting history grouped by category
 */
export function buildVotingHistory(precinctCode, allElectionData) {
  if (!precinctCode || !allElectionData || typeof allElectionData !== 'object') {
    return { races: [], byCategory: {}, partyRecord: {} };
  }
  
  let races = [];
  let byCategory = {};
  let partyRecord = { Rep: 0, Dem: 0, Other: 0, Tied: 0 };
  
  for (const [filename, electionData] of Object.entries(allElectionData)) {
    let result = getPrecinctResult(electionData, precinctCode);
    if (result) {
      const category = categorizeRace(filename);
      let raceInfo = {
        filename,
        raceName: formatRaceName(filename),
        category,
        ...result
      };
      
      races.push(raceInfo);
      
      // Group by category
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(raceInfo);
      
      // Track party wins. An exact tie is not a win for anybody — counting it
      // as one (first-max hands every Rep/Dem tie to DEM) would overstate the
      // Democratic record in this precinct's history.
      const party = result.tie ? null : result.winningParty;
      if (party === 'REP' || party === 'Rep') {
        partyRecord.Rep++;
      } else if (party === 'DEM' || party === 'Dem') {
        partyRecord.Dem++;
      } else if (result.tie) {
        partyRecord.Tied++;
      } else {
        partyRecord.Other++;
      }
    }
  }
  
  return { races, byCategory, partyRecord };
}

// ============================================================================
// PRECINCT COMPARISON FUNCTIONS
// ============================================================================

/**
 * Compare two precincts for a specific race
 * @param {Array} electionData - Election data for the race
 * @param {string} precinct1 - First precinct code
 * @param {string} precinct2 - Second precinct code
 * @returns {Object} - Comparison result
 */
export function comparePrecincts(electionData, precinct1, precinct2) {
  if (!Array.isArray(electionData) || !precinct1 || !precinct2) {
    return null;
  }
  
  let result1 = getPrecinctResult(electionData, precinct1);
  let result2 = getPrecinctResult(electionData, precinct2);
  
  return {
    precinct1: {
      code: String(precinct1),
      result: result1
    },
    precinct2: {
      code: String(precinct2),
      result: result2
    },
    bothParticipated: !!(result1 && result2),
    sameWinner: !!(result1 && result2 && result1.winningParty === result2.winningParty)
  };
}

/**
 * Compare demographics between two precincts
 * @param {Object} props1 - First precinct's properties
 * @param {Object} props2 - Second precinct's properties
 * @returns {Object} - Demographics comparison
 */
export function compareDemographics(props1, props2) {
  if (!props1 || !props2) {
    return null;
  }
  
  return {
    precinct1: {
      code: props1.PRECINCT || props1.precinct || 'Unknown',
      repShare: props1.repShare || 0,
      modShare: props1.modShare || 0,
      demShare: props1.demShare || 0,
      winningParty: props1.winningParty || 'N/A',
      partyStrength: props1.partyStrength || 0
    },
    precinct2: {
      code: props2.PRECINCT || props2.precinct || 'Unknown',
      repShare: props2.repShare || 0,
      modShare: props2.modShare || 0,
      demShare: props2.demShare || 0,
      winningParty: props2.winningParty || 'N/A',
      partyStrength: props2.partyStrength || 0
    },
    differences: {
      repShare: Math.abs((props1.repShare || 0) - (props2.repShare || 0)),
      modShare: Math.abs((props1.modShare || 0) - (props2.modShare || 0)),
      demShare: Math.abs((props1.demShare || 0) - (props2.demShare || 0))
    }
  };
}

/**
 * Calculate turnout percentage
 * @param {number} ballotsCast - Number of ballots cast
 * @param {number} registeredVoters - Number of registered voters
 * @returns {number} - Turnout percentage (0-100)
 */
export function calculateTurnout(ballotsCast, registeredVoters) {
  if (!registeredVoters || registeredVoters <= 0) {
    return 0;
  }
  const turnout = (ballotsCast / registeredVoters) * 100;
  return Math.min(100, Math.max(0, turnout));
}

// ============================================================================
// FEDERAL TREND
// ============================================================================

export function buildPrecinctTrend(precinctCode, allData, manifest) {
  if (!precinctCode || !allData || !manifest) return null;

  // Build a lookup from filename to manifest entry for year/category info
  let manifestByFile = {};
  for (let entry of manifest) {
    let fn = typeof entry === 'string' ? entry : entry.filename;
    manifestByFile[fn] = entry;
  }

  // Filter to Federal-level races where this precinct participated
  let federalRaces = [];
  for (let [filename, electionData] of Object.entries(allData)) {
    let entry = manifestByFile[filename];
    if (!entry) continue;
    let category = entry.category || categorizeRace(filename);
    if (category !== 'Federal') continue;

    let result = getPrecinctResult(electionData, precinctCode);
    if (!result) continue;

    // Compute Dem vote share for this precinct in this race
    let row = electionData.find(r => String(r['PRECINCT CODE']) === String(precinctCode));
    if (!row) continue;

    let demVotes = 0;
    let totalVotes = 0;
    for (let key of Object.keys(row)) {
      if (SKIP_KEYS.has(key)) continue;
      let votes = Number(row[key]) || 0;
      totalVotes += votes;
      if (key.startsWith('DEM ') || key.startsWith('Dem ')) {
        demVotes += votes;
      }
    }
    if (totalVotes === 0) continue;

    let demShare = demVotes / totalVotes;
    let year = entry.year || 0;
    let raceKey = getRaceFamilyKey(entry);
    let raceName = formatRaceName(filename);

    federalRaces.push({ filename, raceKey, raceName, year, demShare });
  }

  if (federalRaces.length < 2) return null;

  // Group by race family
  let byFamily = {};
  for (let race of federalRaces) {
    if (!byFamily[race.raceKey]) byFamily[race.raceKey] = [];
    byFamily[race.raceKey].push(race);
  }

  // Find the family with the two most recent elections
  let bestFamily = null;
  let bestRecent = 0;
  for (let [, races] of Object.entries(byFamily)) {
    if (races.length < 2) continue;
    races.sort((a, b) => b.year - a.year);
    let mostRecent = races[0].year;
    if (mostRecent > bestRecent) {
      bestRecent = mostRecent;
      bestFamily = races;
    }
  }

  if (!bestFamily || bestFamily.length < 2) return null;

  let newer = bestFamily[0];
  let older = bestFamily[1];
  let delta = (newer.demShare - older.demShare) * 100; // percentage points

  let direction;
  if (delta > 0.5) direction = 'dem';
  else if (delta < -0.5) direction = 'rep';
  else direction = 'stable';

  return {
    direction,
    delta,
    raceName: newer.raceName.replace(/\s*\(\d{4}\)\s*$/, '').replace(/_\d{4}$/, ''),
    year1: older.year,
    year2: newer.year
  };
}
