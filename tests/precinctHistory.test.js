// precinctHistory.test.js
// Unit tests for Precinct Deep Dive feature (Workstream 4)
// Tests for Feature 4A (Voting History) and Feature 4B (Precinct Comparison)
// Run with: npm test

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  categorizeRace,
  formatRaceName,
  getPrecinctResult,
  buildVotingHistory,
  comparePrecincts,
  compareDemographics,
  calculateTurnout,
} from './precinctHistory.js';
// The HTML generators moved to ui/reportSections.js (REDESIGN Phase 2) —
// test the real module, not the shim. generateVotingHistoryHTML receives the
// turnout computation as an argument (it stays pure of precinctHistory).
import {
  generateVotingHistoryHTML,
  generateComparisonHTML
} from '../js/ui/reportSections.js';

// ============================================================================
// TESTS FOR categorizeRace
// ============================================================================

describe('categorizeRace', () => {
  describe('Federal races', () => {
    it('should categorize President race as Federal', () => {
      expect(categorizeRace('President_Vice_President.csv')).toBe('Federal');
    });
    
    it('should categorize U.S. Representative as Federal', () => {
      expect(categorizeRace('U._S._Representative,_District_32.csv')).toBe('Federal');
      expect(categorizeRace('United_States_Representative,_District_3.csv')).toBe('Federal');
    });
    
    it('should categorize United States Senator as Federal', () => {
      expect(categorizeRace('United_States_Senator.csv')).toBe('Federal');
    });
  });
  
  describe('State races', () => {
    it('should categorize Governor as State', () => {
      expect(categorizeRace('Governor.csv')).toBe('State');
    });
    
    it('should categorize Lieutenant Governor as State', () => {
      expect(categorizeRace('Lieutenant_Governor.csv')).toBe('State');
    });
    
    it('should categorize Attorney General as State', () => {
      expect(categorizeRace('Attorney_General.csv')).toBe('State');
    });
    
    it('should categorize State Representative as State', () => {
      expect(categorizeRace('State_Representative,_District_33.csv')).toBe('State');
    });
    
    it('should categorize State Senator as State', () => {
      expect(categorizeRace('State_Senator,_District_8.csv')).toBe('State');
    });
    
    it('should categorize Supreme Court Justice as State', () => {
      expect(categorizeRace('Justice,_Supreme_Court,_Place_2.csv')).toBe('State');
    });
  });
  
  describe('County races', () => {
    it('should categorize County Judge as County', () => {
      expect(categorizeRace('County_Judge_CCD.csv')).toBe('County');
    });
    
    it('should categorize Sheriff as County', () => {
      expect(categorizeRace('Sheriff.csv')).toBe('County');
    });
    
    it('should categorize District Judge as County', () => {
      expect(categorizeRace('District_Judge,_199th_Judicial_District.csv')).toBe('County');
    });
    
    it('should categorize Constable as County', () => {
      expect(categorizeRace('Constable,_Precinct_No._1.csv')).toBe('County');
    });
    
    it('should categorize Justice of the Peace as County', () => {
      expect(categorizeRace('Justice_of_the_Peace,_Precinct_2.csv')).toBe('County');
    });
  });
  
  describe('City races', () => {
    it('should categorize City Council as City', () => {
      expect(categorizeRace('City_Council,_Place_1_–_City_of_Lavon.csv')).toBe('City');
    });
    
    it('should categorize Mayor as City', () => {
      expect(categorizeRace('Mayor_–_At_Large_–_City_of_Princeton.csv')).toBe('City');
    });
    
    it('should categorize City propositions as City', () => {
      expect(categorizeRace('McKinney,_City_of_-_Local_Option_Election.csv')).toBe('City');
    });
  });
  
  describe('ISD races', () => {
    it('should categorize ISD propositions as ISD', () => {
      expect(categorizeRace('Plano_ISD_-_Proposition_A.csv')).toBe('ISD');
    });
    
    it('should categorize School Trustee as ISD', () => {
      expect(categorizeRace('For_School_Trustee_-_Princeton_ISD.csv')).toBe('ISD');
    });
  });
  
  describe('MUD races', () => {
    it('should categorize MUD propositions as MUD', () => {
      expect(categorizeRace('Collin_County_MUD_No._5_-_Proposition_A.csv')).toBe('MUD');
    });
    
    it('should categorize MUD Directors as MUD', () => {
      expect(categorizeRace('Riverfield_MUD_No._1_-_Directors.csv')).toBe('MUD');
    });
    
    it('should categorize MMD as MUD', () => {
      expect(categorizeRace('North_Parkway_MMD_No._1_-_Proposition_A.csv')).toBe('MUD');
    });
  });
  
  describe('Proposition races', () => {
    it('should categorize generic Proposition as Propositions', () => {
      // Note: This would be 'ISD' or 'MUD' depending on the full name
      // But if it doesn't match other patterns first, it falls to Propositions
      expect(categorizeRace('Some_Proposition_A.csv')).toBe('Propositions');
    });
  });
  
  describe('Edge cases', () => {
    it('should return Other for null input', () => {
      expect(categorizeRace(null)).toBe('Other');
    });
    
    it('should return Other for undefined input', () => {
      expect(categorizeRace(undefined)).toBe('Other');
    });
    
    it('should return Other for empty string', () => {
      expect(categorizeRace('')).toBe('Other');
    });
    
    it('should return Other for unrecognized race', () => {
      expect(categorizeRace('Some_Random_Race.csv')).toBe('Other');
    });
    
    it('should return Other for non-string input', () => {
      expect(categorizeRace(123)).toBe('Other');
      expect(categorizeRace({})).toBe('Other');
    });
  });
});

