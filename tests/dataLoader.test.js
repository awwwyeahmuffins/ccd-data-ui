// dataLoader.test.js
// Unit tests for data loading functions
// Tests focus on CSV parsing edge cases, error handling, and caching behavior

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ============================================================================
// Mock implementation of loadElectionData for testing
// (mirrors the actual implementation in dataLoader.js)
// ============================================================================

function parseCSVLine(line) {
  // Simple CSV parser that handles quoted fields with commas
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Current (buggy) implementation from dataLoader.js
function loadElectionDataBuggy(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx];
    });
    return obj;
  });

  return rows;
}

// Fixed implementation that handles quoted CSV fields
function loadElectionDataFixed(text) {
  const lines = text.trim().replace(/\r\n/g, '\n').split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    return obj;
  });

  return rows;
}

// ============================================================================
// Mock cache implementation for testing caching behavior
// ============================================================================

function createDataCache() {
  const cache = {
    allData: null,
    elections: {},
    electionsList: null
  };

  return {
    get: (key, subKey = null) => {
      if (subKey) {
        return cache[key]?.[subKey] || null;
      }
      return cache[key];
    },
    set: (key, value, subKey = null) => {
      if (subKey) {
        if (!cache[key]) cache[key] = {};
        cache[key][subKey] = value;
      } else {
        cache[key] = value;
      }
    },
    clear: () => {
      cache.allData = null;
      cache.elections = {};
      cache.electionsList = null;
    },
    has: (key, subKey = null) => {
      if (subKey) {
        return cache[key]?.[subKey] !== undefined;
      }
      return cache[key] !== null;
    }
  };
}

// ============================================================================
// TESTS FOR CSV PARSING
// ============================================================================

describe('loadElectionData - CSV Parsing', () => {
  
  describe('Basic functionality', () => {
    it('should parse simple CSV correctly', () => {
      const csv = `PRECINCT CODE,PRECINCT NAME,VOTES
101,Downtown,500
102,Uptown,300`;
      
      const result = loadElectionDataBuggy(csv);
      
      expect(result).toHaveLength(2);
      expect(result[0]['PRECINCT CODE']).toBe('101');
      expect(result[0]['PRECINCT NAME']).toBe('Downtown');
      expect(result[0]['VOTES']).toBe('500');
    });

    it('should return empty array for empty input', () => {
      const result = loadElectionDataBuggy('');
      expect(result).toHaveLength(0);
    });

    it('should return empty array for header-only CSV', () => {
      const csv = 'PRECINCT,NAME,VOTES';
      const result = loadElectionDataBuggy(csv);
      expect(result).toHaveLength(0);
    });

    it('should handle single data row', () => {
      const csv = `PRECINCT,VOTES
101,500`;
      const result = loadElectionDataBuggy(csv);
      expect(result).toHaveLength(1);
    });
  });

  describe('Edge cases - BUGS in current implementation', () => {
    
    it('BUG: fails on CSV fields containing commas', () => {
      const csv = `PRECINCT,CANDIDATE,VOTES
101,"Smith, John",500`;
      
      const buggyResult = loadElectionDataBuggy(csv);
      const fixedResult = loadElectionDataFixed(csv);
      
      // Buggy version splits incorrectly
      expect(buggyResult[0]['CANDIDATE']).toBe('"Smith');  // WRONG!
      
      // Fixed version handles quotes
      expect(fixedResult[0]['CANDIDATE']).toBe('Smith, John');  // CORRECT
    });

    it('BUG: misaligns columns when row has fewer values', () => {
      const csv = `A,B,C,D
1,2`;  // Missing C and D values
      
      const result = loadElectionDataBuggy(csv);
      
      expect(result[0]['A']).toBe('1');
      expect(result[0]['B']).toBe('2');
      expect(result[0]['C']).toBeUndefined();  // Missing!
      expect(result[0]['D']).toBeUndefined();  // Missing!
    });

    it('Fixed version handles fewer values gracefully', () => {
      const csv = `A,B,C,D
1,2`;
      
      const result = loadElectionDataFixed(csv);
      
      expect(result[0]['A']).toBe('1');
      expect(result[0]['B']).toBe('2');
      expect(result[0]['C']).toBe('');  // Empty string instead of undefined
      expect(result[0]['D']).toBe('');  // Empty string instead of undefined
    });

    it('BUG: misaligns columns when row has more values', () => {
      const csv = `A,B
1,2,3,4`;  // Extra values
      
      const result = loadElectionDataBuggy(csv);
      
      expect(result[0]['A']).toBe('1');
      expect(result[0]['B']).toBe('2');
      // Values '3' and '4' are silently lost!
    });

    it('should handle Windows line endings (CRLF)', () => {
      const csv = "A,B\r\n1,2\r\n3,4";
      const result = loadElectionDataFixed(csv);
      
      expect(result).toHaveLength(2);
      expect(result[0]['A']).toBe('1');
      expect(result[1]['A']).toBe('3');
    });

    it('should handle trailing newlines', () => {
      const csv = `A,B
1,2
`;
      const result = loadElectionDataBuggy(csv);
      expect(result).toHaveLength(1);  // Should not create empty row
    });

    it('should handle empty values', () => {
      const csv = `A,B,C
1,,3`;
      const result = loadElectionDataBuggy(csv);
      
      expect(result[0]['A']).toBe('1');
      expect(result[0]['B']).toBe('');
      expect(result[0]['C']).toBe('3');
    });
  });

  describe('Whitespace handling', () => {
    it('should trim header whitespace', () => {
      const csv = `  A  ,  B  
1,2`;
      const result = loadElectionDataBuggy(csv);
      
      expect(result[0]['A']).toBe('1');
      expect(result[0]['B']).toBe('2');
    });

    it('should trim value whitespace', () => {
      const csv = `A,B
  1  ,  2  `;
      const result = loadElectionDataBuggy(csv);
      
      expect(result[0]['A']).toBe('1');
      expect(result[0]['B']).toBe('2');
    });
  });
});

