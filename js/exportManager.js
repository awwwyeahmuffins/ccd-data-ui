// exportManager.js
// Enhanced export functionality for election data
// Supports race results, precinct history, and filtered exports

import { downloadCSV, arrayToCSV } from './exportCSV.js';
import { ELECTION_META_KEYS } from './constants.js';

/**
 * Calculate turnout percentage
 * @param {number} ballotsCast
 * @param {number} registeredVoters
 * @returns {string} Formatted percentage or 'N/A'
 */
export function calculateTurnout(ballotsCast, registeredVoters) {
  if (!registeredVoters || registeredVoters === 0) {
    return 'N/A';
  }
  const turnout = (ballotsCast / registeredVoters) * 100;
  return turnout.toFixed(1) + '%';
}

/**
 * Format election results for CSV export
 * @param {Array} electionData - Raw election data from CSV
 * @param {string} electionName - Human-readable election name
 * @returns {Array} Formatted data ready for CSV export
 */
export function formatElectionResultsForExport(electionData, electionName) {
  if (!electionData || !Array.isArray(electionData) || electionData.length === 0) {
    return [];
  }

  // Define meta keys that are not candidate votes
  const metaKeys = new Set([
    'PRECINCT CODE', 'REGISTERED VOTERS TOTAL', 'BALLOTS CAST TOTAL',
    'Winning Candidate', 'Winning Party'
  ]);

  return electionData.map(row => {
    // Build a clean export object with descriptive headers
    const exportRow = {
      'Election': electionName,
      'Precinct Code': row['PRECINCT CODE'] || '',
      'Registered Voters': row['REGISTERED VOTERS TOTAL'] || 0,
      'Ballots Cast': row['BALLOTS CAST TOTAL'] || 0,
      'Winning Candidate': row['Winning Candidate'] || '',
      'Winning Party': row['Winning Party'] || ''
    };

    // Add candidate vote columns
    Object.keys(row).forEach(key => {
      if (!metaKeys.has(key)) {
        const value = row[key];
        // Only include if it looks like a vote count
        if (value !== '' && !isNaN(Number(value))) {
          exportRow[`Votes: ${key}`] = Number(value);
        }
      }
    });

    return exportRow;
  });
}

/**
 * Format precinct history for CSV export
 * @param {string} precinctCode - The precinct identifier
 * @param {Array<Object>} electionResults - Array of { electionName, data } objects
 * @returns {Array} Formatted history data ready for CSV export
 */
export function formatPrecinctHistoryForExport(precinctCode, electionResults) {
  if (!precinctCode || !electionResults || !Array.isArray(electionResults)) {
    return [];
  }

  const history = [];

  electionResults.forEach(election => {
    if (!election.data || !Array.isArray(election.data)) return;
    
    // Find this precinct's data in the election
    const precinctData = election.data.find(
      row => String(row['PRECINCT CODE']) === String(precinctCode)
    );
    
    if (!precinctData) return;
    
    // Skip if precinct wasn't part of this race
    const ballotsCast = Number(precinctData['BALLOTS CAST TOTAL']) || 0;
    const registeredVoters = Number(precinctData['REGISTERED VOTERS TOTAL']) || 0;
    if (ballotsCast === 0 && registeredVoters === 0) return;

    history.push({
      'Precinct': precinctCode,
      'Election': election.electionName,
      'Registered Voters': registeredVoters,
      'Ballots Cast': ballotsCast,
      'Turnout': calculateTurnout(ballotsCast, registeredVoters),
      'Winning Candidate': precinctData['Winning Candidate'] || '',
      'Winning Party': precinctData['Winning Party'] || ''
    });
  });

  return history;
}

/**
 * Filter election results by criteria
 * @param {Array} electionData - Raw election data
 * @param {Object} filters - { minTurnout, party, hasVotes }
 * @returns {Array} Filtered data
 */