// ============================================================================
// TESTS FOR formatRaceName
// ============================================================================

describe('formatRaceName', () => {
  it('should remove .csv extension', () => {
    expect(formatRaceName('Governor.csv')).toBe('Governor');
  });
  
  it('should replace underscores with spaces', () => {
    expect(formatRaceName('State_Senator.csv')).toBe('State Senator');
  });
  
  it('should handle complex race names', () => {
    expect(formatRaceName('State_Representative,_District_33.csv')).toBe('State Representative,  District 33');
  });
  
  it('should handle case-insensitive extension', () => {
    expect(formatRaceName('Governor.CSV')).toBe('Governor');
  });
  
  it('should return Unknown Race for null', () => {
    expect(formatRaceName(null)).toBe('Unknown Race');
  });
  
  it('should return Unknown Race for undefined', () => {
    expect(formatRaceName(undefined)).toBe('Unknown Race');
  });
  
  it('should return Unknown Race for non-string', () => {
    expect(formatRaceName(123)).toBe('Unknown Race');
  });
});

// ============================================================================
// TESTS FOR getPrecinctResult
// ============================================================================

describe('getPrecinctResult', () => {
  const mockElectionData = [
    {
      'PRECINCT CODE': '101',
      'PRECINCT NAME': 'PCT 101',
      'REGISTERED VOTERS TOTAL': '2737',
      'BALLOTS CAST TOTAL': '1491',
      'REP Greg Abbott': '831',
      'DEM Beto ORourke': '660',
      'Winning Candidate': 'REP Greg Abbott',
      'Winning Party': 'REP'
    },
    {
      'PRECINCT CODE': '102',
      'PRECINCT NAME': 'PCT 102',
      'REGISTERED VOTERS TOTAL': '1000',
      'BALLOTS CAST TOTAL': '0',
      'REP Greg Abbott': '0',
      'DEM Beto ORourke': '0',
      'Winning Candidate': '',
      'Winning Party': ''
    },
    {
      'PRECINCT CODE': '103',
      'PRECINCT NAME': 'PCT 103',
      'REGISTERED VOTERS TOTAL': '3000',
      'BALLOTS CAST TOTAL': '1500',
      'REP Greg Abbott': '600',
      'DEM Beto ORourke': '900',
      'Winning Candidate': 'DEM Beto ORourke',
      'Winning Party': 'DEM'
    }
  ];
  
  it('should return result for valid precinct', () => {
    const result = getPrecinctResult(mockElectionData, '101');
    expect(result).not.toBeNull();
    expect(result.precinctCode).toBe('101');
    expect(result.winner).toBe('REP Greg Abbott');
    expect(result.winningParty).toBe('REP');
    expect(result.totalVotes).toBe(1491);  // 831 + 660 = 1491
    expect(result.registeredVoters).toBe(2737);
  });
  
  it('should return null for precinct with 0 ballots', () => {
    const result = getPrecinctResult(mockElectionData, '102');
    expect(result).toBeNull();
  });
  
  it('should return null for non-existent precinct', () => {
    const result = getPrecinctResult(mockElectionData, '999');
    expect(result).toBeNull();
  });
  
  it('should handle numeric precinct code', () => {
    const result = getPrecinctResult(mockElectionData, 101);
    expect(result).not.toBeNull();
    expect(result.precinctCode).toBe('101');
  });
  
  it('should return null for empty election data', () => {
    expect(getPrecinctResult([], '101')).toBeNull();
  });
  
  it('should return null for null election data', () => {
    expect(getPrecinctResult(null, '101')).toBeNull();
  });
  
  it('should return null for null precinct code', () => {
    expect(getPrecinctResult(mockElectionData, null)).toBeNull();
  });
  
  it('should return null for undefined precinct code', () => {
    expect(getPrecinctResult(mockElectionData, undefined)).toBeNull();
  });
});