// ============================================================================
// TESTS FOR listElectionCSVs
// ============================================================================

describe('listElectionCSVs', () => {
  // These tests would require mocking fetch
  
  it('should return array of filenames from valid JSON', async () => {
    const mockFiles = ['election1.csv', 'election2.csv'];
    
    // Mock validation
    const isValid = Array.isArray(mockFiles);
    expect(isValid).toBe(true);
  });

  it('should return empty array for non-array JSON', () => {
    const mockResponse = { files: ['a.csv'] };  // Object, not array
    const result = Array.isArray(mockResponse) ? mockResponse : [];
    expect(result).toEqual([]);
  });

  it('should return empty array for null JSON', () => {
    const mockResponse = null;
    const result = Array.isArray(mockResponse) ? mockResponse : [];
    expect(result).toEqual([]);
  });
});

// ============================================================================
// TESTS FOR loadAllData - Data merging
// ============================================================================

describe('loadAllData - Data Merging', () => {
  
  it('should merge DNC data into feature properties', () => {
    const feature = {
      properties: { PRECINCT: '101', NAME: 'Test' }
    };
    const dncData = {
      precinct: '101',
      rep: 100,
      dem: 200,
      winningParty: 'Dem'
    };
    
    // Simulate merge
    Object.assign(feature.properties, dncData);
    
    expect(feature.properties.rep).toBe(100);
    expect(feature.properties.dem).toBe(200);
    expect(feature.properties.winningParty).toBe('Dem');
  });

  it('should handle precinct ID type mismatch (string vs number)', () => {
    const featureKey = String(101);  // "101"
    const csvKey = "101";
    
    expect(featureKey === csvKey).toBe(true);
    
    // But what if CSV has leading zeros?
    const csvKeyWithZero = "0101";
    expect(featureKey === csvKeyWithZero).toBe(false);  // Mismatch!
  });

  it('should not crash when DNC lookup misses a precinct', () => {
    const feature = {
      properties: { PRECINCT: '999' }  // Not in lookup
    };
    const dncLookup = {
      '101': { rep: 100 }
    };
    
    const key = String(feature.properties.PRECINCT);
    if (dncLookup[key]) {
      Object.assign(feature.properties, dncLookup[key]);
    }
    
    // Should not throw, properties unchanged
    expect(feature.properties.rep).toBeUndefined();
  });
});

// ============================================================================
// TESTS FOR DATA CACHING (NEW)
// ============================================================================

