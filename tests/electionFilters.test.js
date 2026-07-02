// tests/electionFilters.test.js
// Unit tests for election filtering and categorization.
// Tests the REAL module (js/electionFilters.js) — no inline copies.
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js tests/electionFilters.test.js

import { describe, it, expect, jest } from '@jest/globals';
import {
  categorizeElection,
  filterByCategory,
  filterByYear,
  searchElections,
  getCategoryCounts,
  formatElectionName,
  highlightMatches,
  ELECTION_CATEGORIES,
  CATEGORY_ORDER,
  districtViewSlugForRace,
  categorizeByOffice
} from '../js/domain/races.js';

// ============================================================================
// CATEGORY CONSTANTS
// ============================================================================

describe('ELECTION_CATEGORIES and CATEGORY_ORDER', () => {
  it('should expose the six categories plus All', () => {
    expect(ELECTION_CATEGORIES).toEqual({
      FEDERAL: 'Federal',
      STATE: 'State',
      COUNTY: 'County',
      CITY: 'City',
      ISD: 'ISD',
      MUD: 'MUD',
      ALL: 'All'
    });
  });

  it('orders the full taxonomy Federal-first (display order)', () => {
    expect(CATEGORY_ORDER).toEqual([
      'Federal', 'State', 'County', 'City', 'ISD', 'MUD', 'Propositions', 'Other'
    ]);
  });
});

// ============================================================================
// TESTS FOR categorizeElection
// ============================================================================

