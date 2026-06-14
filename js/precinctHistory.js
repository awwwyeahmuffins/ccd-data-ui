// precinctHistory.js
// ===================
// Precinct Deep Dive Feature (Workstream 4)
// Feature 4A: Precinct Voting History
// Feature 4B: Precinct Comparison

import { loadElectionData, listElectionCSVs } from "./dataLoader.js";
import { getRaceKey } from "./electionTrends.js";

// ============================================================================
// RACE CATEGORY CLASSIFICATION
// ============================================================================

// Order matters: more specific patterns should be checked before general ones
let RACE_CATEGORIES = {
  Federal: ['President', 'U._S._Representative', 'United_States_Representative', 'United_States_Senator'],
  State: ['Governor', 'Lieutenant_Governor', 'Attorney_General', 'Comptroller', 'Commissioner_of', 
          'State_Representative', 'State_Senator', 'Railroad_Commissioner', 'Member,_State_Board',
          'Justice,_Supreme_Court', 'Judge,_Court_of_Criminal_Appeals', 'Presiding_Judge'],
  // MUD/ISD should be checked before County/City to avoid false matches
  ISD: ['_ISD_', 'School_Trustee'],
  MUD: ['_MUD_', 'MMD_'],
  County: ['County_Judge', 'County_Commissioner', 'County_Tax', 'District_Judge', 'District_Clerk', 
           'Sheriff', 'Constable', 'Justice_of_the_Peace', 'Justice,_5th_Court_of_Appeals', 'Chief_Justice'],
  City: ['City_of', 'Mayor', 'City_Council', 'Alderman'],
  Propositions: ['Proposition_', 'Local_Option', 'Home_Rule', 'Home-Rule']
};

// Category display order for UI
export let CATEGORY_ORDER = ['Federal', 'State', 'County', 'City', 'ISD', 'MUD', 'Propositions', 'Other'];

/**
 * Categorize a race filename into a type
 * @param {string} filename - Election CSV filename
 * @returns {string} - Category name
 */
export function categorizeRace(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'Other';
  }
  
  for (const [category, patterns] of Object.entries(RACE_CATEGORIES)) {
    for (const pattern of patterns) {
      if (filename.includes(pattern)) {
        return category;
      }
    }
  }
  return 'Other';
}

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
  'Winning Candidate', 'Winning Party'
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

  const ballotsCast = Number(record['BALLOTS CAST TOTAL']) || 0;

  return {
    precinctCode: codeStr,
    winner: record['Winning Candidate'] || 'N/A',
    winningParty: record['Winning Party'] || 'N/A',
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
  };
}

/**
 * Load a specific race CSV and return detailed candidate data for a precinct.
 * @param {string} precinctCode - Precinct code
 * @param {string|Object} filenameOrEntry - Filename or manifest entry
 * @returns {Promise<Object|null>} - Candidate data or null
 */
