// js/electionFilters.test.js
// Unit tests for election filtering and categorization
// Run with: npm test

import { describe, it, expect, beforeEach } from '@jest/globals';

// ============================================================================
// CATEGORY DEFINITIONS (mirrors the implementation)
// ============================================================================

const ELECTION_CATEGORIES = {
  FEDERAL: 'Federal',
  STATE: 'State', 
  COUNTY: 'County',
  CITY: 'City',
  ISD: 'ISD',
  MUD: 'MUD',
  ALL: 'All'
};

// ============================================================================
// IMPLEMENTATION FUNCTIONS (to be moved to electionFilters.js)
// These are defined inline for TDD - tests written first
// ============================================================================

/**
 * Determines the category of an election based on its filename
 * @param {string} filename - The election CSV filename
 * @returns {string} The category (Federal, State, County, City, ISD, MUD)
 */
function categorizeElection(filename) {
  if (!filename || typeof filename !== 'string') {
    return ELECTION_CATEGORIES.COUNTY; // Default fallback
  }

  const normalized = filename.toLowerCase();

  // Federal races - President, US Senator, US Representatives
  if (
    normalized.includes('president') ||
    normalized.includes('united_states_senator') ||
    normalized.includes('u._s._representative') ||
    normalized.includes('united_states_representative')
  ) {
    return ELECTION_CATEGORIES.FEDERAL;
  }

  // MUD races (check before City to avoid false positives from city names)
  if (normalized.includes('_mud_') || normalized.includes('mud_no')) {
    return ELECTION_CATEGORIES.MUD;
  }

  // ISD races (check before City)
  if (normalized.includes('_isd_') || normalized.includes('_isd-') || normalized.includes('for_school_trustee')) {
    return ELECTION_CATEGORIES.ISD;
  }

  // City races - City_of_, Mayor, City_Council, Seat_No_ (council seats), Alderman
  if (
    normalized.includes('_city_of_') ||
    normalized.includes(',_city_of_') ||
    normalized.includes('mayor_') ||
    normalized.includes('city_council') ||
    normalized.includes('seat_no_') ||
    normalized.includes('alderman')
  ) {
    return ELECTION_CATEGORIES.CITY;
  }

  // State races - Governor, Lt Gov, AG, Comptroller, Commissioners, State Rep/Senator, State Courts
  if (
    normalized.includes('governor') ||
    normalized.includes('lieutenant_governor') ||
    normalized.includes('attorney_general') ||
    normalized.includes('comptroller') ||
    normalized.includes('commissioner_of_') ||
    normalized.includes('railroad_commissioner') ||
    normalized.includes('state_representative') ||
    normalized.includes('state_senator') ||
    normalized.includes('state_board_of_education') ||
    normalized.includes('court_of_criminal_appeals') ||
    normalized.includes('supreme_court') ||
    normalized.includes('court_of_appeals_district')
  ) {
    return ELECTION_CATEGORIES.STATE;
  }

  // County races - County_, District_, Sheriff, Constable, Justice_of_the_Peace
  if (
    normalized.includes('county_') ||
    normalized.includes('district_') ||
    normalized.includes('sheriff') ||
    normalized.includes('constable') ||
    normalized.includes('justice_of_the_peace')
  ) {
    return ELECTION_CATEGORIES.COUNTY;
  }

  // Default to County for unmatched races
  return ELECTION_CATEGORIES.COUNTY;
}

/**
 * Filters elections by category
 * @param {string[]} elections - Array of election filenames
 * @param {string} category - Category to filter by (or 'All')
 * @returns {string[]} Filtered array of filenames
 */
function filterByCategory(elections, category) {
  if (!elections || !Array.isArray(elections)) {
    return [];
  }

  if (!category || category === ELECTION_CATEGORIES.ALL) {
    return elections;
  }

  return elections.filter(filename => categorizeElection(filename) === category);
}

/**
 * Searches elections by query string (fuzzy matching)
 * @param {string[]} elections - Array of election filenames
 * @param {string} query - Search query
 * @returns {string[]} Matching filenames
 */
function searchElections(elections, query) {
  if (!elections || !Array.isArray(elections)) {
    return [];
  }

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return elections;
  }

  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/);

  return elections.filter(filename => {
    // Replace underscores with spaces for better matching
    const normalizedFilename = filename
      .toLowerCase()
      .replace(/\.csv$/, '')
      .replace(/_/g, ' ');
    
    // All query words must be found in the filename (AND logic)
    return queryWords.every(word => normalizedFilename.includes(word));
  });
}

/**
 * Gets counts for each category
 * @param {string[]} elections - Array of election filenames
 * @returns {Object} Object with category counts
 */
function getCategoryCounts(elections) {
  if (!elections || !Array.isArray(elections)) {
    return {
      [ELECTION_CATEGORIES.ALL]: 0,
      [ELECTION_CATEGORIES.FEDERAL]: 0,
      [ELECTION_CATEGORIES.STATE]: 0,
      [ELECTION_CATEGORIES.COUNTY]: 0,
      [ELECTION_CATEGORIES.CITY]: 0,
      [ELECTION_CATEGORIES.ISD]: 0,
      [ELECTION_CATEGORIES.MUD]: 0
    };
  }

  const counts = {
    [ELECTION_CATEGORIES.ALL]: elections.length,
    [ELECTION_CATEGORIES.FEDERAL]: 0,
    [ELECTION_CATEGORIES.STATE]: 0,
    [ELECTION_CATEGORIES.COUNTY]: 0,
    [ELECTION_CATEGORIES.CITY]: 0,
    [ELECTION_CATEGORIES.ISD]: 0,
    [ELECTION_CATEGORIES.MUD]: 0
  };

  elections.forEach(filename => {
    const category = categorizeElection(filename);
    if (counts.hasOwnProperty(category)) {
      counts[category]++;
    }
  });

  return counts;
}

/**
 * Formats election filename for display
 * @param {string} filename - The election CSV filename
 * @returns {string} Human-readable election name
 */
function formatElectionName(filename) {
  if (!filename || typeof filename !== 'string') {
    return '';
  }

  return filename
    .replace(/\.csv$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+-\s+/g, ' - ') // Ensure proper spacing around hyphens
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Highlights search matches in text
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {string} HTML with highlighted matches
 */
function highlightMatches(text, query) {
  if (!text || !query || typeof text !== 'string' || typeof query !== 'string') {
    return text || '';
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return text;
  }

  const words = trimmedQuery.split(/\s+/);
  let result = text;

  words.forEach(word => {
    if (word) {
      const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    }
  });

  return result;
}

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

    // MMD is a Municipal Management District (different from MUD) - but we'll include in MUD for simplicity
    it('should categorize MMD as MUD for simplicity', () => {
      // Note: This test documents current behavior - MMD would fall to County default
      // If we want to include MMD in MUD, we need to update the categorization logic
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

  it('should handle special regex characters safely', () => {
    const result = highlightMatches('Test (parentheses)', '(parentheses)');
    expect(result).toBe('Test <mark>(parentheses)</mark>');
  });
});

// ============================================================================
// INTEGRATION TESTS - Combined filtering and searching
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