// ============================================================================
// TESTS FOR buildVotingHistory
// ============================================================================

describe('buildVotingHistory', () => {
  const mockAllElectionData = {
    'Governor.csv': [
      { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '1000', 'REGISTERED VOTERS TOTAL': '2000', 'REP Abbott': '600', 'DEM Beto': '400', 'Winning Candidate': 'REP Abbott', 'Winning Party': 'REP' },
      { 'PRECINCT CODE': '102', 'BALLOTS CAST TOTAL': '500', 'REGISTERED VOTERS TOTAL': '1000', 'REP Abbott': '200', 'DEM Beto': '300', 'Winning Candidate': 'DEM Beto', 'Winning Party': 'DEM' }
    ],
    'President_Vice_President.csv': [
      { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '1100', 'REGISTERED VOTERS TOTAL': '2000', 'REP Trump': '700', 'DEM Biden': '400', 'Winning Candidate': 'REP Trump', 'Winning Party': 'REP' },
      { 'PRECINCT CODE': '102', 'BALLOTS CAST TOTAL': '600', 'REGISTERED VOTERS TOTAL': '1000', 'REP Trump': '250', 'DEM Biden': '350', 'Winning Candidate': 'DEM Biden', 'Winning Party': 'DEM' }
    ],
    'Sheriff.csv': [
      { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '900', 'REGISTERED VOTERS TOTAL': '2000', 'REP Smith': '900', 'Winning Candidate': 'REP Smith', 'Winning Party': 'REP' }
    ],
    'Plano_ISD_-_Proposition_A.csv': [
      { 'PRECINCT CODE': '102', 'BALLOTS CAST TOTAL': '400', 'REGISTERED VOTERS TOTAL': '1000', 'For': '250', 'Against': '150', 'Winning Candidate': 'For', 'Winning Party': 'FOR' }
    ]
  };
  
  it('should build history for precinct that participated in multiple races', () => {
    const history = buildVotingHistory('101', mockAllElectionData);
    
    expect(history.races).toHaveLength(3);
    expect(history.partyRecord.Rep).toBe(3);
    expect(history.partyRecord.Dem).toBe(0);
  });
  
  it('should group races by category', () => {
    const history = buildVotingHistory('101', mockAllElectionData);
    
    expect(history.byCategory.State).toHaveLength(1);
    expect(history.byCategory.Federal).toHaveLength(1);
    expect(history.byCategory.County).toHaveLength(1);
  });
  
  it('should track party wins correctly', () => {
    const history = buildVotingHistory('102', mockAllElectionData);
    
    expect(history.partyRecord.Dem).toBe(2);
    expect(history.partyRecord.Other).toBe(1); // FOR is Other
  });
  
  it('should return empty history for non-existent precinct', () => {
    const history = buildVotingHistory('999', mockAllElectionData);
    
    expect(history.races).toHaveLength(0);
    expect(Object.keys(history.byCategory)).toHaveLength(0);
    expect(history.partyRecord.Rep).toBe(0);
    expect(history.partyRecord.Dem).toBe(0);
  });
  
  it('should handle null precinct code', () => {
    const history = buildVotingHistory(null, mockAllElectionData);
    
    expect(history.races).toHaveLength(0);
  });
  
  it('should handle null election data', () => {
    const history = buildVotingHistory('101', null);
    
    expect(history.races).toHaveLength(0);
  });
  
  it('should handle empty election data object', () => {
    const history = buildVotingHistory('101', {});
    
    expect(history.races).toHaveLength(0);
  });
});