export async function getPrecinctRaceDetail(precinctCode, filenameOrEntry) {
  let data = await loadElectionData(filenameOrEntry);
  if (!data) return null;
  return getPrecinctCandidateData(data, precinctCode);
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
  let partyRecord = { Rep: 0, Dem: 0, Other: 0 };
  
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
      
      // Track party wins
      const party = result.winningParty;
      if (party === 'REP' || party === 'Rep') {
        partyRecord.Rep++;
      } else if (party === 'DEM' || party === 'Dem') {
        partyRecord.Dem++;
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
// HTML GENERATION FOR UI
// ============================================================================

/**
 * Generate HTML for voting history display
 * @param {Object} history - Voting history object from buildVotingHistory
 * @returns {string} - HTML string
 */
export function generateVotingHistoryHTML(history) {
  if (!history || !history.races || history.races.length === 0) {
    return '<p class="empty-state">No voting history available for this precinct.</p>';
  }
  
  let html = '<div class="voting-history">';
  
  // Party record summary
  html += '<div class="party-record">';
  html += `<span class="party-win rep" title="Republican wins">Rep: ${history.partyRecord.Rep}</span>`;
  html += `<span class="party-win dem" title="Democrat wins">Dem: ${history.partyRecord.Dem}</span>`;
  html += `<span class="party-win other" title="Other party wins">Other: ${history.partyRecord.Other}</span>`;
  html += '</div>';
  
  // Grouped by category
  for (const category of CATEGORY_ORDER) {
    const races = history.byCategory[category];
    if (!races || races.length === 0) continue;
    
    html += `<div class="history-category">`;
    html += `<h5 class="category-header">${category} <span class="race-count">(${races.length})</span></h5>`;
    html += '<ul class="race-list">';
    
    for (const race of races) {
      const partyClass = (race.winningParty || '').toLowerCase();
      const turnout = calculateTurnout(race.totalVotes, race.registeredVoters);
      html += `<li class="race-item ${partyClass}">`;
      html += `<span class="race-name">${race.raceName}</span>`;
      html += `<span class="race-winner">${race.winner}</span>`;
      html += `<span class="race-turnout">${turnout.toFixed(1)}% turnout</span>`;
      html += '</li>';
    }
    
    html += '</ul></div>';
  }
  
  html += '</div>';
  return html;
}

/**
 * Generate HTML for precinct comparison display
 * @param {Object} demographics - Demographics comparison from compareDemographics
 * @param {Object} electionComparison - Election comparison from comparePrecincts (optional)
 * @param {string} raceName - Name of the race being compared (optional)
 * @returns {string} - HTML string
 */
export function generateComparisonHTML(demographics, electionComparison, raceName) {
  if (!demographics) {
    return '<p class="error-state">Unable to compare precincts.</p>';
  }
  
  let html = '<div class="comparison-panel">';
  html += `<h4 class="comparison-title">Comparing Precincts ${demographics.precinct1.code} vs ${demographics.precinct2.code}</h4>`;
  
  // Demographics comparison table
  html += '<div class="comparison-section demographics">';
  html += '<h5>Demographics</h5>';
  html += '<table class="comparison-table">';
  html += `<thead><tr><th>Metric</th><th>Pct ${demographics.precinct1.code}</th><th>Pct ${demographics.precinct2.code}</th><th>Diff</th></tr></thead>`;
  html += '<tbody>';
  html += `<tr class="rep"><td>Rep Share</td><td>${(demographics.precinct1.repShare * 100).toFixed(1)}%</td><td>${(demographics.precinct2.repShare * 100).toFixed(1)}%</td><td>${(demographics.differences.repShare * 100).toFixed(1)}%</td></tr>`;
  html += `<tr class="mod"><td>Mod Share</td><td>${(demographics.precinct1.modShare * 100).toFixed(1)}%</td><td>${(demographics.precinct2.modShare * 100).toFixed(1)}%</td><td>${(demographics.differences.modShare * 100).toFixed(1)}%</td></tr>`;
  html += `<tr class="dem"><td>Dem Share</td><td>${(demographics.precinct1.demShare * 100).toFixed(1)}%</td><td>${(demographics.precinct2.demShare * 100).toFixed(1)}%</td><td>${(demographics.differences.demShare * 100).toFixed(1)}%</td></tr>`;
  html += `<tr><td>Party Lean</td><td>${demographics.precinct1.winningParty}</td><td>${demographics.precinct2.winningParty}</td><td>-</td></tr>`;
  html += `<tr><td>Strength</td><td>${demographics.precinct1.partyStrength}/3</td><td>${demographics.precinct2.partyStrength}/3</td><td>-</td></tr>`;
  html += '</tbody></table>';
  html += '</div>';
  
  // Election comparison (if provided)
  if (electionComparison && raceName) {
    html += '<div class="comparison-section election">';
    html += `<h5>Election: ${raceName}</h5>`;
    
    if (electionComparison.bothParticipated) {
      const p1 = electionComparison.precinct1;
      const p2 = electionComparison.precinct2;
      html += '<table class="comparison-table">';
      html += `<thead><tr><th>Precinct</th><th>Winner</th><th>Total Votes</th></tr></thead>`;
      html += '<tbody>';
      html += `<tr><td>${p1.code}</td><td>${p1.result.winner}</td><td>${p1.result.totalVotes.toLocaleString()}</td></tr>`;
      html += `<tr><td>${p2.code}</td><td>${p2.result.winner}</td><td>${p2.result.totalVotes.toLocaleString()}</td></tr>`;
      html += '</tbody></table>';
      html += `<p class="same-winner-indicator ${electionComparison.sameWinner ? 'same' : 'different'}">`;
      html += electionComparison.sameWinner ? '✓ Same winner in both precincts' : '✗ Different winners';
      html += '</p>';
    } else {
      html += '<p class="no-participation">One or both precincts did not participate in this race.</p>';
    }
    
    html += '</div>';
  }
  
  html += '</div>';
  return html;
}

// ============================================================================
// DATA LOADING UTILITIES
// ============================================================================

// Cache for loaded election data
let electionDataCache = {};

/**
 * Load all election data for a precinct's history
 * @returns {Promise<Object>} - Map of filename -> election data array
 */
export async function loadAllElectionDataForHistory() {
  // Return cache if populated
  if (Object.keys(electionDataCache).length > 0) {
    return electionDataCache;
  }
  
  let files = await listElectionCSVs();
  let loadPromises = files.map(async function loadSingleElection(entry) {
    let filename = typeof entry === 'string' ? entry : entry.filename;
    try {
      let data = await loadElectionData(entry);
      return [filename, data];
    } catch (err) {
      console.warn(`Failed to load ${filename}:`, err);
      return [filename, []];
    }
  });
  
  let results = await Promise.all(loadPromises);
  electionDataCache = Object.fromEntries(results);
  
  return electionDataCache;
}

/**
 * Clear the election data cache
 */
export function clearElectionDataCache() {
  electionDataCache = {};
}

/**
 * Get voting history for a precinct (convenience async function)
 * @param {string} precinctCode - Precinct code
 * @returns {Promise<Object>} - Voting history
 */
export async function getPrecinctVotingHistory(precinctCode) {
  let allData = await loadAllElectionDataForHistory();
  return buildVotingHistory(precinctCode, allData);
}

// ============================================================================
// PRECINCT TREND COMPUTATION
// ============================================================================

/**
 * Compute the partisan trend for a precinct across its most recent Federal races.
 * @param {string} precinctCode - Precinct code
 * @returns {Promise<Object|null>} Trend data or null if insufficient history
 *   { direction: 'dem'|'rep'|'stable', delta, raceName, year1, year2 }
 */
export async function computePrecinctTrend(precinctCode) {
  if (!precinctCode) return null;

  let allData = await loadAllElectionDataForHistory();
  let manifest = await listElectionCSVs();

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
    let raceKey = getRaceKey(entry);
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
  for (let [key, races] of Object.entries(byFamily)) {
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