describe('categorizeElection', () => {
  describe('Federal races', () => {
    it('should categorize President as Federal', () => {
      expect(categorizeElection('President_Vice_President.csv')).toBe('Federal');
    });

    it('should categorize US Senator as Federal', () => {
      expect(categorizeElection('United_States_Senator.csv')).toBe('Federal');
    });

    it('should categorize US Representative as Federal (format 1)', () => {
      expect(categorizeElection('U._S._Representative,_District_32.csv')).toBe('Federal');
    });

    it('should categorize US Representative as Federal (format 2)', () => {
      expect(categorizeElection('United_States_Representative,_District_3.csv')).toBe('Federal');
    });

    it('should categorize US Representative as Federal (format 3)', () => {
      expect(categorizeElection('U._S._Representative_District_3.csv')).toBe('Federal');
    });
  });

  describe('State races', () => {
    it('should categorize Governor as State', () => {
      expect(categorizeElection('Governor.csv')).toBe('State');
    });

    it('should categorize Lieutenant Governor as State', () => {
      expect(categorizeElection('Lieutenant_Governor.csv')).toBe('State');
    });

    it('should categorize Attorney General as State', () => {
      expect(categorizeElection('Attorney_General.csv')).toBe('State');
    });

    it('should categorize Comptroller as State', () => {
      expect(categorizeElection('Comptroller_of_Public_Accounts.csv')).toBe('State');
    });

    it('should categorize Commissioner of Agriculture as State', () => {
      expect(categorizeElection('Commissioner_of_Agriculture.csv')).toBe('State');
    });

    it('should categorize Railroad Commissioner as State', () => {
      expect(categorizeElection('Railroad_Commissioner.csv')).toBe('State');
    });

    it('should categorize State Representative as State', () => {
      expect(categorizeElection('State_Representative,_District_33.csv')).toBe('State');
    });

    it('should categorize State Senator as State', () => {
      expect(categorizeElection('State_Senator,_District_8.csv')).toBe('State');
    });

    it('should categorize State Board of Education as State', () => {
      expect(categorizeElection('Member,_State_Board_of_Education,_District_12.csv')).toBe('State');
    });

    it('should categorize Court of Criminal Appeals as State', () => {
      expect(categorizeElection('Judge,_Court_of_Criminal_Appeals,_Place_5.csv')).toBe('State');
      expect(categorizeElection('Presiding_Judge,_Court_of_Criminal_Appeals.csv')).toBe('State');
    });

    it('should categorize Supreme Court as State', () => {
      expect(categorizeElection('Justice,_Supreme_Court,_Place_2.csv')).toBe('State');
    });

    it('should categorize 5th Court of Appeals as State', () => {
      expect(categorizeElection('Chief_Justice,_5th_Court_of_Appeals_District.csv')).toBe('State');
      expect(categorizeElection('Justice,_5th_Court_of_Appeals_District,_Place_10.csv')).toBe('State');
    });
  });

  describe('County races', () => {
    it('should categorize County Commissioner as County', () => {
      expect(categorizeElection('County_Commissioner,_Precinct_4.csv')).toBe('County');
    });

    it('should categorize County Judge as County', () => {
      expect(categorizeElection('County_Judge_CCD.csv')).toBe('County');
    });

    it('should categorize District Clerk as County', () => {
      expect(categorizeElection('District_Clerk_CCD.csv')).toBe('County');
    });

    it('should categorize District Judge as County', () => {
      expect(categorizeElection('District_Judge,_199th_Judicial_District.csv')).toBe('County');
    });

    it('should categorize Sheriff as County', () => {
      expect(categorizeElection('Sheriff.csv')).toBe('County');
    });

    it('should categorize Constable as County', () => {
      expect(categorizeElection('Constable,_Precinct_No._1.csv')).toBe('County');
    });

    it('should categorize Justice of the Peace as County', () => {
      expect(categorizeElection('Justice_of_the_Peace,_Precinct_2.csv')).toBe('County');
    });

    it('should categorize County Tax Assessor as County', () => {
      expect(categorizeElection('County_Tax_Assessor-Collector.csv')).toBe('County');
    });
  });

  describe('City races', () => {
    it('should categorize City propositions as City', () => {
      expect(categorizeElection('Murphy,_City_of_-_Proposition_A.csv')).toBe('City');
      expect(categorizeElection('Dallas,_City_of_-_Proposition_A.csv')).toBe('City');
    });

    it('should categorize City council races as City', () => {
      expect(categorizeElection('City_Council,_Place_1_–_City_of_Lavon.csv')).toBe('City');
    });

    it('should categorize Mayor races as City', () => {
      expect(categorizeElection('Mayor_–_At_Large_–_City_of_Princeton.csv')).toBe('City');
    });

    it('should categorize Seat No. council races as City', () => {
      expect(categorizeElection('Seat_No._1_–_At_Large_–_City_of_Princeton.csv')).toBe('City');
    });

    it('should categorize Alderman races as City', () => {
      expect(categorizeElection('Weston,_City_of_-_Alderman_City_Council.csv')).toBe('City');
    });

    it('should categorize Local Option elections as City', () => {
      expect(categorizeElection('McKinney,_City_of_-_Local_Option_Election.csv')).toBe('City');
    });
  });

  describe('ISD races', () => {
    it('should categorize ISD propositions as ISD', () => {
      expect(categorizeElection('Anna_ISD_-_Proposition_A.csv')).toBe('ISD');
      expect(categorizeElection('Plano_ISD_-_Proposition_B.csv')).toBe('ISD');
    });

    it('should categorize ISD trustee elections as ISD', () => {
      expect(categorizeElection('Wylie_ISD_-_Trustee,_Place_1.csv')).toBe('ISD');
    });

    it('should categorize For School Trustee as ISD', () => {
      expect(categorizeElection('For_School_Trustee_-_Bland_ISD.csv')).toBe('ISD');
      expect(categorizeElection('For_School_Trustee_-_Princeton_ISD.csv')).toBe('ISD');
    });

    it('should check ISD before City (trustee seat with a City-looking token)', () => {
      // Contains 'seat_no_' (a City pattern) but the ISD marker wins
      expect(categorizeElection('Celina_ISD_-_Trustee,_Seat_No._3.csv')).toBe('ISD');
    });
  });

  describe('MUD races', () => {
    it('should categorize MUD director elections as MUD', () => {
      expect(categorizeElection('Collin_County_MUD_No._5_-_Directors.csv')).toBe('MUD');
      expect(categorizeElection('East_Collin_County_MUD_No._1_-_Directors.csv')).toBe('MUD');
    });

    it('should categorize MUD propositions as MUD', () => {
      expect(categorizeElection('Collin_County_MUD_No._5_-_Proposition_A.csv')).toBe('MUD');
      expect(categorizeElection('Van_Alstyne_MUD_3_-_Proposition_F.csv')).toBe('MUD');
    });

    it('should categorize various MUD types as MUD', () => {
      expect(categorizeElection('Raintree_MUD_No._1_of_Collin_County_-_Directors.csv')).toBe('MUD');
      expect(categorizeElection('Riverfield_MUD_No._1_-_Proposition_A.csv')).toBe('MUD');
      expect(categorizeElection('North_Collin_County_MUD_No._1_-_Directors.csv')).toBe('MUD');
    });

    it('should check MUD before City and County', () => {
      // Contains '_city_of_' (City pattern) and 'county_' (County pattern),
      // but the MUD marker wins
      expect(categorizeElection('Frisco,_City_of_-_MUD_No._2_-_Directors.csv')).toBe('MUD');
      expect(categorizeElection('Collin_County_MUD_No._5_-_Directors.csv')).toBe('MUD');
    });

    // MMD is a Municipal Management District (different from MUD)
    it('should let MMD fall through to the County default (documents current behavior)', () => {
      expect(categorizeElection('North_Parkway_MMD_No._1_-_Proposition_A.csv')).toBe('County');
    });
  });

  describe('Edge cases', () => {
    it('should return County for null input', () => {
      expect(categorizeElection(null)).toBe('County');
    });

    it('should return County for undefined input', () => {
      expect(categorizeElection(undefined)).toBe('County');
    });

    it('should return County for empty string', () => {
      expect(categorizeElection('')).toBe('County');
    });

    it('should return County for non-string input', () => {
      expect(categorizeElection(123)).toBe('County');
      expect(categorizeElection({})).toBe('County');
    });

    it('should return County for unknown election types', () => {
      expect(categorizeElection('Unknown_Election.csv')).toBe('County');
    });
  });
});

