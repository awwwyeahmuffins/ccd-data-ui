// turnoutView.test.js
// Unit tests for Turnout Analysis View (Workstream 6)
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ============================================================================
// MOCK IMPLEMENTATIONS FOR TESTING
// These mirror the actual implementations that will be in turnoutView.js
// ============================================================================

// Mock ELECTION_META_KEYS (from constants.js)
const ELECTION_META_KEYS = new Set([
  "COUNTY NUMBER",
  "PRECINCT CODE",
  "PRECINCT NAME",
  "REGISTERED VOTERS TOTAL",
  "BALLOTS CAST TOTAL",
  "BALLOTS CAST BLANK",
  "Write-in",
  "OVER VOTES",
  "UNDER VOTES",
  "Winning Candidate",
  "Winning Party"
]);

/**
 * Check if a precinct actually participated in this specific race
 * A precinct participated if it has any non-zero votes in race-specific columns
 * @param {Object} row - A row of election data
 * @returns {boolean} True if the precinct participated in this race
 */
function precinctParticipatedInRace(row) {
  if (!row || typeof row !== 'object') {
    return false;
  }
  
  // Get all race-specific columns (exclude metadata columns)
  const raceColumns = Object.keys(row).filter(key => !ELECTION_META_KEYS.has(key));
  
  // A precinct participated if any race-specific column has a non-zero value
  return raceColumns.some(col => {
    const value = Number(row[col]);
    return !isNaN(value) && value > 0;
  });
}

/**
 * Calculate turnout percentage for a precinct
 * @param {number} ballotsCast - Number of ballots cast
 * @param {number} registeredVoters - Number of registered voters
 * @returns {number} Turnout percentage (0-100), or 0 if invalid
 */
function calculateTurnout(ballotsCast, registeredVoters) {
  const ballots = Number(ballotsCast);
  const registered = Number(registeredVoters);
  
  if (isNaN(ballots) || isNaN(registered) || registered <= 0) {
    return 0;
  }
  
  // Cap at 100% to handle edge cases
  return Math.min(100, (ballots / registered) * 100);
}

/**
 * Get turnout color based on percentage
 * Red (low) to Green (high) gradient
 * @param {number} turnoutPct - Turnout percentage (0-100)
 * @returns {string} Hex color code
 */
