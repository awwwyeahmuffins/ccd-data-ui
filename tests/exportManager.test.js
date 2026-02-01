// exportManager.test.js
// Unit tests for enhanced export functionality
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ============================================================================
// MOCK IMPLEMENTATIONS FOR TESTING
// These mirror the actual implementations that will be in exportManager.js
// ============================================================================

/**
 * Format election results for CSV export
 * @param {Array} electionData - Raw election data from CSV
 * @param {string} electionName - Human-readable election name
 * @returns {Array} Formatted data ready for CSV export
 */
function formatElectionResultsForExport(electionData, electionName) {
  if (!electionData || !Array.isArray(electionData) || electionData.length === 0) {
    return [];
  }

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
    const metaKeys = new Set([
      'PRECINCT CODE', 'REGISTERED VOTERS TOTAL', 'BALLOTS CAST TOTAL',
      'Winning Candidate', 'Winning Party'
    ]);
    
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
 * Calculate turnout percentage
 * @param {number} ballotsCast
 * @param {number} registeredVoters
 * @returns {string} Formatted percentage or 'N/A'
 */
function calculateTurnout(ballotsCast, registeredVoters) {
  if (!registeredVoters || registeredVoters === 0) {
    return 'N/A';
  }
  const turnout = (ballotsCast / registeredVoters) * 100;
  return turnout.toFixed(1) + '%';
}

/**
 * Format precinct history for CSV export
 * @param {string} precinctCode - The precinct identifier
 * @param {Array<Object>} electionResults - Array of { electionName, data } objects
 * @returns {Array} Formatted history data ready for CSV export
 */
function formatPrecinctHistoryForExport(precinctCode, electionResults) {
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
function filterElectionResults(electionData, filters = {}) {
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
function generateExportFilename(type, context = {}) {
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
function computeRaceSummary(electionData, candidateNames = []) {
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

// ============================================================================
// TESTS FOR formatElectionResultsForExport
// ============================================================================

describe('formatElectionResultsForExport', () => {
  const mockElectionData = [
    {
      'PRECINCT CODE': '100',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '750',
      'Winning Candidate': 'John Smith',
      'Winning Party': 'REP',
      'REP John Smith': '400',
      'DEM Jane Doe': '350'
    },
    {
      'PRECINCT CODE': '101',
      'REGISTERED VOTERS TOTAL': '800',
      'BALLOTS CAST TOTAL': '600',
      'Winning Candidate': 'Jane Doe',
      'Winning Party': 'DEM',
      'REP John Smith': '280',
      'DEM Jane Doe': '320'
    }
  ];

  it('should format data with descriptive headers', () => {
    const result = formatElectionResultsForExport(mockElectionData, 'Governor');
    
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('Election', 'Governor');
    expect(result[0]).toHaveProperty('Precinct Code', '100');
    expect(result[0]).toHaveProperty('Registered Voters');
    expect(result[0]).toHaveProperty('Ballots Cast');
  });

  it('should include candidate votes with "Votes:" prefix', () => {
    const result = formatElectionResultsForExport(mockElectionData, 'Governor');
    
    expect(result[0]).toHaveProperty('Votes: REP John Smith', 400);
    expect(result[0]).toHaveProperty('Votes: DEM Jane Doe', 350);
  });

  it('should return empty array for null input', () => {
    const result = formatElectionResultsForExport(null, 'Governor');
    expect(result).toEqual([]);
  });

  it('should return empty array for empty array input', () => {
    const result = formatElectionResultsForExport([], 'Governor');
    expect(result).toEqual([]);
  });

  it('should handle missing fields gracefully', () => {
    const incompleteData = [
      { 'PRECINCT CODE': '100' }
    ];
    const result = formatElectionResultsForExport(incompleteData, 'Test');
    
    expect(result[0]['Registered Voters']).toBe(0);
    expect(result[0]['Ballots Cast']).toBe(0);
    expect(result[0]['Winning Candidate']).toBe('');
  });
});

// ============================================================================
// TESTS FOR calculateTurnout
// ============================================================================

describe('calculateTurnout', () => {
  it('should calculate percentage correctly', () => {
    expect(calculateTurnout(750, 1000)).toBe('75.0%');
  });

  it('should handle 100% turnout', () => {
    expect(calculateTurnout(1000, 1000)).toBe('100.0%');
  });

  it('should handle 0 turnout', () => {
    expect(calculateTurnout(0, 1000)).toBe('0.0%');
  });

  it('should return N/A for zero registered voters', () => {
    expect(calculateTurnout(100, 0)).toBe('N/A');
  });

  it('should return N/A for null registered voters', () => {
    expect(calculateTurnout(100, null)).toBe('N/A');
  });

  it('should round to one decimal place', () => {
    expect(calculateTurnout(333, 1000)).toBe('33.3%');
    expect(calculateTurnout(666, 1000)).toBe('66.6%');
  });
});

// ============================================================================
// TESTS FOR formatPrecinctHistoryForExport
// ============================================================================

describe('formatPrecinctHistoryForExport', () => {
  const mockElections = [
    {
      electionName: 'Governor 2024',
      data: [
        { 'PRECINCT CODE': '100', 'BALLOTS CAST TOTAL': '750', 'REGISTERED VOTERS TOTAL': '1000', 'Winning Candidate': 'Smith', 'Winning Party': 'REP' },
        { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '600', 'REGISTERED VOTERS TOTAL': '800', 'Winning Candidate': 'Doe', 'Winning Party': 'DEM' }
      ]
    },
    {
      electionName: 'Sheriff 2024',
      data: [
        { 'PRECINCT CODE': '100', 'BALLOTS CAST TOTAL': '700', 'REGISTERED VOTERS TOTAL': '1000', 'Winning Candidate': 'Jones', 'Winning Party': 'REP' }
      ]
    }
  ];

  it('should return history for specific precinct', () => {
    const result = formatPrecinctHistoryForExport('100', mockElections);
    
    expect(result).toHaveLength(2);
    expect(result[0].Precinct).toBe('100');
    expect(result[0].Election).toBe('Governor 2024');
    expect(result[1].Election).toBe('Sheriff 2024');
  });

  it('should calculate turnout for each election', () => {
    const result = formatPrecinctHistoryForExport('100', mockElections);
    
    expect(result[0].Turnout).toBe('75.0%');
    expect(result[1].Turnout).toBe('70.0%');
  });

  it('should skip elections where precinct did not participate', () => {
    const result = formatPrecinctHistoryForExport('101', mockElections);
    
    expect(result).toHaveLength(1);
    expect(result[0].Election).toBe('Governor 2024');
  });

  it('should return empty array for unknown precinct', () => {
    const result = formatPrecinctHistoryForExport('999', mockElections);
    expect(result).toEqual([]);
  });

  it('should return empty array for null precinct', () => {
    const result = formatPrecinctHistoryForExport(null, mockElections);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty elections array', () => {
    const result = formatPrecinctHistoryForExport('100', []);
    expect(result).toEqual([]);
  });

  it('should handle string precinct code matching numeric data', () => {
    const numericElections = [
      {
        electionName: 'Test',
        data: [
          { 'PRECINCT CODE': 100, 'BALLOTS CAST TOTAL': '500', 'REGISTERED VOTERS TOTAL': '1000', 'Winning Candidate': 'Test', 'Winning Party': 'IND' }
        ]
      }
    ];
    const result = formatPrecinctHistoryForExport('100', numericElections);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// TESTS FOR filterElectionResults
// ============================================================================

describe('filterElectionResults', () => {
  const mockData = [
    { 'PRECINCT CODE': '100', 'BALLOTS CAST TOTAL': '750', 'REGISTERED VOTERS TOTAL': '1000', 'Winning Party': 'REP' },
    { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '400', 'REGISTERED VOTERS TOTAL': '1000', 'Winning Party': 'DEM' },
    { 'PRECINCT CODE': '102', 'BALLOTS CAST TOTAL': '0', 'REGISTERED VOTERS TOTAL': '500', 'Winning Party': '' },
    { 'PRECINCT CODE': '103', 'BALLOTS CAST TOTAL': '900', 'REGISTERED VOTERS TOTAL': '1000', 'Winning Party': 'REP' }
  ];

  it('should filter by minimum turnout', () => {
    const result = filterElectionResults(mockData, { minTurnout: 0.5 });
    
    expect(result).toHaveLength(2);
    expect(result.map(r => r['PRECINCT CODE'])).toEqual(['100', '103']);
  });

  it('should filter by party', () => {
    const result = filterElectionResults(mockData, { party: 'DEM' });
    
    expect(result).toHaveLength(1);
    expect(result[0]['PRECINCT CODE']).toBe('101');
  });

  it('should filter to precincts with votes', () => {
    const result = filterElectionResults(mockData, { hasVotes: true });
    
    expect(result).toHaveLength(3);
    expect(result.every(r => Number(r['BALLOTS CAST TOTAL']) > 0)).toBe(true);
  });

  it('should combine multiple filters', () => {
    const result = filterElectionResults(mockData, { 
      minTurnout: 0.5, 
      party: 'REP',
      hasVotes: true 
    });
    
    expect(result).toHaveLength(2);
    expect(result.map(r => r['PRECINCT CODE'])).toEqual(['100', '103']);
  });

  it('should return all data when no filters applied', () => {
    const result = filterElectionResults(mockData, {});
    expect(result).toHaveLength(4);
  });

  it('should return empty array for null input', () => {
    const result = filterElectionResults(null, {});
    expect(result).toEqual([]);
  });
});

// ============================================================================
// TESTS FOR generateExportFilename
// ============================================================================

describe('generateExportFilename', () => {
  // Mock Date for consistent testing
  const realDate = Date;
  const mockDate = new Date('2024-03-15T12:00:00Z');

  beforeEach(() => {
    global.Date = class extends realDate {
      constructor() {
        super();
        return mockDate;
      }
      static now() {
        return mockDate.getTime();
      }
    };
  });

  afterEach(() => {
    global.Date = realDate;
  });

  it('should generate filename for race export', () => {
    const filename = generateExportFilename('race', { raceName: 'Governor.csv' });
    expect(filename).toBe('Governor_results_2024-03-15.csv');
  });

  it('should sanitize special characters in race name', () => {
    const filename = generateExportFilename('race', { raceName: 'U._S._Representative,_District_32.csv' });
    expect(filename).toMatch(/^U__S__Representative__District_32_results_.*\.csv$/);
  });

  it('should generate filename for precinct history', () => {
    const filename = generateExportFilename('precinct', { precinctCode: '456' });
    expect(filename).toBe('precinct_456_history_2024-03-15.csv');
  });

  it('should generate filename for filtered export', () => {
    const filename = generateExportFilename('filtered', { filterDescription: 'high turnout' });
    expect(filename).toBe('high_turnout_results_2024-03-15.csv');
  });

  it('should handle unknown type', () => {
    const filename = generateExportFilename('unknown', {});
    expect(filename).toBe('export_2024-03-15.csv');
  });

  it('should truncate long race names', () => {
    const longName = 'a'.repeat(100) + '.csv';
    const filename = generateExportFilename('race', { raceName: longName });
    expect(filename.length).toBeLessThan(80);
  });
});

// ============================================================================
// TESTS FOR computeRaceSummary
// ============================================================================

describe('computeRaceSummary', () => {
  const mockData = [
    { 'PRECINCT CODE': '100', 'BALLOTS CAST TOTAL': '750', 'REGISTERED VOTERS TOTAL': '1000', 'REP Smith': '400', 'DEM Doe': '350' },
    { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '600', 'REGISTERED VOTERS TOTAL': '800', 'REP Smith': '280', 'DEM Doe': '320' },
    { 'PRECINCT CODE': '102', 'BALLOTS CAST TOTAL': '0', 'REGISTERED VOTERS TOTAL': '0', 'REP Smith': '0', 'DEM Doe': '0' }
  ];
  const candidates = ['REP Smith', 'DEM Doe'];

  it('should calculate total votes correctly', () => {
    const result = computeRaceSummary(mockData, candidates);
    expect(result.totalVotes).toBe(1350); // 750 + 600
  });

  it('should count active precincts correctly', () => {
    const result = computeRaceSummary(mockData, candidates);
    expect(result.activePrecincts).toBe(2);
    expect(result.totalPrecincts).toBe(3);
  });

  it('should calculate county-wide turnout', () => {
    const result = computeRaceSummary(mockData, candidates);
    expect(result.turnout).toBe('75.0%'); // 1350 / 1800
  });

  it('should sum candidate totals', () => {
    const result = computeRaceSummary(mockData, candidates);
    expect(result.candidateTotals['REP Smith']).toBe(680); // 400 + 280
    expect(result.candidateTotals['DEM Doe']).toBe(670); // 350 + 320
  });

  it('should determine winner correctly', () => {
    const result = computeRaceSummary(mockData, candidates);
    expect(result.winner).toBe('REP Smith');
  });

  it('should calculate margin correctly', () => {
    const result = computeRaceSummary(mockData, candidates);
    expect(result.margin).toBe(10); // 680 - 670
  });

  it('should return empty summary for null data', () => {
    const result = computeRaceSummary(null, candidates);
    expect(result.totalPrecincts).toBe(0);
    expect(result.totalVotes).toBe(0);
    expect(result.winner).toBeNull();
  });

  it('should handle empty candidate list', () => {
    const result = computeRaceSummary(mockData, []);
    expect(result.candidateTotals).toEqual({});
    expect(result.winner).toBeNull();
  });
});

// ============================================================================
// TESTS FOR clipboard integration (mock)
// ============================================================================

describe('clipboard copy functionality', () => {
  it('should copy URL to clipboard (mock test)', async () => {
    // Mock navigator.clipboard
    const mockClipboard = {
      writeText: jest.fn().mockResolvedValue(undefined)
    };
    
    // Simulated copyToClipboard function
    async function copyToClipboard(text) {
      try {
        await mockClipboard.writeText(text);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    const url = 'https://example.com/#view=election&race=Governor.csv';
    const result = await copyToClipboard(url);
    
    expect(result.success).toBe(true);
    expect(mockClipboard.writeText).toHaveBeenCalledWith(url);
  });

  it('should handle clipboard failure gracefully', async () => {
    const mockClipboard = {
      writeText: jest.fn().mockRejectedValue(new Error('Clipboard access denied'))
    };

    async function copyToClipboard(text) {
      try {
        await mockClipboard.writeText(text);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    const result = await copyToClipboard('test');
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Clipboard access denied');
  });
});