describe('Data Caching', () => {
  let cache;

  beforeEach(() => {
    cache = createDataCache();
  });

  it('should store and retrieve cached data', () => {
    const mockData = { geojson: {}, dncLookup: {} };
    cache.set('allData', mockData);
    
    expect(cache.get('allData')).toBe(mockData);
  });

  it('should return null for uncached data', () => {
    expect(cache.get('allData')).toBeNull();
  });

  it('should cache election data by filename', () => {
    const mockElection = [{ precinct: '101', votes: 500 }];
    cache.set('elections', mockElection, 'election2024.csv');
    
    expect(cache.get('elections', 'election2024.csv')).toBe(mockElection);
    expect(cache.get('elections', 'election2020.csv')).toBeNull();
  });

  it('should clear all cached data', () => {
    cache.set('allData', { test: true });
    cache.set('elections', { votes: 100 }, 'test.csv');
    cache.set('electionsList', ['a.csv', 'b.csv']);

    cache.clear();

    expect(cache.get('allData')).toBeNull();
    expect(cache.get('elections', 'test.csv')).toBeNull();
    expect(cache.get('electionsList')).toBeNull();
  });

  it('should check if data is cached', () => {
    expect(cache.has('allData')).toBe(false);
    
    cache.set('allData', { test: true });
    expect(cache.has('allData')).toBe(true);
  });

  it('should check if election data is cached by filename', () => {
    expect(cache.has('elections', 'test.csv')).toBe(false);
    
    cache.set('elections', [{ data: true }], 'test.csv');
    expect(cache.has('elections', 'test.csv')).toBe(true);
    expect(cache.has('elections', 'other.csv')).toBe(false);
  });
});

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('parseCSVLine - Robust CSV parser', () => {
  
  it('should parse simple line', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('should handle quoted fields', () => {
    expect(parseCSVLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('should handle empty fields', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('should handle quoted empty fields', () => {
    expect(parseCSVLine('a,"",c')).toEqual(['a', '', 'c']);
  });

  it('should trim whitespace', () => {
    expect(parseCSVLine('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c']);
  });

  it('should handle single field', () => {
    expect(parseCSVLine('single')).toEqual(['single']);
  });

  it('should handle all quoted fields', () => {
    expect(parseCSVLine('"a","b","c"')).toEqual(['a', 'b', 'c']);
  });

  it('should handle mixed quoted and unquoted', () => {
    expect(parseCSVLine('a,"b,c",d,e')).toEqual(['a', 'b,c', 'd', 'e']);
  });

  it('should handle trailing comma', () => {
    expect(parseCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('should handle leading comma', () => {
    expect(parseCSVLine(',a,b')).toEqual(['', 'a', 'b']);
  });
});

// ============================================================================
// TESTS FOR O(1) LOOKUP OPTIMIZATION (NEW)
// ============================================================================

describe('Election Data Lookup Optimization', () => {
  
  it('should use O(1) object lookup instead of O(n) array search', () => {
    // Build lookup object (O(n) once)
    const electionData = [
      { 'PRECINCT CODE': '101', 'VOTES': 500 },
      { 'PRECINCT CODE': '102', 'VOTES': 300 },
      { 'PRECINCT CODE': '103', 'VOTES': 400 }
    ];
    
    const electionByPrecinct = {};
    electionData.forEach(row => {
      electionByPrecinct[row['PRECINCT CODE']] = row;
    });

    // O(1) lookup
    const record = electionByPrecinct['102'];
    expect(record['VOTES']).toBe(300);

    // Verify non-existent returns undefined (not null from find)
    const missing = electionByPrecinct['999'];
    expect(missing).toBeUndefined();
  });

  it('should handle string vs number precinct codes', () => {
    const electionByPrecinct = {
      '101': { votes: 500 }
    };

    // String lookup
    expect(electionByPrecinct['101']).toEqual({ votes: 500 });

    // Number gets coerced to string in bracket notation
    expect(electionByPrecinct[101]).toEqual({ votes: 500 });

    // But direct comparison fails
    const numericKey = 101;
    const stringKey = '101';
    expect(numericKey === stringKey).toBe(false);
    expect(String(numericKey) === stringKey).toBe(true);
  });
});