// ============================================================================
// TESTS FOR filterByCategory
// ============================================================================

describe('filterByCategory', () => {
  const sampleElections = [
    'President_Vice_President.csv',
    'Governor.csv',
    'Sheriff.csv',
    'Murphy,_City_of_-_Proposition_A.csv',
    'Anna_ISD_-_Proposition_A.csv',
    'Collin_County_MUD_No._5_-_Directors.csv'
  ];

  it('should return all elections for "All" category', () => {
    const result = filterByCategory(sampleElections, 'All');
    expect(result).toHaveLength(6);
    expect(result).toEqual(sampleElections);
  });

  it('should filter Federal elections only', () => {
    const result = filterByCategory(sampleElections, 'Federal');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('President_Vice_President.csv');
  });

  it('should filter State elections only', () => {
    const result = filterByCategory(sampleElections, 'State');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Governor.csv');
  });

  it('should filter County elections only', () => {
    const result = filterByCategory(sampleElections, 'County');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Sheriff.csv');
  });

  it('should filter City elections only', () => {
    const result = filterByCategory(sampleElections, 'City');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Murphy,_City_of_-_Proposition_A.csv');
  });

  it('should filter ISD elections only', () => {
    const result = filterByCategory(sampleElections, 'ISD');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Anna_ISD_-_Proposition_A.csv');
  });

  it('should filter MUD elections only', () => {
    const result = filterByCategory(sampleElections, 'MUD');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Collin_County_MUD_No._5_-_Directors.csv');
  });

  it('should return all elections for null category', () => {
    const result = filterByCategory(sampleElections, null);
    expect(result).toEqual(sampleElections);
  });

  it('should return all elections for undefined category', () => {
    const result = filterByCategory(sampleElections, undefined);
    expect(result).toEqual(sampleElections);
  });

  it('should return empty array for null elections', () => {
    expect(filterByCategory(null, 'Federal')).toEqual([]);
  });

  it('should return empty array for non-array elections', () => {
    expect(filterByCategory('not an array', 'Federal')).toEqual([]);
  });

  it('should return empty array when no matches', () => {
    const noFederal = ['Governor.csv', 'Sheriff.csv'];
    expect(filterByCategory(noFederal, 'Federal')).toEqual([]);
  });

  describe('object entries', () => {
    it('should prefer an explicit category field over the filename', () => {
      const entries = [
        { filename: 'Governor.csv', category: 'City' }, // explicit wins
        { filename: 'Governor.csv' }                    // falls back to filename → State
      ];
      expect(filterByCategory(entries, 'City')).toEqual([entries[0]]);
      expect(filterByCategory(entries, 'State')).toEqual([entries[1]]);
    });

    it('should categorize objects without a category field by filename', () => {
      const entries = [
        { filename: 'Sheriff.csv', year: 2024 },
        { filename: 'President_Vice_President.csv', year: 2024 }
      ];
      const result = filterByCategory(entries, 'County');
      expect(result).toEqual([entries[0]]);
    });
  });
});

