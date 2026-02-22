// turnoutSimulator.test.js
// Unit tests for turnout simulation functions
// TDD approach: Write tests first, then implement to make them pass

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Import actual implementations from turnoutSimulator.js
import {
  calculateAdjustedVotes,
  determineWinner,
  extractParty,
  simulatePrecinctOutcome,
  detectFlippedPrecincts,
  calculateCountySummary,
  createSliderState,
  createVoterFlipState,
  runFullSimulation,
  generateSimulatorControlsHTML,
  generateSimulationResultsHTML,
  // New enhanced functions
  estimatePartyVotersInPrecinct,
  calculateNonVotersByParty,
  simulatePrecinctWithExtendedTurnout,
  simulatePrecinctWithTargetTurnout,
  applyVoterFlip,
  simulatePrecinctCombined
} from './turnoutSimulator.js';


// ============================================================================
// TESTS FOR calculateAdjustedVotes
// ============================================================================

describe('calculateAdjustedVotes', () => {
  it('should return full votes when turnout multiplier is 1.0', () => {
    // 1000 registered, 70% vote share, 100% turnout
    const result = calculateAdjustedVotes(1000, 0.7, 1.0);
    expect(result).toBe(700);
  });

  it('should reduce votes when turnout multiplier is below 1.0', () => {
    // 1000 registered, 70% vote share, 50% turnout
    const result = calculateAdjustedVotes(1000, 0.7, 0.5);
    expect(result).toBe(350);
  });

  it('should handle intermediate turnout multipliers', () => {
    // 1000 registered, 70% vote share, 80% turnout
    const result = calculateAdjustedVotes(1000, 0.7, 0.8);
    expect(result).toBe(560);
  });

  it('should round to nearest integer', () => {
    // 999 registered, 33.3% vote share, 75% turnout = 999 * 0.333 * 0.75 = 249.5
    const result = calculateAdjustedVotes(999, 0.333, 0.75);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('should clamp turnout multiplier to minimum 0.5', () => {
    // Should treat 0.3 as 0.5
    const resultLow = calculateAdjustedVotes(1000, 0.7, 0.3);
    const resultMin = calculateAdjustedVotes(1000, 0.7, 0.5);
    expect(resultLow).toBe(resultMin);
  });

  it('should clamp turnout multiplier to maximum 1.0', () => {
    // Should treat 1.5 as 1.0
    const resultHigh = calculateAdjustedVotes(1000, 0.7, 1.5);
    const resultMax = calculateAdjustedVotes(1000, 0.7, 1.0);
    expect(resultHigh).toBe(resultMax);
  });

  it('should return 0 for null registration', () => {
    expect(calculateAdjustedVotes(null, 0.7, 1.0)).toBe(0);
  });

  it('should return 0 for negative registration', () => {
    expect(calculateAdjustedVotes(-100, 0.7, 1.0)).toBe(0);
  });

  it('should return 0 for NaN vote share', () => {
    expect(calculateAdjustedVotes(1000, NaN, 1.0)).toBe(0);
  });

  it('should default to 1.0 multiplier when null', () => {
    const resultNull = calculateAdjustedVotes(1000, 0.7, null);
    const resultDefault = calculateAdjustedVotes(1000, 0.7, 1.0);
    expect(resultNull).toBe(resultDefault);
  });

  it('should handle zero registration', () => {
    expect(calculateAdjustedVotes(0, 0.7, 1.0)).toBe(0);
  });

  it('should handle zero vote share', () => {
    expect(calculateAdjustedVotes(1000, 0, 1.0)).toBe(0);
  });
});


// ============================================================================
// TESTS FOR determineWinner
// ============================================================================

describe('determineWinner', () => {
  it('should return the candidate with most votes', () => {
    const votes = {
      'Rep John Smith': 500,
      'Dem Jane Doe': 450,
      'Mod Bob Wilson': 50
    };
    const result = determineWinner(votes);
    expect(result.name).toBe('Rep John Smith');
    expect(result.votes).toBe(500);
    expect(result.party).toBe('Rep');
  });

  it('should extract party from candidate name', () => {
    const votes = { 'Dem Candidate': 100 };
    const result = determineWinner(votes);
    expect(result.party).toBe('Dem');
  });

  it('should handle single candidate', () => {
    const votes = { 'Rep Only': 1000 };
    const result = determineWinner(votes);
    expect(result.name).toBe('Rep Only');
    expect(result.votes).toBe(1000);
  });

  it('should handle empty object', () => {
    const result = determineWinner({});
    expect(result.name).toBeNull();
    expect(result.votes).toBe(0);
  });

  it('should handle null input', () => {
    const result = determineWinner(null);
    expect(result.name).toBeNull();
    expect(result.party).toBeNull();
  });

  it('should handle undefined input', () => {
    const result = determineWinner(undefined);
    expect(result.name).toBeNull();
  });

  it('should handle string vote counts from CSV', () => {
    const votes = {
      'Rep A': '600',
      'Dem B': '400'
    };
    const result = determineWinner(votes);
    expect(result.name).toBe('Rep A');
    expect(result.votes).toBe(600);
  });

  it('should handle ties by returning first encountered', () => {
    // Note: In a tie, behavior depends on iteration order
    const votes = { 'Rep A': 500, 'Dem B': 500 };
    const result = determineWinner(votes);
    expect(result.votes).toBe(500);
    // Winner will be one of them
    expect(['Rep A', 'Dem B']).toContain(result.name);
  });

  it('should handle all zero votes', () => {
    const votes = { 'Rep A': 0, 'Dem B': 0 };
    const result = determineWinner(votes);
    expect(result.name).toBeNull();
    expect(result.votes).toBe(0);
  });
});


// ============================================================================
// TESTS FOR extractParty
// ============================================================================

describe('extractParty', () => {
  it('should extract Rep party', () => {
    expect(extractParty('Rep John Smith')).toBe('Rep');
  });

  it('should extract Dem party', () => {
    expect(extractParty('Dem Jane Doe')).toBe('Dem');
  });

  it('should extract Mod party', () => {
    expect(extractParty('Mod Bob Wilson')).toBe('Mod');
  });

  it('should extract For (proposition)', () => {
    expect(extractParty('For')).toBe('For');
  });

  it('should extract Against (proposition)', () => {
    expect(extractParty('Against')).toBe('Against');
  });

  it('should return null for unknown party', () => {
    expect(extractParty('Unknown Candidate')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractParty('')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(extractParty(null)).toBeNull();
  });

  it('should handle whitespace', () => {
    expect(extractParty('  Rep John  ')).toBe('Rep');
  });

  // Tests for uppercase party codes (from real election data)
  it('should extract uppercase REP party', () => {
    expect(extractParty('REP Greg Abbott')).toBe('REP');
  });

  it('should extract uppercase DEM party', () => {
    expect(extractParty('DEM Beto ORourke')).toBe('DEM');
  });

  it('should extract uppercase LIB party', () => {
    expect(extractParty('LIB Mark Tippetts')).toBe('LIB');
  });

  it('should extract uppercase GRN party', () => {
    expect(extractParty('GRN Delilah Barrios')).toBe('GRN');
  });
});


// ============================================================================
// TESTS FOR simulatePrecinctOutcome
// ============================================================================

describe('simulatePrecinctOutcome', () => {
  const mockElectionData = {
    'PRECINCT CODE': '42',
    'Rep Alice': '600',
    'Dem Bob': '400',
    'REGISTERED VOTERS TOTAL': '1500',
    'BALLOTS CAST TOTAL': '1000'
  };

  const mockDncData = {
    Precinct: '42',
    Rep: '800',
    Dem: '500',
    Mod: '200',
    Total: '1500'
  };

  const candidates = ['Rep Alice', 'Dem Bob'];

  it('should return original winner when all multipliers are 1.0', () => {
    const multipliers = { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
    const result = simulatePrecinctOutcome(mockElectionData, mockDncData, multipliers, candidates);
    
    expect(result.winner.name).toBe('Rep Alice');
    expect(result.flipped).toBe(false);
  });

  it('should flip winner when opposing party turnout increases dramatically', () => {
    // Rep turnout cut to 50%, Dem stays at 100%
    const multipliers = { Rep: 0.5, Dem: 1.0, Mod: 1.0 };
    const result = simulatePrecinctOutcome(mockElectionData, mockDncData, multipliers, candidates);
    
    // Rep: 600 * 0.5 = 300, Dem: 400 * 1.0 = 400
    expect(result.adjustedVotes['Rep Alice']).toBe(300);
    expect(result.adjustedVotes['Dem Bob']).toBe(400);
    expect(result.winner.name).toBe('Dem Bob');
    expect(result.flipped).toBe(true);
  });

  it('should track original winner correctly', () => {
    const multipliers = { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
    const result = simulatePrecinctOutcome(mockElectionData, mockDncData, multipliers, candidates);
    
    expect(result.originalWinner.name).toBe('Rep Alice');
    expect(result.originalWinner.votes).toBe(600);
  });

  it('should handle null election data', () => {
    const result = simulatePrecinctOutcome(null, mockDncData, { Rep: 1, Dem: 1, Mod: 1 }, candidates);
    expect(result.winner).toBeNull();
    expect(result.flipped).toBe(false);
  });

  it('should handle null DNC data', () => {
    const result = simulatePrecinctOutcome(mockElectionData, null, { Rep: 1, Dem: 1, Mod: 1 }, candidates);
    expect(result.winner).toBeNull();
  });

  it('should handle empty candidates array', () => {
    const result = simulatePrecinctOutcome(mockElectionData, mockDncData, { Rep: 1, Dem: 1, Mod: 1 }, []);
    expect(result.winner).toBeNull();
  });

  it('should handle missing turnout multipliers with defaults', () => {
    const multipliers = {}; // No multipliers specified
    const result = simulatePrecinctOutcome(mockElectionData, mockDncData, multipliers, candidates);
    
    // Should default to 1.0, so no change
    expect(result.winner.name).toBe('Rep Alice');
    expect(result.flipped).toBe(false);
  });

  it('should handle three-way race', () => {
    const threeWayElection = {
      'PRECINCT CODE': '42',
      'Rep A': '400',
      'Dem B': '350',
      'Mod C': '250'
    };
    const candidates3 = ['Rep A', 'Dem B', 'Mod C'];
    const multipliers = { Rep: 0.5, Dem: 1.0, Mod: 1.0 };
    
    const result = simulatePrecinctOutcome(threeWayElection, mockDncData, multipliers, candidates3);
    
    // Rep: 400 * 0.5 = 200, Dem: 350, Mod: 250
    expect(result.adjustedVotes['Rep A']).toBe(200);
    expect(result.winner.name).toBe('Dem B');
    expect(result.flipped).toBe(true);
  });

  it('should handle proposition (For/Against) races', () => {
    const propElection = {
      'PRECINCT CODE': '42',
      'For': '600',
      'Against': '400'
    };
    const propCandidates = ['For', 'Against'];
    const multipliers = { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
    
    const result = simulatePrecinctOutcome(propElection, mockDncData, multipliers, propCandidates);
    
    expect(result.winner.name).toBe('For');
    expect(result.winner.party).toBe('For');
  });

  it('should handle uppercase party codes (real election data format)', () => {
    const realElection = {
      'PRECINCT CODE': '42',
      'REP Greg Abbott': '600',
      'DEM Beto ORourke': '400',
      'LIB Mark Tippetts': '50',
      'GRN Delilah Barrios': '10'
    };
    const realCandidates = ['REP Greg Abbott', 'DEM Beto ORourke', 'LIB Mark Tippetts', 'GRN Delilah Barrios'];
    const multipliers = { Rep: 0.5, Dem: 1.0, Mod: 1.0 };
    
    const result = simulatePrecinctOutcome(realElection, mockDncData, multipliers, realCandidates);
    
    // REP: 600 * 0.5 = 300, DEM: 400, LIB: 50 (uses Mod=1.0), GRN: 10 (uses Mod=1.0)
    expect(result.adjustedVotes['REP Greg Abbott']).toBe(300);
    expect(result.adjustedVotes['DEM Beto ORourke']).toBe(400);
    expect(result.winner.name).toBe('DEM Beto ORourke');
    expect(result.flipped).toBe(true);
  });
});


// ============================================================================
// TESTS FOR detectFlippedPrecincts
// ============================================================================

describe('detectFlippedPrecincts', () => {
  it('should detect precincts where winner changed', () => {
    const original = { '1': 'Rep', '2': 'Dem', '3': 'Rep' };
    const simulated = { '1': 'Dem', '2': 'Dem', '3': 'Rep' };
    
    const flipped = detectFlippedPrecincts(original, simulated);
    
    expect(flipped).toContain('1');
    expect(flipped).not.toContain('2');
    expect(flipped).not.toContain('3');
    expect(flipped).toHaveLength(1);
  });

  it('should return empty array when no precincts flipped', () => {
    const original = { '1': 'Rep', '2': 'Dem' };
    const simulated = { '1': 'Rep', '2': 'Dem' };
    
    const flipped = detectFlippedPrecincts(original, simulated);
    
    expect(flipped).toHaveLength(0);
  });

  it('should handle all precincts flipping', () => {
    const original = { '1': 'Rep', '2': 'Dem', '3': 'Mod' };
    const simulated = { '1': 'Dem', '2': 'Rep', '3': 'Rep' };
    
    const flipped = detectFlippedPrecincts(original, simulated);
    
    expect(flipped).toHaveLength(3);
  });

  it('should handle null original results', () => {
    const flipped = detectFlippedPrecincts(null, { '1': 'Rep' });
    expect(flipped).toEqual([]);
  });

  it('should handle null simulated results', () => {
    const flipped = detectFlippedPrecincts({ '1': 'Rep' }, null);
    expect(flipped).toEqual([]);
  });

  it('should ignore precincts with null winners', () => {
    const original = { '1': null, '2': 'Rep' };
    const simulated = { '1': 'Dem', '2': 'Dem' };
    
    const flipped = detectFlippedPrecincts(original, simulated);
    
    // Precinct 1 shouldn't count as flipped (original was null)
    expect(flipped).toContain('2');
    expect(flipped).not.toContain('1');
  });

  it('should handle missing precincts in simulated results', () => {
    const original = { '1': 'Rep', '2': 'Dem' };
    const simulated = { '1': 'Dem' }; // Missing '2'
    
    const flipped = detectFlippedPrecincts(original, simulated);
    
    expect(flipped).toContain('1');
    expect(flipped).toHaveLength(1);
  });
});


// ============================================================================
// TESTS FOR calculateCountySummary
// ============================================================================

describe('calculateCountySummary', () => {
  it('should sum votes across all precincts', () => {
    const precinctResults = {
      '1': { 'Rep A': 100, 'Dem B': 50 },
      '2': { 'Rep A': 200, 'Dem B': 150 },
      '3': { 'Rep A': 50, 'Dem B': 100 }
    };
    const candidates = ['Rep A', 'Dem B'];
    
    const result = calculateCountySummary(precinctResults, candidates);
    
    expect(result.candidateTotals['Rep A']).toBe(350);
    expect(result.candidateTotals['Dem B']).toBe(300);
    expect(result.totalVotes).toBe(650);
  });

  it('should determine county-wide winner', () => {
    const precinctResults = {
      '1': { 'Rep A': 1000, 'Dem B': 500 },
      '2': { 'Rep A': 100, 'Dem B': 200 }
    };
    const candidates = ['Rep A', 'Dem B'];
    
    const result = calculateCountySummary(precinctResults, candidates);
    
    expect(result.winner.name).toBe('Rep A');
    expect(result.winner.votes).toBe(1100);
  });

  it('should calculate vote percentages', () => {
    const precinctResults = {
      '1': { 'Rep A': 600, 'Dem B': 400 }
    };
    const candidates = ['Rep A', 'Dem B'];
    
    const result = calculateCountySummary(precinctResults, candidates);
    
    expect(result.candidatePercentages['Rep A']).toBe(0.6);
    expect(result.candidatePercentages['Dem B']).toBe(0.4);
  });

  it('should handle empty precincts', () => {
    const result = calculateCountySummary({}, ['Rep A', 'Dem B']);
    
    expect(result.totalVotes).toBe(0);
    expect(result.winner.name).toBeNull();
  });

  it('should handle null input', () => {
    const result = calculateCountySummary(null, ['Rep A']);
    
    expect(result.totalVotes).toBe(0);
  });

  it('should handle missing candidates in some precincts', () => {
    const precinctResults = {
      '1': { 'Rep A': 100 }, // Missing Dem B
      '2': { 'Rep A': 50, 'Dem B': 75 }
    };
    const candidates = ['Rep A', 'Dem B'];
    
    const result = calculateCountySummary(precinctResults, candidates);
    
    expect(result.candidateTotals['Rep A']).toBe(150);
    expect(result.candidateTotals['Dem B']).toBe(75);
  });
});


// ============================================================================
// TESTS FOR UI STATE MANAGEMENT
// ============================================================================

describe('Turnout Slider State', () => {
  // Using createSliderState imported from turnoutSimulator.js

  it('should initialize with default values of 1.0', () => {
    const state = createSliderState();
    
    expect(state.getValue('Rep')).toBe(1.0);
    expect(state.getValue('Dem')).toBe(1.0);
    expect(state.getValue('Mod')).toBe(1.0);
  });

  it('should update value when set', () => {
    const state = createSliderState();
    
    state.setValue('Rep', 0.8);
    
    expect(state.getValue('Rep')).toBe(0.8);
  });

  it('should clamp values below 0.5', () => {
    const state = createSliderState();
    
    state.setValue('Rep', 0.3);
    
    expect(state.getValue('Rep')).toBe(0.5);
  });

  it('should clamp values above max (1.5 with extended range)', () => {
    // Default createSliderState now supports extended range to 1.5
    const state = createSliderState();
    
    state.setValue('Dem', 1.5);
    expect(state.getValue('Dem')).toBe(1.5);
    
    // Values above 1.5 should be clamped
    state.setValue('Dem', 2.0);
    expect(state.getValue('Dem')).toBe(1.5);
  });

  it('should notify listeners on change', () => {
    const state = createSliderState();
    const callback = jest.fn();
    
    state.onChange(callback);
    state.setValue('Rep', 0.7);
    
    expect(callback).toHaveBeenCalledWith('Rep', 0.7);
  });

  it('should return all values', () => {
    const state = createSliderState({ Rep: 0.8, Dem: 0.9, Mod: 0.7 });
    
    expect(state.getAll()).toEqual({ Rep: 0.8, Dem: 0.9, Mod: 0.7 });
  });

  it('should reset all values to 1.0', () => {
    const state = createSliderState();
    state.setValue('Rep', 0.5);
    state.setValue('Dem', 0.6);
    
    state.reset();
    
    expect(state.getValue('Rep')).toBe(1.0);
    expect(state.getValue('Dem')).toBe(1.0);
    expect(state.getValue('Mod')).toBe(1.0);
  });

  it('should handle unknown party with default', () => {
    const state = createSliderState();
    
    expect(state.getValue('Unknown')).toBe(1.0);
  });
});


// ============================================================================
// TESTS FOR runFullSimulation
// ============================================================================

describe('runFullSimulation', () => {
  const mockElectionData = [
    { 'PRECINCT CODE': '1', 'Rep A': '500', 'Dem B': '300' },
    { 'PRECINCT CODE': '2', 'Rep A': '400', 'Dem B': '450' },
    { 'PRECINCT CODE': '3', 'Rep A': '600', 'Dem B': '200' }
  ];

  const mockDncData = {
    '1': { Rep: 600, Dem: 400, Mod: 100 },
    '2': { Rep: 450, Dem: 500, Mod: 50 },
    '3': { Rep: 700, Dem: 300, Mod: 100 }
  };

  const candidates = ['Rep A', 'Dem B'];

  it('should return complete simulation results', () => {
    const result = runFullSimulation(
      mockElectionData,
      mockDncData,
      candidates,
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
    );

    expect(result).toHaveProperty('precinctResults');
    expect(result).toHaveProperty('originalWinners');
    expect(result).toHaveProperty('simulatedWinners');
    expect(result).toHaveProperty('flippedPrecincts');
    expect(result).toHaveProperty('originalSummary');
    expect(result).toHaveProperty('simulatedSummary');
    expect(result).toHaveProperty('countyFlipped');
  });

  it('should calculate correct original winners per precinct', () => {
    const result = runFullSimulation(
      mockElectionData,
      mockDncData,
      candidates,
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
    );

    expect(result.originalWinners['1']).toBe('Rep A');
    expect(result.originalWinners['2']).toBe('Dem B');
    expect(result.originalWinners['3']).toBe('Rep A');
  });

  it('should detect flipped precincts when turnout changes', () => {
    const result = runFullSimulation(
      mockElectionData,
      mockDncData,
      candidates,
      { Rep: 0.5, Dem: 1.0, Mod: 1.0 }
    );

    // Precinct 1: Rep 500*0.5=250 < Dem 300 -> flips
    // Precinct 2: Rep 400*0.5=200 < Dem 450 -> already Dem
    // Precinct 3: Rep 600*0.5=300 > Dem 200 -> stays Rep
    expect(result.flippedPrecincts).toContain('1');
    expect(result.flippedPrecincts).not.toContain('2');
    expect(result.flippedPrecincts).not.toContain('3');
  });

  it('should detect county-wide flip', () => {
    // Original: Rep 1500, Dem 950 -> Rep wins
    // With Rep @ 50%: Rep 750, Dem 950 -> Dem wins
    const result = runFullSimulation(
      mockElectionData,
      mockDncData,
      candidates,
      { Rep: 0.5, Dem: 1.0, Mod: 1.0 }
    );

    expect(result.countyFlipped).toBe(true);
    expect(result.simulatedSummary.winner.name).toBe('Dem B');
  });

  it('should handle null election data', () => {
    const result = runFullSimulation(null, mockDncData, candidates, { Rep: 1, Dem: 1, Mod: 1 });

    expect(result.precinctResults).toEqual({});
    expect(result.flippedPrecincts).toEqual([]);
  });

  it('should handle missing precinct in DNC data', () => {
    const partialDnc = { '1': { Rep: 600, Dem: 400, Mod: 100 } }; // Missing 2 and 3
    const result = runFullSimulation(
      mockElectionData,
      partialDnc,
      candidates,
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 }
    );

    // Only precinct 1 should be processed
    expect(Object.keys(result.precinctResults)).toHaveLength(1);
    expect(result.precinctResults['1']).toBeDefined();
  });
});


// ============================================================================
// TESTS FOR generateSimulatorControlsHTML
// ============================================================================

describe('generateSimulatorControlsHTML', () => {
  it('should generate HTML with slider elements', () => {
    const html = generateSimulatorControlsHTML({ Rep: 1.0, Dem: 1.0, Mod: 1.0 });

    expect(html).toContain('id="rep-turnout"');
    expect(html).toContain('id="dem-turnout"');
    expect(html).toContain('id="mod-turnout"');
  });

  it('should include reset button', () => {
    const html = generateSimulatorControlsHTML();

    expect(html).toContain('id="reset-turnout"');
    expect(html).toContain('Reset All');
  });

  it('should display current values as percentages', () => {
    const html = generateSimulatorControlsHTML({ Rep: 0.75, Dem: 0.8, Mod: 0.9 });

    expect(html).toContain('75%');
    expect(html).toContain('80%');
    expect(html).toContain('90%');
  });

  it('should set slider values correctly', () => {
    const html = generateSimulatorControlsHTML({ Rep: 0.6, Dem: 0.7, Mod: 0.8 });

    expect(html).toContain('value="60"');
    expect(html).toContain('value="70"');
    expect(html).toContain('value="80"');
  });

  it('should include party-specific CSS classes', () => {
    const html = generateSimulatorControlsHTML();

    expect(html).toContain('class="party-label rep"');
    expect(html).toContain('class="party-label dem"');
    expect(html).toContain('class="party-label mod"');
  });

  it('should include data-party attributes for JS binding', () => {
    const html = generateSimulatorControlsHTML();

    expect(html).toContain('data-party="Rep"');
    expect(html).toContain('data-party="Dem"');
    expect(html).toContain('data-party="Mod"');
  });
});


// ============================================================================
// TESTS FOR generateSimulationResultsHTML
// ============================================================================

describe('generateSimulationResultsHTML', () => {
  const mockOriginalSummary = {
    totalVotes: 1000,
    candidateTotals: { 'Rep A': 600, 'Dem B': 400 },
    candidatePercentages: { 'Rep A': 0.6, 'Dem B': 0.4 },
    winner: { name: 'Rep A', votes: 600, party: 'Rep' }
  };

  const mockSimulatedSummary = {
    totalVotes: 800,
    candidateTotals: { 'Rep A': 300, 'Dem B': 500 },
    candidatePercentages: { 'Rep A': 0.375, 'Dem B': 0.625 },
    winner: { name: 'Dem B', votes: 500, party: 'Dem' }
  };

  it('should display vote comparison table', () => {
    const html = generateSimulationResultsHTML(
      mockOriginalSummary,
      mockSimulatedSummary,
      [],
      false
    );

    expect(html).toContain('Rep A');
    expect(html).toContain('Dem B');
    expect(html).toContain('comparison-table');
  });

  it('should show vote changes with correct sign', () => {
    const html = generateSimulationResultsHTML(
      mockOriginalSummary,
      mockSimulatedSummary,
      [],
      false
    );

    // Rep went from 600 to 300 = -300
    expect(html).toContain('-300');
    // Dem went from 400 to 500 = +100
    expect(html).toContain('+100');
  });

  it('should highlight county flip when it occurs', () => {
    const html = generateSimulationResultsHTML(
      mockOriginalSummary,
      mockSimulatedSummary,
      [],
      true // county flipped
    );

    expect(html).toContain('county-flipped');
    expect(html).toContain('County Winner Changed');
    expect(html).toContain('Rep A');
    expect(html).toContain('Dem B');
  });

  it('should show flipped precinct count', () => {
    const html = generateSimulationResultsHTML(
      mockOriginalSummary,
      mockSimulatedSummary,
      ['1', '5', '12'],
      false
    );

    expect(html).toContain('Flipped Precincts');
    expect(html).toContain('3'); // count
    expect(html).toContain('flipped-precinct-code');
    expect(html).toContain('>1<');
    expect(html).toContain('>5<');
    expect(html).toContain('>12<');
  });

  it('should show message when no precincts flipped', () => {
    const html = generateSimulationResultsHTML(
      mockOriginalSummary,
      mockSimulatedSummary,
      [],
      false
    );

    expect(html).toContain('No precincts flipped');
  });

  it('should show toggle for long precinct lists and hide items beyond 5', () => {
    const manyPrecincts = Array.from({ length: 15 }, (_, i) => String(i + 1));
    const html = generateSimulationResultsHTML(
      mockOriginalSummary,
      mockSimulatedSummary,
      manyPrecincts,
      false
    );

    expect(html).toContain('Show all 15 precincts');
    expect(html).toContain('flipped-list-toggle');
    // First 5 should be visible (no hidden class)
    expect(html).toContain('data-flip-index="4"');
    // 6th item (index 5) should be hidden
    expect(html).toContain('flipped-list-item hidden" data-flip-index="5"');
  });

  it('should handle null summaries gracefully', () => {
    const html = generateSimulationResultsHTML(null, null, [], false);

    expect(html).toContain('Select an election');
  });
});


// ============================================================================
// INTEGRATION TEST: Full Simulation Flow
// ============================================================================

describe('Full Simulation Flow', () => {
  it('should correctly simulate a race with multiple precincts', () => {
    // Setup: 3 precincts, Rep leads overall
    const electionDataByPrecinct = {
      '1': { 'Rep A': '500', 'Dem B': '300' },
      '2': { 'Rep A': '400', 'Dem B': '450' },
      '3': { 'Rep A': '600', 'Dem B': '200' }
    };
    
    const dncDataByPrecinct = {
      '1': { Rep: 600, Dem: 400, Mod: 100 },
      '2': { Rep: 450, Dem: 500, Mod: 50 },
      '3': { Rep: 700, Dem: 300, Mod: 100 }
    };
    
    const candidates = ['Rep A', 'Dem B'];
    
    // Baseline: Rep wins with 1500 vs 950
    const baseMultipliers = { Rep: 1.0, Dem: 1.0, Mod: 1.0 };
    
    // Simulate each precinct
    const baseResults = {};
    Object.keys(electionDataByPrecinct).forEach(code => {
      const result = simulatePrecinctOutcome(
        electionDataByPrecinct[code],
        dncDataByPrecinct[code],
        baseMultipliers,
        candidates
      );
      baseResults[code] = result.adjustedVotes;
    });
    
    const baseSummary = calculateCountySummary(baseResults, candidates);
    expect(baseSummary.winner.name).toBe('Rep A');
    expect(baseSummary.candidateTotals['Rep A']).toBe(1500);
    expect(baseSummary.candidateTotals['Dem B']).toBe(950);
    
    // Scenario: Rep turnout drops to 60%
    const lowRepMultipliers = { Rep: 0.6, Dem: 1.0, Mod: 1.0 };
    
    const lowRepResults = {};
    Object.keys(electionDataByPrecinct).forEach(code => {
      const result = simulatePrecinctOutcome(
        electionDataByPrecinct[code],
        dncDataByPrecinct[code],
        lowRepMultipliers,
        candidates
      );
      lowRepResults[code] = result.adjustedVotes;
    });
    
    const lowRepSummary = calculateCountySummary(lowRepResults, candidates);
    
    // Rep: 1500 * 0.6 = 900, Dem: 950 (unchanged)
    expect(lowRepSummary.candidateTotals['Rep A']).toBe(900);
    expect(lowRepSummary.candidateTotals['Dem B']).toBe(950);
    expect(lowRepSummary.winner.name).toBe('Dem B');
  });

  it('should detect flipped precincts across simulation', () => {
    const election = {
      '1': { 'Rep A': '510', 'Dem B': '490' }, // Close race
      '2': { 'Rep A': '800', 'Dem B': '200' }  // Safe Rep
    };
    
    const dnc = {
      '1': { Rep: 600, Dem: 500, Mod: 100 },
      '2': { Rep: 900, Dem: 200, Mod: 100 }
    };
    
    const candidates = ['Rep A', 'Dem B'];
    
    // Get original winners
    const originalWinners = {};
    Object.keys(election).forEach(code => {
      const result = simulatePrecinctOutcome(
        election[code],
        dnc[code],
        { Rep: 1.0, Dem: 1.0, Mod: 1.0 },
        candidates
      );
      originalWinners[code] = result.winner.name;
    });
    
    // Simulate with reduced Rep turnout
    const simulatedWinners = {};
    Object.keys(election).forEach(code => {
      const result = simulatePrecinctOutcome(
        election[code],
        dnc[code],
        { Rep: 0.9, Dem: 1.0, Mod: 1.0 },
        candidates
      );
      simulatedWinners[code] = result.winner.name;
    });
    
    const flipped = detectFlippedPrecincts(originalWinners, simulatedWinners);
    
    // Precinct 1 should flip (510*.9=459 < 490)
    // Precinct 2 stays Rep (800*.9=720 > 200)
    expect(flipped).toContain('1');
    expect(flipped).not.toContain('2');
  });
});


// ============================================================================
// TESTS FOR estimatePartyVotersInPrecinct
// ============================================================================

describe('estimatePartyVotersInPrecinct', () => {
  const mockElectionData = {
    'PRECINCT CODE': '42',
    'Rep Alice': '600',
    'Dem Bob': '400',
    'REGISTERED VOTERS TOTAL': '1500',
    'BALLOTS CAST TOTAL': '1000'
  };

  const mockDncData = {
    Rep: 800,
    Dem: 500,
    Mod: 200
  };

  const candidates = ['Rep Alice', 'Dem Bob'];

  it('should estimate party voters based on vote share', () => {
    const result = estimatePartyVotersInPrecinct(mockElectionData, candidates, mockDncData);
    
    // 600 Rep votes out of 1000 total = 60% Rep
    // So estimated Rep voters = 1000 * 0.6 = 600
    expect(result.repVoted).toBe(600);
    expect(result.demVoted).toBe(400);
    expect(result.totalVoted).toBe(1000);
  });

  it('should return zeros for null inputs', () => {
    expect(estimatePartyVotersInPrecinct(null, candidates, mockDncData).repVoted).toBe(0);
    expect(estimatePartyVotersInPrecinct(mockElectionData, null, mockDncData).repVoted).toBe(0);
    expect(estimatePartyVotersInPrecinct(mockElectionData, candidates, null).repVoted).toBe(0);
  });

  it('should handle zero votes', () => {
    const zeroVotes = { ...mockElectionData, 'Rep Alice': '0', 'Dem Bob': '0' };
    const result = estimatePartyVotersInPrecinct(zeroVotes, candidates, mockDncData);
    expect(result.totalVoted).toBe(0);
  });
});


// ============================================================================
// TESTS FOR calculateNonVotersByParty
// ============================================================================

describe('calculateNonVotersByParty', () => {
  const mockElectionData = {
    'PRECINCT CODE': '42',
    'Rep Alice': '600',
    'Dem Bob': '400',
    'REGISTERED VOTERS TOTAL': '1500',
    'BALLOTS CAST TOTAL': '1000'
  };

  const mockDncData = {
    Rep: 600,  // 40%
    Dem: 600,  // 40%
    Mod: 300   // 20%
  };

  const candidates = ['Rep Alice', 'Dem Bob'];

  it('should calculate non-voters by party proportion', () => {
    const result = calculateNonVotersByParty(mockElectionData, candidates, mockDncData);
    
    // Total non-voters = 1500 - 1000 = 500
    expect(result.totalNonVoters).toBe(500);
    
    // Non-voters distributed by DNC shares (40/40/20)
    expect(result.repNonVoters).toBe(200);  // 500 * 0.4
    expect(result.demNonVoters).toBe(200);  // 500 * 0.4
    expect(result.modNonVoters).toBe(100);  // 500 * 0.2
  });

  it('should return zeros when all registered voters voted', () => {
    const fullTurnout = { ...mockElectionData, 'BALLOTS CAST TOTAL': '1500' };
    const result = calculateNonVotersByParty(fullTurnout, candidates, mockDncData);
    expect(result.totalNonVoters).toBe(0);
  });

  it('should handle null inputs', () => {
    expect(calculateNonVotersByParty(null, candidates, mockDncData).totalNonVoters).toBe(0);
    expect(calculateNonVotersByParty(mockElectionData, candidates, null).totalNonVoters).toBe(0);
  });
});


// ============================================================================
// TESTS FOR simulatePrecinctWithExtendedTurnout
// ============================================================================

describe('simulatePrecinctWithExtendedTurnout', () => {
  const mockElectionData = {
    'PRECINCT CODE': '42',
    'Rep Alice': '500',
    'Dem Bob': '400',
    'REGISTERED VOTERS TOTAL': '1500',
    'BALLOTS CAST TOTAL': '900'
  };

  const mockDncData = {
    Rep: 600,
    Dem: 600,
    Mod: 300
  };

  const candidates = ['Rep Alice', 'Dem Bob'];

  it('should reduce votes when multiplier is below 1.0', () => {
    const result = simulatePrecinctWithExtendedTurnout(
      mockElectionData, 
      mockDncData, 
      { Rep: 0.5, Dem: 1.0, Mod: 1.0 }, 
      candidates
    );
    
    // Rep: 500 * 0.5 = 250
    expect(result.adjustedVotes['Rep Alice']).toBe(250);
    expect(result.adjustedVotes['Dem Bob']).toBe(400);
    expect(result.flipped).toBe(true);
    expect(result.winner.name).toBe('Dem Bob');
  });

  it('should increase votes when multiplier is above 1.0', () => {
    const result = simulatePrecinctWithExtendedTurnout(
      mockElectionData, 
      mockDncData, 
      { Rep: 1.0, Dem: 1.2, Mod: 1.0 }, 
      candidates
    );
    
    // Dem gets extra votes from non-voters
    // Non-voters = 1500 - 900 = 600
    // Dem non-voters = 600 * (600/1500) = 240
    // Extra Dem votes = 400 * 0.2 = 80 (capped at available non-voters)
    expect(result.adjustedVotes['Dem Bob']).toBeGreaterThan(400);
    expect(result.adjustedVotes['Rep Alice']).toBe(500); // Unchanged
  });

  it('should clamp multiplier to valid range [0.5, 1.5]', () => {
    const result = simulatePrecinctWithExtendedTurnout(
      mockElectionData, 
      mockDncData, 
      { Rep: 2.0, Dem: 0.3, Mod: 1.0 }, 
      candidates
    );
    
    // Rep capped at 1.5, Dem capped at 0.5
    expect(result.adjustedVotes['Dem Bob']).toBe(200); // 400 * 0.5
  });

  it('should handle null inputs', () => {
    const result = simulatePrecinctWithExtendedTurnout(null, mockDncData, { Rep: 1.0 }, candidates);
    expect(result.winner).toBeNull();
  });
});


// ============================================================================
// TESTS FOR simulatePrecinctWithTargetTurnout
// ============================================================================

describe('simulatePrecinctWithTargetTurnout', () => {
  const mockElectionData = {
    'PRECINCT CODE': '42',
    'Rep Alice': '500',
    'Dem Bob': '400',
    'REGISTERED VOTERS TOTAL': '1500',
    'BALLOTS CAST TOTAL': '900'
  };

  const mockDncData = {
    Rep: 600,
    Dem: 600,
    Mod: 300
  };

  const candidates = ['Rep Alice', 'Dem Bob'];

  it('should scale down votes when target is below current turnout', () => {
    // Current turnout = 900/1500 = 60%
    // Target = 40% = 600 ballots
    const result = simulatePrecinctWithTargetTurnout(
      mockElectionData, 
      mockDncData, 
      0.4, 
      candidates
    );
    
    // Scale factor = 600/900 = 0.667
    expect(result.adjustedVotes['Rep Alice']).toBe(333); // 500 * 0.667
    expect(result.adjustedVotes['Dem Bob']).toBe(267);   // 400 * 0.667
  });

  it('should add votes when target is above current turnout', () => {
    // Current turnout = 900/1500 = 60%
    // Target = 80% = 1200 ballots = +300 ballots
    const result = simulatePrecinctWithTargetTurnout(
      mockElectionData, 
      mockDncData, 
      0.8, 
      candidates
    );
    
    // Extra 300 votes distributed by party
    expect(result.adjustedVotes['Rep Alice']).toBeGreaterThan(500);
    expect(result.adjustedVotes['Dem Bob']).toBeGreaterThan(400);
  });

  it('should handle null inputs', () => {
    const result = simulatePrecinctWithTargetTurnout(null, mockDncData, 0.5, candidates);
    expect(result.winner).toBeNull();
  });
});


// ============================================================================
// TESTS FOR applyVoterFlip
// ============================================================================

describe('applyVoterFlip', () => {
  const baseVotes = {
    'Rep Alice': 500,
    'Dem Bob': 400,
    'Mod Charlie': 100
  };

  const candidates = ['Rep Alice', 'Dem Bob', 'Mod Charlie'];

  it('should move votes from one party to another', () => {
    const flipRates = { 'Rep→Dem': 0.1 }; // 10% of Rep votes go to Dem
    const result = applyVoterFlip(baseVotes, flipRates, candidates);
    
    // 10% of 500 Rep votes = 50 moved to Dem
    expect(result['Rep Alice']).toBe(450);
    expect(result['Dem Bob']).toBe(450);
    expect(result['Mod Charlie']).toBe(100); // Unchanged
  });

  it('should handle multiple flip directions', () => {
    const flipRates = { 
      'Rep→Dem': 0.1,  // 50 votes moved
      'Mod→Dem': 0.2   // 20 votes moved
    };
    const result = applyVoterFlip(baseVotes, flipRates, candidates);
    
    expect(result['Rep Alice']).toBe(450);
    expect(result['Mod Charlie']).toBe(80);
    expect(result['Dem Bob']).toBe(470); // 400 + 50 + 20
  });

  it('should not produce negative votes', () => {
    const flipRates = { 'Mod→Dem': 1.0 }; // Try to move 100% (but capped at 25%)
    const result = applyVoterFlip(baseVotes, flipRates, candidates);
    
    expect(result['Mod Charlie']).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty flip rates', () => {
    const result = applyVoterFlip(baseVotes, {}, candidates);
    expect(result).toEqual(baseVotes);
  });

  it('should handle null inputs', () => {
    const result = applyVoterFlip(null, { 'Rep→Dem': 0.1 }, candidates);
    expect(result).toEqual({});
  });
});


// ============================================================================
// TESTS FOR simulatePrecinctCombined
// ============================================================================

describe('simulatePrecinctCombined', () => {
  const mockElectionData = {
    'PRECINCT CODE': '42',
    'Rep Alice': '550',
    'Dem Bob': '450',
    'REGISTERED VOTERS TOTAL': '1500',
    'BALLOTS CAST TOTAL': '1000'
  };

  const mockDncData = {
    Rep: 600,
    Dem: 600,
    Mod: 300
  };

  const candidates = ['Rep Alice', 'Dem Bob'];

  it('should apply turnout first, then flip', () => {
    const turnoutMultipliers = { Rep: 0.9, Dem: 1.0, Mod: 1.0 };
    const flipRates = { 'Rep→Dem': 0.05 };
    
    const result = simulatePrecinctCombined(
      mockElectionData, 
      mockDncData, 
      turnoutMultipliers, 
      flipRates, 
      candidates
    );
    
    // First: Rep 550 * 0.9 = 495, Dem 450
    // Then: 5% of 495 = ~25 moved to Dem
    // Final: Rep ~470, Dem ~475
    expect(result.winner.name).toBe('Dem Bob');
    expect(result.flipped).toBe(true);
  });

  it('should flip winner with combined effects', () => {
    // Rep starts ahead 550 vs 450
    const turnoutMultipliers = { Rep: 0.8, Dem: 1.1, Mod: 1.0 };
    const flipRates = { 'Rep→Dem': 0.1 };
    
    const result = simulatePrecinctCombined(
      mockElectionData, 
      mockDncData, 
      turnoutMultipliers, 
      flipRates, 
      candidates
    );
    
    expect(result.flipped).toBe(true);
    expect(result.winner.name).toBe('Dem Bob');
  });

  it('should work with only turnout changes', () => {
    const result = simulatePrecinctCombined(
      mockElectionData, 
      mockDncData, 
      { Rep: 0.5, Dem: 1.0, Mod: 1.0 }, 
      {}, 
      candidates
    );
    
    expect(result.adjustedVotes['Rep Alice']).toBe(275); // 550 * 0.5
    expect(result.winner.name).toBe('Dem Bob');
  });
});


// ============================================================================
// TESTS FOR createVoterFlipState
// ============================================================================

describe('createVoterFlipState', () => {
  it('should initialize with default rates of 0', () => {
    const state = createVoterFlipState();
    
    expect(state.getRate('Rep→Dem')).toBe(0);
    expect(state.getRate('Dem→Rep')).toBe(0);
    expect(state.getRate('Mod→Dem')).toBe(0);
  });

  it('should update rate when set', () => {
    const state = createVoterFlipState();
    
    state.setRate('Rep→Dem', 0.1);
    
    expect(state.getRate('Rep→Dem')).toBe(0.1);
  });

  it('should clamp rates to [0, 0.25]', () => {
    const state = createVoterFlipState();
    
    state.setRate('Rep→Dem', -0.1);
    expect(state.getRate('Rep→Dem')).toBe(0);
    
    state.setRate('Rep→Dem', 0.5);
    expect(state.getRate('Rep→Dem')).toBe(0.25);
  });

  it('should notify listeners on change', () => {
    const state = createVoterFlipState();
    const callback = jest.fn();
    
    state.onChange(callback);
    state.setRate('Rep→Dem', 0.1);
    
    expect(callback).toHaveBeenCalledWith('Rep→Dem', 0.1);
  });

  it('should detect when any flips are active', () => {
    const state = createVoterFlipState();
    
    expect(state.hasAnyFlips()).toBe(false);
    
    state.setRate('Rep→Dem', 0.05);
    expect(state.hasAnyFlips()).toBe(true);
  });

  it('should reset all rates to 0', () => {
    const state = createVoterFlipState();
    state.setRate('Rep→Dem', 0.1);
    state.setRate('Dem→Rep', 0.05);
    
    state.reset();
    
    expect(state.getRate('Rep→Dem')).toBe(0);
    expect(state.getRate('Dem→Rep')).toBe(0);
    expect(state.hasAnyFlips()).toBe(false);
  });
});


// ============================================================================
// TESTS FOR Extended createSliderState
// ============================================================================

describe('createSliderState with extended range', () => {
  it('should support extended range [0.5, 1.5]', () => {
    const state = createSliderState({ Rep: 1.0, Dem: 1.0, Mod: 1.0 }, { minValue: 0.5, maxValue: 1.5 });
    
    state.setValue('Rep', 1.3);
    expect(state.getValue('Rep')).toBe(1.3);
    
    state.setValue('Dem', 0.6);
    expect(state.getValue('Dem')).toBe(0.6);
  });

  it('should clamp to extended range', () => {
    const state = createSliderState({ Rep: 1.0 }, { minValue: 0.5, maxValue: 1.5 });
    
    state.setValue('Rep', 2.0);
    expect(state.getValue('Rep')).toBe(1.5);
    
    state.setValue('Rep', 0.3);
    expect(state.getValue('Rep')).toBe(0.5);
  });

  it('should report range via getRange()', () => {
    const state = createSliderState({}, { minValue: 0.5, maxValue: 1.5 });
    const range = state.getRange();
    
    expect(range.min).toBe(0.5);
    expect(range.max).toBe(1.5);
  });
});


// ============================================================================
// TESTS FOR runFullSimulation with new options
// ============================================================================

describe('runFullSimulation with voterFlipRates', () => {
  const mockElectionData = [
    { 'PRECINCT CODE': '1', 'Rep A': '550', 'Dem B': '450', 'REGISTERED VOTERS TOTAL': '1500', 'BALLOTS CAST TOTAL': '1000' },
    { 'PRECINCT CODE': '2', 'Rep A': '400', 'Dem B': '500', 'REGISTERED VOTERS TOTAL': '1200', 'BALLOTS CAST TOTAL': '900' }
  ];

  const mockDncData = {
    '1': { Rep: 600, Dem: 500, Mod: 400 },
    '2': { Rep: 400, Dem: 600, Mod: 200 }
  };

  const candidates = ['Rep A', 'Dem B'];

  it('should apply voter flip rates across all precincts', () => {
    const result = runFullSimulation(
      mockElectionData,
      mockDncData,
      candidates,
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 },
      { voterFlipRates: { 'Rep→Dem': 0.1 } }
    );

    // Precinct 1: Rep 550 - 55 = 495, Dem 450 + 55 = 505 -> flips
    expect(result.flippedPrecincts).toContain('1');
    expect(result.simulatedWinners['1']).toBe('Dem B');
  });

  it('should combine turnout and flip in correct order', () => {
    const result = runFullSimulation(
      mockElectionData,
      mockDncData,
      candidates,
      { Rep: 0.9, Dem: 1.0, Mod: 1.0 },  // Reduce Rep turnout
      { voterFlipRates: { 'Rep→Dem': 0.05 } }  // Plus 5% persuasion
    );

    // Both effects should combine to flip precinct 1
    expect(result.simulatedWinners['1']).toBe('Dem B');
  });
});


// ============================================================================
// TESTS FOR generateSimulatorControlsHTML with new features
// ============================================================================

describe('generateSimulatorControlsHTML with voter flip', () => {
  it('should include voter flip controls when showVoterFlip is true', () => {
    const html = generateSimulatorControlsHTML(
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 },
      {},
      { showVoterFlip: true }
    );

    expect(html).toContain('voter-flip-section');
    expect(html).toContain('flip-rep-dem');
    expect(html).toContain('Rep → Dem');
  });

  it('should exclude voter flip controls when showVoterFlip is false', () => {
    const html = generateSimulatorControlsHTML(
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 },
      {},
      { showVoterFlip: false }
    );

    expect(html).not.toContain('voter-flip-section');
  });

  it('should include extended slider range (50-150)', () => {
    const html = generateSimulatorControlsHTML();

    expect(html).toContain('min="50"');
    expect(html).toContain('max="150"');
    expect(html).toContain('150%');
  });

  it('should display current flip rates', () => {
    const html = generateSimulatorControlsHTML(
      { Rep: 1.0, Dem: 1.0, Mod: 1.0 },
      { 'Rep→Dem': 0.1, 'Mod→Dem': 0.05 }
    );

    expect(html).toContain('10%');
    expect(html).toContain('5%');
  });

  it('should include assumptions section', () => {
    const html = generateSimulatorControlsHTML();

    expect(html).toContain('simulator-assumptions');
    expect(html).toContain('Non-voter party mix');
    expect(html).toContain('Persuasion');
  });
});