export function filterElectionResults(electionData, filters = {}) {
  if (!electionData || !Array.isArray(electionData)) {
    return [];
  }

  return electionData.filter(row => {
    const ballotsCast = Number(row['BALLOTS CAST TOTAL']) || 0;
    const registeredVoters = Number(row['REGISTERED VOTERS TOTAL']) || 0;
    const turnout = registeredVoters > 0 ? (ballotsCast / registeredVoters) : 0;

    // Filter by minimum turnout
    if (filters.minTurnout !== undefined && turnout < filters.minTurnout) {
      return false;
    }

    // Filter by winning party
    if (filters.party && row['Winning Party'] !== filters.party) {
      return false;
    }

    // Filter to only precincts with votes
    if (filters.hasVotes && ballotsCast === 0) {
      return false;
    }

    return true;
  });
}

/**
 * Generate a filename for export based on context
 * @param {string} type - 'race', 'precinct', 'filtered'
 * @param {Object} context - { raceName, precinctCode, filterDescription }
 * @returns {string} Suggested filename
 */
export function generateExportFilename(type, context = {}) {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  switch (type) {
    case 'race':
      const raceName = context.raceName || 'election';
      const cleanRaceName = raceName
        .replace(/\.csv$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 50);
      return `${cleanRaceName}_results_${timestamp}.csv`;

    case 'precinct':
      const precinctCode = context.precinctCode || 'unknown';
      return `precinct_${precinctCode}_history_${timestamp}.csv`;

    case 'filtered':
      const filterDesc = context.filterDescription || 'filtered';
      const cleanFilterDesc = filterDesc
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 30);
      return `${cleanFilterDesc}_results_${timestamp}.csv`;

    default:
      return `export_${timestamp}.csv`;
  }
}

/**
 * Compute county-wide summary statistics for a race
 * @param {Array} electionData - Raw election data
 * @param {Array<string>} candidateNames - List of candidate column names
 * @returns {Object} Summary statistics
 */
export function computeRaceSummary(electionData, candidateNames = []) {
  if (!electionData || !Array.isArray(electionData) || electionData.length === 0) {
    return {
      totalPrecincts: 0,
      activePrecincts: 0,
      totalVotes: 0,
      totalRegistered: 0,
      turnout: 'N/A',
      candidateTotals: {},
      winner: null,
      margin: 0
    };
  }

  let totalVotes = 0;
  let totalRegistered = 0;
  let activePrecincts = 0;
  const candidateTotals = {};

  // Initialize candidate totals
  candidateNames.forEach(name => {
    candidateTotals[name] = 0;
  });

  electionData.forEach(row => {
    const ballots = Number(row['BALLOTS CAST TOTAL']) || 0;
    const registered = Number(row['REGISTERED VOTERS TOTAL']) || 0;

    if (ballots > 0 || registered > 0) {
      activePrecincts++;
      totalVotes += ballots;
      totalRegistered += registered;

      // Sum candidate votes
      candidateNames.forEach(name => {
        candidateTotals[name] += Number(row[name]) || 0;
      });
    }
  });

  // Find winner and margin
  let winner = null;
  let topVotes = 0;
  let secondVotes = 0;

  Object.entries(candidateTotals).forEach(([name, votes]) => {
    if (votes > topVotes) {
      secondVotes = topVotes;
      topVotes = votes;
      winner = name;
    } else if (votes > secondVotes) {
      secondVotes = votes;
    }
  });

  const margin = topVotes - secondVotes;
  const marginPct = totalVotes > 0 ? ((margin / totalVotes) * 100).toFixed(1) + '%' : 'N/A';

  return {
    totalPrecincts: electionData.length,
    activePrecincts,
    totalVotes,
    totalRegistered,
    turnout: calculateTurnout(totalVotes, totalRegistered),
    candidateTotals,
    winner,
    margin,
    marginPct
  };
}

/**
 * Export current race results to CSV
 * @param {Array} electionData - Raw election data
 * @param {string} raceName - Name of the race/election file
 */
export function exportRaceResults(electionData, raceName) {
  const displayName = raceName.replace(/\.csv$/, '').replace(/_/g, ' ');
  const formattedData = formatElectionResultsForExport(electionData, displayName);
  const filename = generateExportFilename('race', { raceName });
  downloadCSV(formattedData, filename);
}