// ============================================================================
// TESTS FOR filterByYear
// ============================================================================

describe('filterByYear', () => {
  const objectEntries = [
    { filename: 'Governor_2022.csv', year: 2022 },
    { filename: 'Governor_2018.csv', year: 2018 },
    { filename: 'President_Vice_President_2024.csv', year: 2024 },
    { filename: 'Sheriff_2024.csv', year: 2024 }
  ];

  it('should return all entries for null year', () => {
    expect(filterByYear(objectEntries, null)).toEqual(objectEntries);
    expect(filterByYear(objectEntries, undefined)).toEqual(objectEntries);
  });

  it('should filter object entries by their year field', () => {
    const result = filterByYear(objectEntries, 2024);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.filename)).toEqual([
      'President_Vice_President_2024.csv',
      'Sheriff_2024.csv'
    ]);
  });

  it('should return empty array when no entries match the year', () => {
    expect(filterByYear(objectEntries, 1999)).toEqual([]);
  });

  it('should extract the year from _YYYY.csv suffixes on string entries', () => {
    const strings = ['Governor_2022.csv', 'Governor_2018.csv'];
    expect(filterByYear(strings, 2022)).toEqual(['Governor_2022.csv']);
  });

  it('should exclude string entries without a year suffix when filtering', () => {
    const strings = ['Governor.csv', 'Governor_2022.csv'];
    expect(filterByYear(strings, 2022)).toEqual(['Governor_2022.csv']);
  });

  it('should return empty array for null or non-array input', () => {
    expect(filterByYear(null, 2022)).toEqual([]);
    expect(filterByYear('not an array', 2022)).toEqual([]);
  });
});

// ============================================================================
// TESTS FOR searchElections
// ============================================================================

describe('searchElections', () => {
  const sampleElections = [
    'President_Vice_President.csv',
    'Governor.csv',
    'State_Representative,_District_33.csv',
    'State_Senator,_District_8.csv',
    'Murphy,_City_of_-_Proposition_A.csv',
    'Murphy,_City_of_-_Proposition_B.csv',
    'Anna_ISD_-_Proposition_A.csv'
  ];

  it('should return all elections for empty query', () => {
    expect(searchElections(sampleElections, '')).toEqual(sampleElections);
  });

  it('should return all elections for null query', () => {
    expect(searchElections(sampleElections, null)).toEqual(sampleElections);
  });

  it('should return all elections for whitespace query', () => {
    expect(searchElections(sampleElections, '   ')).toEqual(sampleElections);
  });

  it('should find elections by single word', () => {
    const result = searchElections(sampleElections, 'governor');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Governor.csv');
  });

  it('should be case insensitive', () => {
    const result = searchElections(sampleElections, 'GOVERNOR');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Governor.csv');
  });

  it('should find multiple matches', () => {
    const result = searchElections(sampleElections, 'Murphy');
    expect(result).toHaveLength(2);
    expect(result).toContain('Murphy,_City_of_-_Proposition_A.csv');
    expect(result).toContain('Murphy,_City_of_-_Proposition_B.csv');
  });

  it('should search with multiple words (AND logic)', () => {
    const result = searchElections(sampleElections, 'state district');
    expect(result).toHaveLength(2);
    expect(result).toContain('State_Representative,_District_33.csv');
    expect(result).toContain('State_Senator,_District_8.csv');
  });

  it('should find by partial match', () => {
    const result = searchElections(sampleElections, 'rep');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('State_Representative,_District_33.csv');
  });

  it('should find by district number', () => {
    const result = searchElections(sampleElections, '33');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('State_Representative,_District_33.csv');
  });

  it('should handle underscores as spaces', () => {
    const result = searchElections(sampleElections, 'vice president');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('President_Vice_President.csv');
  });

  it('should return empty array when no matches', () => {
    const result = searchElections(sampleElections, 'xyz');
    expect(result).toHaveLength(0);
  });

  it('should return empty array for null elections', () => {
    expect(searchElections(null, 'test')).toEqual([]);
  });

  it('should return empty array for non-array elections', () => {
    expect(searchElections('not an array', 'test')).toEqual([]);
  });

  it('should handle special regex characters in query', () => {
    // Should not throw or cause regex errors
    expect(() => searchElections(sampleElections, 'a.b')).not.toThrow();
    expect(() => searchElections(sampleElections, 'a*b')).not.toThrow();
    expect(() => searchElections(sampleElections, 'a(b)')).not.toThrow();
  });

  describe('object entries', () => {
    it('should also match against displayName when present', () => {
      const entries = [
        { filename: 'race_001.csv', displayName: 'Governor (2022)' },
        { filename: 'race_002.csv', displayName: 'Sheriff (2024)' }
      ];
      const result = searchElections(entries, 'governor');
      expect(result).toEqual([entries[0]]);
    });

    it('should match a word from filename and a word from displayName together', () => {
      const entries = [
        { filename: 'Governor_2022.csv', displayName: 'Texas Governor' }
      ];
      // 'texas' only in displayName, '2022' only in filename
      expect(searchElections(entries, 'texas 2022')).toEqual(entries);
    });
  });
});