// ============================================================================
// TESTS FOR comparePrecincts
// ============================================================================

describe('comparePrecincts', () => {
  const mockElectionData = [
    { 'PRECINCT CODE': '101', 'BALLOTS CAST TOTAL': '1000', 'REGISTERED VOTERS TOTAL': '2000', 'REP Abbott': '600', 'DEM Beto': '400', 'Winning Candidate': 'REP Abbott', 'Winning Party': 'REP' },
    { 'PRECINCT CODE': '102', 'BALLOTS CAST TOTAL': '500', 'REGISTERED VOTERS TOTAL': '1000', 'REP Abbott': '300', 'DEM Beto': '200', 'Winning Candidate': 'REP Abbott', 'Winning Party': 'REP' },
    { 'PRECINCT CODE': '103', 'BALLOTS CAST TOTAL': '600', 'REGISTERED VOTERS TOTAL': '1000', 'REP Abbott': '200', 'DEM Beto': '400', 'Winning Candidate': 'DEM Beto', 'Winning Party': 'DEM' },
    { 'PRECINCT CODE': '104', 'BALLOTS CAST TOTAL': '0', 'REGISTERED VOTERS TOTAL': '1000', 'REP Abbott': '0', 'DEM Beto': '0', 'Winning Candidate': '', 'Winning Party': '' }
  ];
  
  it('should compare two precincts with same winner', () => {
    const comparison = comparePrecincts(mockElectionData, '101', '102');
    
    expect(comparison.bothParticipated).toBe(true);
    expect(comparison.sameWinner).toBe(true);
    expect(comparison.precinct1.result.winningParty).toBe('REP');
    expect(comparison.precinct2.result.winningParty).toBe('REP');
  });
  
  it('should compare two precincts with different winners', () => {
    const comparison = comparePrecincts(mockElectionData, '101', '103');
    
    expect(comparison.bothParticipated).toBe(true);
    expect(comparison.sameWinner).toBe(false);
    expect(comparison.precinct1.result.winningParty).toBe('REP');
    expect(comparison.precinct2.result.winningParty).toBe('DEM');
  });
  
  it('should handle precinct that did not participate', () => {
    const comparison = comparePrecincts(mockElectionData, '101', '104');
    
    expect(comparison.bothParticipated).toBe(false);
    expect(comparison.precinct1.result).not.toBeNull();
    expect(comparison.precinct2.result).toBeNull();
  });
  
  it('should handle both precincts not participating', () => {
    const comparison = comparePrecincts(mockElectionData, '104', '999');
    
    expect(comparison.bothParticipated).toBe(false);
    expect(comparison.sameWinner).toBe(false);
  });
  
  it('should return null for invalid inputs', () => {
    expect(comparePrecincts(null, '101', '102')).toBeNull();
    expect(comparePrecincts(mockElectionData, null, '102')).toBeNull();
    expect(comparePrecincts(mockElectionData, '101', null)).toBeNull();
  });
});

