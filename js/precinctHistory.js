// precinctHistory.js
// ===================
// Precinct Deep Dive Feature (Workstream 4)
// Feature 4A: Precinct Voting History
// Feature 4B: Precinct Comparison

import { loadElectionData, listElectionCSVs } from "./dataLoader.js";

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
    .replace(/\.csv$/i, '')
    .replace(/_/g, ' ')
    .replace(/,/g, ', ');
}

// ============================================================================
// PRECINCT RESULT FUNCTIONS
// ============================================================================

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
  
  // Check if precinct actually participated (has votes)
  const ballotsCast = Number(record['BALLOTS CAST TOTAL']) || 0;
  if (ballotsCast === 0) {
    return null;
  }
  
  return {
    precinctCode: codeStr,
    winner: record['Winning Candidate'] || 'N/A',
    winningParty: record['Winning Party'] || 'N/A',
    totalVotes: ballotsCast,
    registeredVoters: Number(record['REGISTERED VOTERS TOTAL']) || 0
  };
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
// COMPARISON STATE MANAGEMENT
// ============================================================================

// State for precinct comparison (reassigned on clear)
let comparisonState = {
  precinct1: null,
  precinct2: null,
  isComparing: false
};

/**
 * Start comparing a precinct
 * @param {Object} precinctProps - Precinct properties
 * @returns {Object} - Updated comparison state
 */
export function startComparison(precinctProps) {
  if (!comparisonState.precinct1) {
    comparisonState.precinct1 = precinctProps;
    comparisonState.isComparing = true;
  } else if (!comparisonState.precinct2) {
    comparisonState.precinct2 = precinctProps;
  }
  return { ...comparisonState };
}

/**
 * Clear comparison state
 */
export function clearComparison() {
  comparisonState = {
    precinct1: null,
    precinct2: null,
    isComparing: false
  };
}

/**
 * Get current comparison state
 * @returns {Object} - Current comparison state
 */
export function getComparisonState() {
  return { ...comparisonState };
}