// ============================================================================
// TESTS FOR getCategoryCounts
// ============================================================================

describe('getCategoryCounts', () => {
  const sampleElections = [
    'President_Vice_President.csv',
    'United_States_Senator.csv',
    'Governor.csv',
    'Lieutenant_Governor.csv',
    'Sheriff.csv',
    'Murphy,_City_of_-_Proposition_A.csv',
    'Dallas,_City_of_-_Proposition_A.csv',
    'Anna_ISD_-_Proposition_A.csv',
    'Collin_County_MUD_No._5_-_Directors.csv'
  ];

  it('should count all categories correctly', () => {
    const counts = getCategoryCounts(sampleElections);

    expect(counts['All']).toBe(9);
    expect(counts['Federal']).toBe(2);
    expect(counts['State']).toBe(2);
    expect(counts['County']).toBe(1);
    expect(counts['City']).toBe(2);
    expect(counts['ISD']).toBe(1);
    expect(counts['MUD']).toBe(1);
  });

  it('should return zeros for empty array', () => {
    const counts = getCategoryCounts([]);

    expect(counts['All']).toBe(0);
    expect(counts['Federal']).toBe(0);
    expect(counts['State']).toBe(0);
    expect(counts['County']).toBe(0);
    expect(counts['City']).toBe(0);
    expect(counts['ISD']).toBe(0);
    expect(counts['MUD']).toBe(0);
  });

  it('should return zeros for null input', () => {
    const counts = getCategoryCounts(null);
    expect(counts['All']).toBe(0);
  });

  it('should return zeros for non-array input', () => {
    const counts = getCategoryCounts('not an array');
    expect(counts['All']).toBe(0);
  });

  it('should honor an explicit category field on object entries', () => {
    const entries = [
      { filename: 'Governor.csv', category: 'City' }, // explicit wins over State
      { filename: 'Sheriff.csv' }                     // filename → County
    ];
    const counts = getCategoryCounts(entries);
    expect(counts['All']).toBe(2);
    expect(counts['City']).toBe(1);
    expect(counts['State']).toBe(0);
    expect(counts['County']).toBe(1);
  });

  it('should ignore unknown category values (still counted in All)', () => {
    const counts = getCategoryCounts([{ filename: 'x.csv', category: 'Bogus' }]);
    expect(counts['All']).toBe(1);
    expect(counts['County']).toBe(0);
  });
});

// ============================================================================
// TESTS FOR formatElectionName
// ============================================================================