// ============================================================================
// TESTS FOR compareDemographics
// ============================================================================

describe('compareDemographics', () => {
  const mockProps1 = {
    PRECINCT: '101',
    repShare: 0.55,
    modShare: 0.25,
    demShare: 0.20,
    winningParty: 'Rep',
    partyStrength: 2
  };
  
  const mockProps2 = {
    PRECINCT: '102',
    repShare: 0.35,
    modShare: 0.30,
    demShare: 0.35,
    winningParty: 'Dem',
    partyStrength: 1
  };
  
  it('should compare demographics between two precincts', () => {
    const comparison = compareDemographics(mockProps1, mockProps2);
    
    expect(comparison.precinct1.code).toBe('101');
    expect(comparison.precinct1.repShare).toBe(0.55);
    expect(comparison.precinct2.code).toBe('102');
    expect(comparison.precinct2.repShare).toBe(0.35);
  });
  
  it('should calculate differences correctly', () => {
    const comparison = compareDemographics(mockProps1, mockProps2);
    
    expect(comparison.differences.repShare).toBeCloseTo(0.20);
    expect(comparison.differences.modShare).toBeCloseTo(0.05);
    expect(comparison.differences.demShare).toBeCloseTo(0.15);
  });
  
  it('should handle missing properties with defaults', () => {
    const incompleteProps = { PRECINCT: '103' };
    const comparison = compareDemographics(incompleteProps, mockProps2);
    
    expect(comparison.precinct1.repShare).toBe(0);
    expect(comparison.precinct1.winningParty).toBe('N/A');
    expect(comparison.precinct1.partyStrength).toBe(0);
  });
  
  it('should return null for null inputs', () => {
    expect(compareDemographics(null, mockProps2)).toBeNull();
    expect(compareDemographics(mockProps1, null)).toBeNull();
    expect(compareDemographics(null, null)).toBeNull();
  });
  
  it('should use precinct property if PRECINCT is missing', () => {
    const propsWithLowercase = { precinct: '105', repShare: 0.5 };
    const comparison = compareDemographics(propsWithLowercase, mockProps2);
    
    expect(comparison.precinct1.code).toBe('105');
  });
});

// ============================================================================
// TESTS FOR calculateTurnout
// ============================================================================

describe('calculateTurnout', () => {
  it('should calculate correct turnout percentage', () => {
    expect(calculateTurnout(500, 1000)).toBe(50);
    expect(calculateTurnout(750, 1000)).toBe(75);
    expect(calculateTurnout(1000, 1000)).toBe(100);
  });
  
  it('should handle decimal results', () => {
    const turnout = calculateTurnout(333, 1000);
    expect(turnout).toBeCloseTo(33.3);
  });
  
  it('should return 0 for no registered voters', () => {
    expect(calculateTurnout(100, 0)).toBe(0);
  });
  
  it('should return 0 for negative registered voters', () => {
    expect(calculateTurnout(100, -50)).toBe(0);
  });
  
  it('should cap at 100% for overvotes', () => {
    // Edge case: more ballots than registered (data error)
    expect(calculateTurnout(1500, 1000)).toBe(100);
  });
  
  it('should return 0 for negative ballots cast', () => {
    const turnout = calculateTurnout(-100, 1000);
    expect(turnout).toBe(0);
  });
  
  it('should handle null/undefined inputs', () => {
    expect(calculateTurnout(null, 1000)).toBe(0);
    expect(calculateTurnout(500, null)).toBe(0);
  });
});

// ============================================================================
// TESTS FOR HTML GENERATION (Feature 4A UI)
// ============================================================================