function getTurnoutColor(turnoutPct) {
  if (turnoutPct == null || isNaN(turnoutPct)) {
    return '#f5f5f5'; // Gray for invalid
  }
  
  // Clamp between 0 and 100
  const pct = Math.max(0, Math.min(100, turnoutPct));
  
  // Color scale from red (low turnout) to green (high turnout)
  // Red: #E74C3C (low), Yellow: #F1C40F (medium), Green: #27AE60 (high)
  if (pct < 50) {
    // Red to Yellow gradient (0-50%)
    const ratio = pct / 50;
    const r = Math.round(231 + (241 - 231) * ratio);
    const g = Math.round(76 + (196 - 76) * ratio);
    const b = Math.round(60 + (15 - 60) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Yellow to Green gradient (50-100%)
    const ratio = (pct - 50) / 50;
    const r = Math.round(241 + (39 - 241) * ratio);
    const g = Math.round(196 + (174 - 196) * ratio);
    const b = Math.round(15 + (96 - 15) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Prepare turnout data for all precincts in an election
 * @param {Array} electionData - Raw election CSV data
 * @returns {Array} Array of precinct turnout objects sorted by turnout descending
 */
function prepareTurnoutData(electionData) {
  if (!Array.isArray(electionData) || electionData.length === 0) {
    return [];
  }
  
  const turnoutData = electionData
    .filter(row => precinctParticipatedInRace(row)) // Only include precincts that participated in this race
    .map(row => {
      const precinctCode = row['PRECINCT CODE'];
      const precinctName = row['PRECINCT NAME'] || `Precinct ${precinctCode}`;
      const registeredVoters = Number(row['REGISTERED VOTERS TOTAL']) || 0;
      const ballotsCast = Number(row['BALLOTS CAST TOTAL']) || 0;
      const turnoutPct = calculateTurnout(ballotsCast, registeredVoters);
      
      return {
        precinctCode: String(precinctCode),
        precinctName,
        registeredVoters,
        ballotsCast,
        turnoutPct,
        turnoutColor: getTurnoutColor(turnoutPct)
      };
    })
    .filter(d => d.registeredVoters > 0); // Also filter out precincts with no registered voters
  
  // Sort by turnout percentage descending
  turnoutData.sort((a, b) => b.turnoutPct - a.turnoutPct);
  
  // Add rank
  turnoutData.forEach((d, i) => {
    d.rank = i + 1;
  });
  
  return turnoutData;
}

/**
 * Get top N precincts by turnout
 * @param {Array} turnoutData - Prepared turnout data
 * @param {number} n - Number of precincts to return
 * @returns {Array} Top N precincts
 */
function getTopPrecincts(turnoutData, n = 10) {
  if (!Array.isArray(turnoutData)) return [];
  return turnoutData.slice(0, Math.min(n, turnoutData.length));
}

/**
 * Get bottom N precincts by turnout
 * @param {Array} turnoutData - Prepared turnout data
 * @param {number} n - Number of precincts to return
 * @returns {Array} Bottom N precincts
 */
function getBottomPrecincts(turnoutData, n = 10) {
  if (!Array.isArray(turnoutData)) return [];
  return turnoutData.slice(-Math.min(n, turnoutData.length)).reverse();
}

/**
 * Calculate turnout summary statistics for precincts that participated in this race
 * @param {Array} electionData - Raw election CSV data
 * @returns {Object} Summary statistics
 */
function calculateCountySummary(electionData) {
  if (!Array.isArray(electionData) || electionData.length === 0) {
    return {
      totalRegistered: 0,
      totalBallotsCast: 0,
      overallTurnout: 0,
      precinctCount: 0,
      participatingPrecincts: 0,
      avgTurnout: 0,
      minTurnout: 0,
      maxTurnout: 0
    };
  }
  
  // Filter to only precincts that actually participated in this race
  const participatingData = electionData.filter(row => precinctParticipatedInRace(row));
  
  let totalRegistered = 0;
  let totalBallotsCast = 0;
  let participatingPrecincts = 0;
  let turnouts = [];
  
  participatingData.forEach(row => {
    const registered = Number(row['REGISTERED VOTERS TOTAL']) || 0;
    const ballots = Number(row['BALLOTS CAST TOTAL']) || 0;
    
    if (registered > 0) {
      totalRegistered += registered;
      totalBallotsCast += ballots;
      participatingPrecincts++;
      turnouts.push(calculateTurnout(ballots, registered));
    }
  });
  
  const overallTurnout = totalRegistered > 0 
    ? (totalBallotsCast / totalRegistered) * 100 
    : 0;
  
  const avgTurnout = turnouts.length > 0
    ? turnouts.reduce((a, b) => a + b, 0) / turnouts.length
    : 0;
  
  return {
    totalRegistered,
    totalBallotsCast,
    overallTurnout: Math.round(overallTurnout * 10) / 10,
    precinctCount: participatingData.length,
    participatingPrecincts,
    avgTurnout: Math.round(avgTurnout * 10) / 10,
    minTurnout: turnouts.length > 0 ? Math.min(...turnouts) : 0,
    maxTurnout: turnouts.length > 0 ? Math.max(...turnouts) : 0
  };
}

/**
 * Format turnout percentage for display
 * @param {number} pct - Turnout percentage
 * @returns {string} Formatted percentage string
 */
function formatTurnoutPct(pct) {
  if (pct == null || isNaN(pct)) {
    return 'N/A';
  }
  return pct.toFixed(1) + '%';
}

// ============================================================================
// TESTS FOR calculateTurnout
// ============================================================================

describe('calculateTurnout', () => {
  it('should calculate correct turnout percentage', () => {
    expect(calculateTurnout(500, 1000)).toBe(50);
    expect(calculateTurnout(750, 1000)).toBe(75);
    expect(calculateTurnout(1000, 1000)).toBe(100);
  });

  it('should handle zero ballots cast', () => {
    expect(calculateTurnout(0, 1000)).toBe(0);
  });

  it('should return 0 for zero registered voters', () => {
    expect(calculateTurnout(500, 0)).toBe(0);
  });

  it('should return 0 for negative registered voters', () => {
    expect(calculateTurnout(500, -100)).toBe(0);
  });

  it('should cap at 100% (handle edge cases where ballots > registered)', () => {
    expect(calculateTurnout(1200, 1000)).toBe(100);
  });

  it('should handle string inputs (from CSV data)', () => {
    expect(calculateTurnout('500', '1000')).toBe(50);
    expect(calculateTurnout('750', '1000')).toBe(75);
  });

  it('should return 0 for NaN inputs', () => {
    expect(calculateTurnout(NaN, 1000)).toBe(0);
    expect(calculateTurnout(500, NaN)).toBe(0);
    expect(calculateTurnout('abc', 1000)).toBe(0);
  });

  it('should return 0 for null/undefined inputs', () => {
    expect(calculateTurnout(null, 1000)).toBe(0);
    expect(calculateTurnout(undefined, 1000)).toBe(0);
    expect(calculateTurnout(500, null)).toBe(0);
    expect(calculateTurnout(500, undefined)).toBe(0);
  });

  it('should handle decimal results', () => {
    const result = calculateTurnout(333, 1000);
    expect(result).toBeCloseTo(33.3, 1);
  });
});

// ============================================================================
// TESTS FOR getTurnoutColor
// ============================================================================

describe('getTurnoutColor', () => {
  it('should return reddish color for low turnout (0-25%)', () => {
    const color = getTurnoutColor(10);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Should have high red component
    const [, r, g] = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(Number(r)).toBeGreaterThan(Number(g));
  });

  it('should return yellowish color for medium turnout (~50%)', () => {
    const color = getTurnoutColor(50);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Yellow has high R and high G
    const [, r, g, b] = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(Number(r)).toBeGreaterThan(200);
    expect(Number(g)).toBeGreaterThan(150);
  });

  it('should return greenish color for high turnout (75-100%)', () => {
    const color = getTurnoutColor(90);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Green has lower R than G
    const [, r, g] = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
    expect(Number(g)).toBeGreaterThan(Number(r) - 50); // G should be relatively higher
  });

  it('should return gray for null/undefined', () => {
    expect(getTurnoutColor(null)).toBe('#f5f5f5');
    expect(getTurnoutColor(undefined)).toBe('#f5f5f5');
  });

  it('should return gray for NaN', () => {
    expect(getTurnoutColor(NaN)).toBe('#f5f5f5');
  });

  it('should clamp values below 0', () => {
    const color = getTurnoutColor(-10);
    expect(color).not.toBe('#f5f5f5');
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('should clamp values above 100', () => {
    const color = getTurnoutColor(150);
    expect(color).not.toBe('#f5f5f5');
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('should handle 0% turnout', () => {
    const color = getTurnoutColor(0);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('should handle 100% turnout', () => {
    const color = getTurnoutColor(100);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});

// ============================================================================
// TESTS FOR precinctParticipatedInRace
// ============================================================================

describe('precinctParticipatedInRace', () => {
  it('should return true when precinct has non-zero votes for candidates', () => {
    const row = {
      'PRECINCT CODE': '101',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '750',
      'Rep John Smith': '400',
      'Dem Jane Doe': '350'
    };
    expect(precinctParticipatedInRace(row)).toBe(true);
  });

  it('should return true when precinct has non-zero For/Against votes', () => {
    const row = {
      'PRECINCT CODE': '101',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '750',
      'For': '500',
      'Against': '200'
    };
    expect(precinctParticipatedInRace(row)).toBe(true);
  });

  it('should return false when precinct has zero votes in all race columns', () => {
    const row = {
      'PRECINCT CODE': '101',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '750',
      'For': '0',
      'Against': '0',
      'OVER VOTES': '0',
      'UNDER VOTES': '0'
    };
    expect(precinctParticipatedInRace(row)).toBe(false);
  });

  it('should ignore metadata columns when checking participation', () => {
    const row = {
      'COUNTY NUMBER': 'COLL',
      'PRECINCT CODE': '101',
      'PRECINCT NAME': 'PCT 101',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '750',
      'BALLOTS CAST BLANK': '5',
      'OVER VOTES': '2',
      'UNDER VOTES': '10',
      'For': '0',
      'Against': '0'
    };
    // Only metadata columns have non-zero values, race columns are zero
    expect(precinctParticipatedInRace(row)).toBe(false);
  });

  it('should return false for null input', () => {
    expect(precinctParticipatedInRace(null)).toBe(false);
  });

  it('should return false for undefined input', () => {
    expect(precinctParticipatedInRace(undefined)).toBe(false);
  });

  it('should return false for non-object input', () => {
    expect(precinctParticipatedInRace('string')).toBe(false);
  });

  it('should handle city-specific race data correctly', () => {
    // This simulates the Murphy Proposition A case - most precincts have 0 votes
    const murphyPrecinct = {
      'COUNTY NUMBER': 'COLL',
      'PRECINCT CODE': '25',
      'PRECINCT NAME': 'PCT 025',
      'REGISTERED VOTERS TOTAL': '3943',
      'BALLOTS CAST TOTAL': '2150',
      'For': '1798',
      'Against': '191'
    };
    const nonMurphyPrecinct = {
      'COUNTY NUMBER': 'COLL',
      'PRECINCT CODE': '1',
      'PRECINCT NAME': 'PCT 001',
      'REGISTERED VOTERS TOTAL': '2737',
      'BALLOTS CAST TOTAL': '1491',
      'For': '0',
      'Against': '0'
    };
    expect(precinctParticipatedInRace(murphyPrecinct)).toBe(true);
    expect(precinctParticipatedInRace(nonMurphyPrecinct)).toBe(false);
  });
});

// ============================================================================
// TESTS FOR prepareTurnoutData
// ============================================================================

describe('prepareTurnoutData', () => {
  // Mock data with race-specific columns (For/Against) to test participation filter
  const mockElectionData = [
    { 'PRECINCT CODE': '101', 'PRECINCT NAME': 'PCT 101', 'REGISTERED VOTERS TOTAL': '1000', 'BALLOTS CAST TOTAL': '750', 'For': '500', 'Against': '200' },
    { 'PRECINCT CODE': '102', 'PRECINCT NAME': 'PCT 102', 'REGISTERED VOTERS TOTAL': '2000', 'BALLOTS CAST TOTAL': '1000', 'For': '700', 'Against': '250' },
    { 'PRECINCT CODE': '103', 'PRECINCT NAME': 'PCT 103', 'REGISTERED VOTERS TOTAL': '1500', 'BALLOTS CAST TOTAL': '1200', 'For': '900', 'Against': '250' },
  ];

  it('should return array of precinct turnout objects', () => {
    const result = prepareTurnoutData(mockElectionData);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('precinctCode');
    expect(result[0]).toHaveProperty('precinctName');
    expect(result[0]).toHaveProperty('turnoutPct');
    expect(result[0]).toHaveProperty('turnoutColor');
  });

  it('should sort by turnout percentage descending', () => {
    const result = prepareTurnoutData(mockElectionData);
    expect(result[0].precinctCode).toBe('103'); // 80%
    expect(result[1].precinctCode).toBe('101'); // 75%
    expect(result[2].precinctCode).toBe('102'); // 50%
  });

  it('should add rank property', () => {
    const result = prepareTurnoutData(mockElectionData);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
    expect(result[2].rank).toBe(3);
  });

  it('should calculate correct turnout percentages', () => {
    const result = prepareTurnoutData(mockElectionData);
    const pct103 = result.find(d => d.precinctCode === '103');
    expect(pct103.turnoutPct).toBe(80); // 1200/1500 * 100
  });

  it('should filter out precincts with 0 registered voters', () => {
    const dataWithZero = [
      ...mockElectionData,
      { 'PRECINCT CODE': '999', 'PRECINCT NAME': 'Empty', 'REGISTERED VOTERS TOTAL': '0', 'BALLOTS CAST TOTAL': '0', 'For': '0', 'Against': '0' }
    ];
    const result = prepareTurnoutData(dataWithZero);
    expect(result).toHaveLength(3);
    expect(result.find(d => d.precinctCode === '999')).toBeUndefined();
  });

  it('should filter out precincts that did not participate in the race (zero votes)', () => {
    const dataWithNonParticipating = [
      ...mockElectionData,
      // This precinct has registered voters and ballots cast, but zero race-specific votes
      { 'PRECINCT CODE': '888', 'PRECINCT NAME': 'Not In Race', 'REGISTERED VOTERS TOTAL': '5000', 'BALLOTS CAST TOTAL': '3000', 'For': '0', 'Against': '0' }
    ];
    const result = prepareTurnoutData(dataWithNonParticipating);
    expect(result).toHaveLength(3);
    expect(result.find(d => d.precinctCode === '888')).toBeUndefined();
  });

  it('should return empty array for empty input', () => {
    expect(prepareTurnoutData([])).toEqual([]);
  });

  it('should return empty array for null/undefined input', () => {
    expect(prepareTurnoutData(null)).toEqual([]);
    expect(prepareTurnoutData(undefined)).toEqual([]);
  });

  it('should return empty array for non-array input', () => {
    expect(prepareTurnoutData('string')).toEqual([]);
    expect(prepareTurnoutData({})).toEqual([]);
  });

  it('should handle missing PRECINCT NAME gracefully', () => {
    const dataNoName = [
      { 'PRECINCT CODE': '101', 'REGISTERED VOTERS TOTAL': '1000', 'BALLOTS CAST TOTAL': '500', 'For': '300', 'Against': '150' }
    ];
    const result = prepareTurnoutData(dataNoName);
    expect(result[0].precinctName).toBe('Precinct 101');
  });

  it('should include turnout color for each precinct', () => {
    const result = prepareTurnoutData(mockElectionData);
    result.forEach(d => {
      expect(d.turnoutColor).toBeDefined();
      expect(d.turnoutColor).not.toBe('#f5f5f5');
    });
  });
});

// ============================================================================
// TESTS FOR getTopPrecincts and getBottomPrecincts
// ============================================================================

describe('getTopPrecincts', () => {
  const mockTurnoutData = [
    { precinctCode: '1', turnoutPct: 90, rank: 1 },
    { precinctCode: '2', turnoutPct: 80, rank: 2 },
    { precinctCode: '3', turnoutPct: 70, rank: 3 },
    { precinctCode: '4', turnoutPct: 60, rank: 4 },
    { precinctCode: '5', turnoutPct: 50, rank: 5 },
  ];

  it('should return top N precincts', () => {
    const result = getTopPrecincts(mockTurnoutData, 3);
    expect(result).toHaveLength(3);
    expect(result[0].turnoutPct).toBe(90);
    expect(result[1].turnoutPct).toBe(80);
    expect(result[2].turnoutPct).toBe(70);
  });

  it('should return all precincts if N exceeds array length', () => {
    const result = getTopPrecincts(mockTurnoutData, 10);
    expect(result).toHaveLength(5);
  });

  it('should default to 10 if N not specified', () => {
    const result = getTopPrecincts(mockTurnoutData);
    expect(result).toHaveLength(5); // Only 5 in mock data
  });

  it('should return empty array for non-array input', () => {
    expect(getTopPrecincts(null, 3)).toEqual([]);
    expect(getTopPrecincts(undefined, 3)).toEqual([]);
  });
});

describe('getBottomPrecincts', () => {
  const mockTurnoutData = [
    { precinctCode: '1', turnoutPct: 90, rank: 1 },
    { precinctCode: '2', turnoutPct: 80, rank: 2 },
    { precinctCode: '3', turnoutPct: 70, rank: 3 },
    { precinctCode: '4', turnoutPct: 60, rank: 4 },
    { precinctCode: '5', turnoutPct: 50, rank: 5 },
  ];

  it('should return bottom N precincts in ascending order', () => {
    const result = getBottomPrecincts(mockTurnoutData, 3);
    expect(result).toHaveLength(3);
    expect(result[0].turnoutPct).toBe(50); // Lowest first
    expect(result[1].turnoutPct).toBe(60);
    expect(result[2].turnoutPct).toBe(70);
  });

  it('should return all precincts if N exceeds array length', () => {
    const result = getBottomPrecincts(mockTurnoutData, 10);
    expect(result).toHaveLength(5);
  });

  it('should default to 10 if N not specified', () => {
    const result = getBottomPrecincts(mockTurnoutData);
    expect(result).toHaveLength(5);
  });

  it('should return empty array for non-array input', () => {
    expect(getBottomPrecincts(null, 3)).toEqual([]);
    expect(getBottomPrecincts(undefined, 3)).toEqual([]);
  });
});

// ============================================================================
// TESTS FOR calculateCountySummary
// ============================================================================

describe('calculateCountySummary', () => {
  const mockElectionData = [
    { 'PRECINCT CODE': '101', 'REGISTERED VOTERS TOTAL': '1000', 'BALLOTS CAST TOTAL': '750', 'For': '500', 'Against': '200' },
    { 'PRECINCT CODE': '102', 'REGISTERED VOTERS TOTAL': '2000', 'BALLOTS CAST TOTAL': '1000', 'For': '700', 'Against': '250' },
    { 'PRECINCT CODE': '103', 'REGISTERED VOTERS TOTAL': '1500', 'BALLOTS CAST TOTAL': '1200', 'For': '900', 'Against': '250' },
  ];

  it('should calculate total registered voters', () => {
    const result = calculateCountySummary(mockElectionData);
    expect(result.totalRegistered).toBe(4500);
  });

  it('should calculate total ballots cast', () => {
    const result = calculateCountySummary(mockElectionData);
    expect(result.totalBallotsCast).toBe(2950);
  });

  it('should calculate overall turnout', () => {
    const result = calculateCountySummary(mockElectionData);
    // 2950 / 4500 = 65.56%
    expect(result.overallTurnout).toBeCloseTo(65.6, 0);
  });

  it('should count participating precincts', () => {
    const result = calculateCountySummary(mockElectionData);
    expect(result.participatingPrecincts).toBe(3);
  });

  it('should exclude precincts with zero registered voters from count', () => {
    const dataWithEmpty = [
      ...mockElectionData,
      { 'PRECINCT CODE': '999', 'REGISTERED VOTERS TOTAL': '0', 'BALLOTS CAST TOTAL': '0', 'For': '0', 'Against': '0' }
    ];
    const result = calculateCountySummary(dataWithEmpty);
    expect(result.participatingPrecincts).toBe(3);
    // precinctCount now only counts precincts that participated in the race
    expect(result.precinctCount).toBe(3);
  });

  it('should exclude precincts that did not participate in the race', () => {
    const dataWithNonParticipating = [
      ...mockElectionData,
      // This precinct has voters but zero race-specific votes (didn't participate in this race)
      { 'PRECINCT CODE': '888', 'REGISTERED VOTERS TOTAL': '5000', 'BALLOTS CAST TOTAL': '3000', 'For': '0', 'Against': '0' }
    ];
    const result = calculateCountySummary(dataWithNonParticipating);
    // Should only count precincts that actually voted in the race
    expect(result.totalRegistered).toBe(4500); // Only from participating precincts
    expect(result.participatingPrecincts).toBe(3);
    expect(result.precinctCount).toBe(3);
  });

  it('should calculate average turnout', () => {
    const result = calculateCountySummary(mockElectionData);
    // (75 + 50 + 80) / 3 = 68.33%
    expect(result.avgTurnout).toBeCloseTo(68.3, 0);
  });

  it('should find min turnout', () => {
    const result = calculateCountySummary(mockElectionData);
    expect(result.minTurnout).toBe(50); // 1000/2000
  });

  it('should find max turnout', () => {
    const result = calculateCountySummary(mockElectionData);
    expect(result.maxTurnout).toBe(80); // 1200/1500
  });

  it('should return zeros for empty input', () => {
    const result = calculateCountySummary([]);
    expect(result.totalRegistered).toBe(0);
    expect(result.totalBallotsCast).toBe(0);
    expect(result.overallTurnout).toBe(0);
    expect(result.participatingPrecincts).toBe(0);
  });

  it('should return zeros for null/undefined input', () => {
    const resultNull = calculateCountySummary(null);
    const resultUndefined = calculateCountySummary(undefined);
    
    expect(resultNull.totalRegistered).toBe(0);
    expect(resultUndefined.totalRegistered).toBe(0);
  });
});

// ============================================================================
// TESTS FOR formatTurnoutPct
// ============================================================================

describe('formatTurnoutPct', () => {
  it('should format percentage with one decimal place', () => {
    expect(formatTurnoutPct(75)).toBe('75.0%');
    expect(formatTurnoutPct(75.5)).toBe('75.5%');
    expect(formatTurnoutPct(75.56)).toBe('75.6%'); // rounds
  });

  it('should handle 0%', () => {
    expect(formatTurnoutPct(0)).toBe('0.0%');
  });

  it('should handle 100%', () => {
    expect(formatTurnoutPct(100)).toBe('100.0%');
  });

  it('should return N/A for null', () => {
    expect(formatTurnoutPct(null)).toBe('N/A');
  });

  it('should return N/A for undefined', () => {
    expect(formatTurnoutPct(undefined)).toBe('N/A');
  });

  it('should return N/A for NaN', () => {
    expect(formatTurnoutPct(NaN)).toBe('N/A');
  });
});

// ============================================================================
// INTEGRATION TEST - Full data flow
// ============================================================================

describe('Integration: Full turnout data flow', () => {
  const realWorldData = [
    { 'PRECINCT CODE': '1', 'PRECINCT NAME': 'PCT 001', 'REGISTERED VOTERS TOTAL': '2782', 'BALLOTS CAST TOTAL': '1926', 'Rep John Smith': '1000', 'Dem Jane Doe': '900' },
    { 'PRECINCT CODE': '10', 'PRECINCT NAME': 'PCT 010', 'REGISTERED VOTERS TOTAL': '868', 'BALLOTS CAST TOTAL': '625', 'Rep John Smith': '350', 'Dem Jane Doe': '250' },
    { 'PRECINCT CODE': '100', 'PRECINCT NAME': 'PCT 100', 'REGISTERED VOTERS TOTAL': '25', 'BALLOTS CAST TOTAL': '8', 'Rep John Smith': '5', 'Dem Jane Doe': '3' },
    { 'PRECINCT CODE': '101', 'PRECINCT NAME': 'PCT 101', 'REGISTERED VOTERS TOTAL': '4300', 'BALLOTS CAST TOTAL': '2865', 'Rep John Smith': '1500', 'Dem Jane Doe': '1300' },
    { 'PRECINCT CODE': '102', 'PRECINCT NAME': 'PCT 102', 'REGISTERED VOTERS TOTAL': '2555', 'BALLOTS CAST TOTAL': '1957', 'Rep John Smith': '1000', 'Dem Jane Doe': '900' },
  ];

  it('should process real-world election data correctly', () => {
    const turnoutData = prepareTurnoutData(realWorldData);
    const summary = calculateCountySummary(realWorldData);
    const top3 = getTopPrecincts(turnoutData, 3);
    const bottom3 = getBottomPrecincts(turnoutData, 3);

    // Verify data was processed
    expect(turnoutData).toHaveLength(5);
    expect(summary.totalRegistered).toBe(10530);
    expect(summary.totalBallotsCast).toBe(7381);
    
    // Verify sorting - top should have highest turnout
    expect(top3[0].turnoutPct).toBeGreaterThan(top3[1].turnoutPct);
    expect(top3[1].turnoutPct).toBeGreaterThan(top3[2].turnoutPct);
    
    // Verify bottom is in ascending order
    expect(bottom3[0].turnoutPct).toBeLessThan(bottom3[1].turnoutPct);
  });

  it('should handle precincts with very low turnout', () => {
    const dataWithLowTurnout = [
      { 'PRECINCT CODE': '999', 'PRECINCT NAME': 'Low Turnout', 'REGISTERED VOTERS TOTAL': '5000', 'BALLOTS CAST TOTAL': '50', 'For': '30', 'Against': '15' }
    ];
    const result = prepareTurnoutData(dataWithLowTurnout);
    expect(result[0].turnoutPct).toBe(1); // 50/5000 * 100 = 1%
    // Should still get a valid color
    expect(result[0].turnoutColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('should handle precincts with very high turnout', () => {
    const dataWithHighTurnout = [
      { 'PRECINCT CODE': '888', 'PRECINCT NAME': 'High Turnout', 'REGISTERED VOTERS TOTAL': '100', 'BALLOTS CAST TOTAL': '98', 'For': '70', 'Against': '25' }
    ];
    const result = prepareTurnoutData(dataWithHighTurnout);
    expect(result[0].turnoutPct).toBe(98); // 98/100 * 100 = 98%
    // Should get greenish color
    expect(result[0].turnoutColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('should correctly handle city election data where most precincts do not participate', () => {
    // Simulates Murphy Proposition A scenario
    const cityElectionData = [
      // Murphy precincts (have votes)
      { 'PRECINCT CODE': '25', 'PRECINCT NAME': 'PCT 025', 'REGISTERED VOTERS TOTAL': '3943', 'BALLOTS CAST TOTAL': '2150', 'For': '1798', 'Against': '191' },
      { 'PRECINCT CODE': '144', 'PRECINCT NAME': 'PCT 144', 'REGISTERED VOTERS TOTAL': '2874', 'BALLOTS CAST TOTAL': '1594', 'For': '1272', 'Against': '146' },
      // Non-Murphy precincts (zero votes for this race)
      { 'PRECINCT CODE': '1', 'PRECINCT NAME': 'PCT 001', 'REGISTERED VOTERS TOTAL': '2737', 'BALLOTS CAST TOTAL': '1491', 'For': '0', 'Against': '0' },
      { 'PRECINCT CODE': '2', 'PRECINCT NAME': 'PCT 002', 'REGISTERED VOTERS TOTAL': '4654', 'BALLOTS CAST TOTAL': '2084', 'For': '0', 'Against': '0' },
    ];
    
    const turnoutData = prepareTurnoutData(cityElectionData);
    const summary = calculateCountySummary(cityElectionData);
    
    // Should only include the 2 Murphy precincts
    expect(turnoutData).toHaveLength(2);
    expect(summary.precinctCount).toBe(2);
    expect(summary.participatingPrecincts).toBe(2);
    
    // Total should only be from Murphy precincts
    expect(summary.totalRegistered).toBe(3943 + 2874);
    expect(summary.totalBallotsCast).toBe(2150 + 1594);
  });
});