describe('formatElectionName', () => {
  it('should remove .csv extension', () => {
    expect(formatElectionName('Governor.csv')).toBe('Governor');
  });

  it('should replace underscores with spaces', () => {
    expect(formatElectionName('President_Vice_President.csv')).toBe('President Vice President');
  });

  it('should handle hyphens correctly', () => {
    expect(formatElectionName('Murphy,_City_of_-_Proposition_A.csv')).toBe('Murphy, City of - Proposition A');
  });

  it('should collapse multiple spaces', () => {
    expect(formatElectionName('Some__Double__Underscores.csv')).toBe('Some Double Underscores');
  });

  it('should trim whitespace', () => {
    expect(formatElectionName('_Leading_Trailing_.csv')).toBe('Leading Trailing');
  });

  it('should return empty string for null', () => {
    expect(formatElectionName(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(formatElectionName(undefined)).toBe('');
  });

  it('should return empty string for non-string', () => {
    expect(formatElectionName(123)).toBe('');
  });

  it('should handle filename without extension', () => {
    expect(formatElectionName('Governor')).toBe('Governor');
  });
});

// ============================================================================
// TESTS FOR highlightMatches
// ============================================================================

describe('highlightMatches', () => {
  it('should wrap matches in <mark> tags', () => {
    const result = highlightMatches('Governor of Texas', 'governor');
    expect(result).toBe('<mark>Governor</mark> of Texas');
  });

  it('should be case insensitive', () => {
    const result = highlightMatches('GOVERNOR', 'governor');
    expect(result).toBe('<mark>GOVERNOR</mark>');
  });

  it('should highlight multiple occurrences', () => {
    const result = highlightMatches('State State State', 'state');
    expect(result).toBe('<mark>State</mark> <mark>State</mark> <mark>State</mark>');
  });

  it('should highlight multiple words from query', () => {
    const result = highlightMatches('State Representative District 33', 'state district');
    expect(result).toBe('<mark>State</mark> Representative <mark>District</mark> 33');
  });

  it('should return original text for empty query', () => {
    expect(highlightMatches('Governor', '')).toBe('Governor');
  });

  it('should return original text for null query', () => {
    expect(highlightMatches('Governor', null)).toBe('Governor');
  });

  it('should return empty string for null text', () => {
    expect(highlightMatches(null, 'test')).toBe('');
  });

  it('should escape special regex characters in the query', () => {
    const result = highlightMatches('Test (parentheses)', '(parentheses)');
    expect(result).toBe('Test <mark>(parentheses)</mark>');
  });

  it('should not treat regex metacharacters in the query as patterns', () => {
    // '.' must match a literal dot, not "any character"
    expect(highlightMatches('No dot here', 'a.b')).toBe('No dot here');
    expect(highlightMatches('literal a.b here', 'a.b')).toBe('literal <mark>a.b</mark> here');
    expect(() => highlightMatches('text', 'a*b(')).not.toThrow();
  });

  it('should pass the input text through unescaped (caller must pre-escape untrusted text)', () => {
    // Documents real behavior: highlightMatches does NOT HTML-escape the text;
    // callers rendering untrusted text must escapeHtml() it first (js/utils.js).
    expect(highlightMatches('A & B <b>bold</b>', 'bold')).toBe('A & B <b><mark>bold</mark></b>');
  });
});

// ============================================================================
// TESTS FOR districtViewSlugForRace
// ============================================================================

describe('districtViewSlugForRace', () => {
  it('should map US Representative races to cd-N', () => {
    expect(districtViewSlugForRace({ office: 'U S Representative District 3', district: '3' })).toBe('cd-3');
    expect(districtViewSlugForRace({ office: 'United States Representative, District 4', district: 4 })).toBe('cd-4');
    expect(districtViewSlugForRace({ office: 'U.S. House District 4' })).toBe('cd-4');
  });

  it('should map State Senator races to sd-N', () => {
    expect(districtViewSlugForRace({ office: 'State Senator, District 8', district: '8' })).toBe('sd-8');
    // number embedded in office text instead of the district field
    expect(districtViewSlugForRace({ office: 'State Senator, District No. 24' })).toBe('sd-24');
  });

  it('should map State Representative/House races to hd-N', () => {
    expect(districtViewSlugForRace({ office: 'State Representative District 66', district: '66' })).toBe('hd-66');
    expect(districtViewSlugForRace({ office: 'State House 74 Dist 74' })).toBe('hd-74');
    // source typo "Disttrict" is absorbed by dist\w*
    expect(districtViewSlugForRace({ office: 'State Representative Disttrict 88' })).toBe('hd-88');
  });

  it('should prefer the district field over a number in the office text', () => {
    expect(districtViewSlugForRace({ office: 'State Senator, District 99', district: '8' })).toBe('sd-8');
  });

  it('should return null for non-district races', () => {
    expect(districtViewSlugForRace({ office: 'Governor', district: '' })).toBeNull();
    expect(districtViewSlugForRace({ office: 'Sheriff' })).toBeNull();
    expect(districtViewSlugForRace({ office: 'County Commissioner, Precinct 4', district: '4' })).toBeNull();
  });

  it('should return null when no valid district number can be found', () => {
    expect(districtViewSlugForRace({ office: 'State Senator' })).toBeNull();
    expect(districtViewSlugForRace({ office: 'State Senator, District 0' })).toBeNull();
  });

  it('should return null for null/empty entries', () => {
    expect(districtViewSlugForRace(null)).toBeNull();
    expect(districtViewSlugForRace(undefined)).toBeNull();
    expect(districtViewSlugForRace({})).toBeNull();
  });
});

// ============================================================================
// TESTS FOR categorizeByOffice
// ============================================================================

describe('categorizeByOffice', () => {
  it('should categorize congressional district races as Federal', () => {
    expect(categorizeByOffice({ office: 'United States Representative, District 3', district: '3' })).toBe('Federal');
  });

  it('should categorize state legislative district races as State', () => {
    expect(categorizeByOffice({ office: 'State Senator, District 8', district: '8' })).toBe('State');
    expect(categorizeByOffice({ office: 'State Representative District 66', district: '66' })).toBe('State');
  });

  it('should categorize President and US Senator as Federal', () => {
    expect(categorizeByOffice({ office: 'President/Vice President' })).toBe('Federal');
    expect(categorizeByOffice({ office: 'U.S. Senator' })).toBe('Federal');
    expect(categorizeByOffice({ office: 'United States Senator' })).toBe('Federal');
  });

  it('should categorize statewide executive and court offices as State', () => {
    expect(categorizeByOffice({ office: 'Governor' })).toBe('State');
    expect(categorizeByOffice({ office: 'Lieutenant Governor' })).toBe('State');
    expect(categorizeByOffice({ office: 'Attorney General' })).toBe('State');
    expect(categorizeByOffice({ office: 'Comptroller of Public Accounts' })).toBe('State');
    expect(categorizeByOffice({ office: 'Railroad Commissioner' })).toBe('State');
    expect(categorizeByOffice({ office: 'Justice, Supreme Court, Place 2' })).toBe('State');
    expect(categorizeByOffice({ office: 'Judge, Court of Criminal Appeals, Place 5' })).toBe('State');
  });

  it('should return null for regional/local courts (not conclusive)', () => {
    expect(categorizeByOffice({ office: 'Justice, 5th Court of Appeals District, Place 10' })).toBeNull();
    expect(categorizeByOffice({ office: 'Justice of the Peace, Precinct 2' })).toBeNull();
  });

  it('should return null for inconclusive or missing offices', () => {
    expect(categorizeByOffice({ office: 'Sheriff' })).toBeNull();
    expect(categorizeByOffice({ office: 'County Clerk' })).toBeNull();
    expect(categorizeByOffice({ office: '' })).toBeNull();
    expect(categorizeByOffice({})).toBeNull();
    expect(categorizeByOffice(null)).toBeNull();
  });
});

// ============================================================================
// TESTS FOR ElectionFilterManager (pure state methods)
// ============================================================================

describe('Integration: Combined filtering and searching', () => {
  const sampleElections = [
    'President_Vice_President.csv',
    'United_States_Senator.csv',
    'Governor.csv',
    'State_Representative,_District_33.csv',
    'State_Senator,_District_8.csv',
    'Sheriff.csv',
    'County_Commissioner,_Precinct_4.csv',
    'Murphy,_City_of_-_Proposition_A.csv',
    'Murphy,_City_of_-_Proposition_B.csv',
    'Anna_ISD_-_Proposition_A.csv',
    'Collin_County_MUD_No._5_-_Directors.csv'
  ];

  it('should filter by category then search', () => {
    // First filter to State
    const stateOnly = filterByCategory(sampleElections, 'State');
    expect(stateOnly).toHaveLength(3);

    // Then search within State
    const result = searchElections(stateOnly, 'senator');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('State_Senator,_District_8.csv');
  });

  it('should search then filter by category', () => {
    // First search for "proposition"
    const propositions = searchElections(sampleElections, 'proposition');
    // Sample has: Murphy A, Murphy B, Anna ISD A = 3 propositions
    expect(propositions).toHaveLength(3);

    // Then filter to City only
    const cityProps = filterByCategory(propositions, 'City');
    expect(cityProps).toHaveLength(2);
    expect(cityProps).toContain('Murphy,_City_of_-_Proposition_A.csv');
    expect(cityProps).toContain('Murphy,_City_of_-_Proposition_B.csv');
  });

  it('should handle empty results gracefully', () => {
    const stateOnly = filterByCategory(sampleElections, 'State');
    const result = searchElections(stateOnly, 'xyz');
    expect(result).toHaveLength(0);
  });
});