describe('generateVotingHistoryHTML', () => {
  it('should return empty state for no history', () => {
    const html = generateVotingHistoryHTML(null, calculateTurnout);
    expect(html).toContain('empty-state');
    expect(html).toContain('No voting history');
  });
  
  it('should return empty state for empty races array', () => {
    const html = generateVotingHistoryHTML({ races: [], byCategory: {}, partyRecord: {} }, calculateTurnout);
    expect(html).toContain('empty-state');
  });
  
  it('should include party record summary', () => {
    const history = {
      races: [{ raceName: 'Test' }],
      byCategory: { Federal: [{ raceName: 'Test', winner: 'REP Smith', winningParty: 'REP' }] },
      partyRecord: { Rep: 5, Dem: 3, Other: 1 }
    };
    
    const html = generateVotingHistoryHTML(history, calculateTurnout);
    expect(html).toContain('Rep: 5');
    expect(html).toContain('Dem: 3');
    expect(html).toContain('Other: 1');
  });
  
  it('should group races by category', () => {
    const history = {
      races: [{ raceName: 'Test' }],
      byCategory: {
        Federal: [{ raceName: 'President', winner: 'REP Trump', winningParty: 'REP', totalVotes: 1000, registeredVoters: 2000 }],
        State: [{ raceName: 'Governor', winner: 'REP Abbott', winningParty: 'REP', totalVotes: 900, registeredVoters: 2000 }]
      },
      partyRecord: { Rep: 2, Dem: 0, Other: 0 }
    };
    
    const html = generateVotingHistoryHTML(history, calculateTurnout);
    // The implementation uses span for count: <span class="race-count">(1)</span>
    expect(html).toContain('Federal');
    expect(html).toContain('(1)');
    expect(html).toContain('State');
    expect(html).toContain('President');
    expect(html).toContain('Governor');
  });
});

// ============================================================================
// TESTS FOR COMPARISON UI (Feature 4B UI)
// ============================================================================

describe('generateComparisonHTML', () => {
  it('should return error state for null demographics', () => {
    const html = generateComparisonHTML(null, null, null);
    expect(html).toContain('error-state');
  });
  
  it('should show precinct codes in header', () => {
    const demographics = {
      precinct1: { code: '101', repShare: 0.5, modShare: 0.3, demShare: 0.2 },
      precinct2: { code: '102', repShare: 0.4, modShare: 0.3, demShare: 0.3 },
      differences: { repShare: 0.1, modShare: 0, demShare: 0.1 }
    };
    
    const html = generateComparisonHTML(demographics, null, null);
    expect(html).toContain('101');
    expect(html).toContain('102');
  });
  
  it('should show election comparison when both participated', () => {
    const demographics = {
      precinct1: { code: '101', repShare: 0.5, modShare: 0.3, demShare: 0.2 },
      precinct2: { code: '102', repShare: 0.4, modShare: 0.3, demShare: 0.3 },
      differences: { repShare: 0.1, modShare: 0, demShare: 0.1 }
    };
    
    const electionComparison = {
      precinct1: { code: '101', result: { winner: 'REP Abbott', totalVotes: 1000, registeredVoters: 2000 } },
      precinct2: { code: '102', result: { winner: 'DEM Beto', totalVotes: 800, registeredVoters: 1500 } },
      bothParticipated: true,
      sameWinner: false
    };
    
    const html = generateComparisonHTML(demographics, electionComparison, 'Governor');
    expect(html).toContain('Governor');
    expect(html).toContain('REP Abbott');
    expect(html).toContain('DEM Beto');
    // Check for the different winners indicator
    expect(html).toContain('Different winners');
  });
  
  it('should show message when precincts did not participate', () => {
    const demographics = {
      precinct1: { code: '101', repShare: 0.5, modShare: 0.3, demShare: 0.2 },
      precinct2: { code: '102', repShare: 0.4, modShare: 0.3, demShare: 0.3 },
      differences: { repShare: 0.1, modShare: 0, demShare: 0.1 }
    };
    
    const electionComparison = {
      precinct1: { code: '101', result: null },
      precinct2: { code: '102', result: null },
      bothParticipated: false,
      sameWinner: false
    };
    
    const html = generateComparisonHTML(demographics, electionComparison, 'Some Race');
    expect(html).toContain('did not participate');
  });
});