/**
 * Export precinct history to CSV (requires loading multiple elections)
 * @param {string} precinctCode - The precinct identifier
 * @param {Array<Object>} electionResults - Array of { electionName, data } objects
 */
export function exportPrecinctHistory(precinctCode, electionResults) {
  const formattedData = formatPrecinctHistoryForExport(precinctCode, electionResults);
  const filename = generateExportFilename('precinct', { precinctCode });
  downloadCSV(formattedData, filename);
}

/**
 * Export filtered results to CSV
 * @param {Array} electionData - Raw election data
 * @param {string} raceName - Name of the race/election file
 * @param {Object} filters - Applied filters
 * @param {string} filterDescription - Human-readable filter description
 */
export function exportFilteredResults(electionData, raceName, filters, filterDescription) {
  const filteredData = filterElectionResults(electionData, filters);
  const displayName = raceName.replace(/\.csv$/, '').replace(/_/g, ' ');
  const formattedData = formatElectionResultsForExport(filteredData, displayName);
  const filename = generateExportFilename('filtered', { filterDescription });
  downloadCSV(formattedData, filename);
}

/**
 * Create an export dropdown menu controller
 * @param {HTMLElement} container - Container element for the dropdown
 * @param {Object} callbacks - { onExportRace, onExportPrecinct, onExportFiltered }
 * @returns {Object} Controller with show/hide/update methods
 */
export function createExportDropdown(container, callbacks = {}) {
  const dropdownId = 'export-dropdown-' + Date.now();
  
  const html = `
    <div class="export-dropdown" id="${dropdownId}">
      <button class="export-dropdown-btn" aria-haspopup="true" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Export
        <svg class="dropdown-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div class="export-dropdown-menu" role="menu" aria-hidden="true">
        <button class="export-option" data-action="race" role="menuitem">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          Current Race Results
        </button>
        <button class="export-option" data-action="precinct" role="menuitem" disabled>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          Selected Precinct History
        </button>
        <button class="export-option" data-action="filtered" role="menuitem" disabled>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
          </svg>
          Filtered Results
        </button>
      </div>
    </div>
  `;
  
  container.innerHTML = html;
  
  const dropdown = document.getElementById(dropdownId);
  const btn = dropdown.querySelector('.export-dropdown-btn');
  const menu = dropdown.querySelector('.export-dropdown-menu');
  const options = dropdown.querySelectorAll('.export-option');
  
  let isOpen = false;
  
  function toggleDropdown() {
    isOpen = !isOpen;
    btn.setAttribute('aria-expanded', isOpen);
    menu.setAttribute('aria-hidden', !isOpen);
    dropdown.classList.toggle('open', isOpen);
  }
  
  function closeDropdown() {
    isOpen = false;
    btn.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
    dropdown.classList.remove('open');
  }
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });
  
  // Close on outside click
  document.addEventListener('click', closeDropdown);
  
  // Handle option clicks
  options.forEach(option => {
    option.addEventListener('click', () => {
      const action = option.dataset.action;
      closeDropdown();
      
      if (action === 'race' && callbacks.onExportRace) {
        callbacks.onExportRace();
      } else if (action === 'precinct' && callbacks.onExportPrecinct) {
        callbacks.onExportPrecinct();
      } else if (action === 'filtered' && callbacks.onExportFiltered) {
        callbacks.onExportFiltered();
      }
    });
  });
  
  // Keyboard navigation
  dropdown.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
      btn.focus();
    }
  });
  
  return {
    show: () => { dropdown.style.display = 'inline-block'; },
    hide: () => { dropdown.style.display = 'none'; },
    close: closeDropdown,
    enablePrecinct: () => {
      dropdown.querySelector('[data-action="precinct"]').disabled = false;
    },
    disablePrecinct: () => {
      dropdown.querySelector('[data-action="precinct"]').disabled = true;
    },
    enableFiltered: () => {
      dropdown.querySelector('[data-action="filtered"]').disabled = false;
    },
    disableFiltered: () => {
      dropdown.querySelector('[data-action="filtered"]').disabled = true;
    },
    element: dropdown
  };
}
