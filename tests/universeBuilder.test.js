/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  FILTER_FIELDS,
  buildPrecinctRecord,
  applyFilters,
  generateUniverseBuilderHTML,
  exportUniverseCSV,
  highlightUniverseOnMap
} from './universeBuilder.js';

describe('FILTER_FIELDS', () => {
  test('has expected fields defined', () => {
    expect(Array.isArray(FILTER_FIELDS)).toBe(true);
    expect(FILTER_FIELDS.length).toBe(9);
    const ids = FILTER_FIELDS.map(f => f.id);
    expect(ids).toContain('demPct');
    expect(ids).toContain('repPct');
    expect(ids).toContain('margin');
    expect(ids).toContain('turnoutPct');
    expect(ids).toContain('registeredVoters');
    expect(ids).toContain('population');
    expect(ids).toContain('medianIncome');
    expect(ids).toContain('collegePct');
    expect(ids).toContain('partyLean');
  });
});

describe('buildPrecinctRecord', () => {
  test('merges election, DNC, and census data correctly', () => {
    const electionRow = {
      'PRECINCT CODE': '42',
      'REGISTERED VOTERS TOTAL': 5000,
      'BALLOTS CAST TOTAL': 3500,
      'Dem Jane Smith': 1800,
      'Rep John Doe': 1500,
      'Lib Bob Other': 200
    };
    const dncRow = { winningParty: 'Dem' };
    const censusProfile = {
      population: 8200,
      income: { medianHousehold: 95000 },
      education: { bachelors: 0.35, graduateProfessional: 0.15 }
    };
    const candidates = ['Dem Jane Smith', 'Rep John Doe', 'Lib Bob Other'];

    const record = buildPrecinctRecord('42', electionRow, dncRow, censusProfile, candidates);

    expect(record.code).toBe('42');
    expect(record.demPct).toBeCloseTo(51.4, 0);
    expect(record.repPct).toBeCloseTo(42.9, 0);
    expect(record.margin).toBeGreaterThan(0);
    expect(record.turnoutPct).toBe(70.0);
    expect(record.registeredVoters).toBe(5000);
    expect(record.population).toBe(8200);
    expect(record.medianIncome).toBe(95000);
    expect(record.collegePct).toBe(50.0);
    expect(record.partyLean).toBe('Dem');
  });

  test('handles missing data gracefully', () => {
    const record = buildPrecinctRecord('99', null, null, null, []);
    expect(record.code).toBe('99');
    expect(record.demPct).toBeNull();
    expect(record.repPct).toBeNull();
    expect(record.margin).toBeNull();
    expect(record.turnoutPct).toBeNull();
    expect(record.registeredVoters).toBeNull();
    expect(record.population).toBeNull();
    expect(record.medianIncome).toBeNull();
    expect(record.collegePct).toBeNull();
    expect(record.partyLean).toBeNull();
  });

  test('handles election row with no candidates', () => {
    const electionRow = {
      'PRECINCT CODE': '10',
      'REGISTERED VOTERS TOTAL': 1000,
      'BALLOTS CAST TOTAL': 0
    };
    // With empty candidates array, the election block is skipped
    const record = buildPrecinctRecord('10', electionRow, null, null, []);
    expect(record.demPct).toBeNull();
    expect(record.registeredVoters).toBeNull();
  });
});

describe('applyFilters', () => {
  const records = [
    { code: '1', demPct: 55, repPct: 40, margin: 15, turnoutPct: 70, registeredVoters: 5000, population: 8000, medianIncome: 90000, collegePct: 45, partyLean: 'Dem' },
    { code: '2', demPct: 30, repPct: 65, margin: 35, turnoutPct: 60, registeredVoters: 3000, population: 5000, medianIncome: 70000, collegePct: 30, partyLean: 'Rep' },
    { code: '3', demPct: 48, repPct: 49, margin: 1, turnoutPct: 80, registeredVoters: 7000, population: 12000, medianIncome: 120000, collegePct: 60, partyLean: 'Mod' },
    { code: '4', demPct: null, repPct: null, margin: null, turnoutPct: null, registeredVoters: null, population: null, medianIncome: null, collegePct: null, partyLean: null }
  ];

  test('returns all records with empty criteria', () => {
    const result = applyFilters(records, []);
    expect(result.length).toBe(4);
  });

  test('single criterion works (gt)', () => {
    const result = applyFilters(records, [{ field: 'demPct', operator: 'gt', value: 45 }]);
    expect(result.length).toBe(2);
    expect(result.map(r => r.code)).toEqual(['1', '3']);
  });

  test('single criterion works (lte)', () => {
    const result = applyFilters(records, [{ field: 'margin', operator: 'lte', value: 15 }]);
    expect(result.length).toBe(2);
    expect(result.map(r => r.code)).toEqual(['1', '3']);
  });

  test('single criterion works (eq for enum)', () => {
    const result = applyFilters(records, [{ field: 'partyLean', operator: 'eq', value: 'Dem' }]);
    expect(result.length).toBe(1);
    expect(result[0].code).toBe('1');
  });

  test('multiple criteria uses AND logic', () => {
    const result = applyFilters(records, [
      { field: 'demPct', operator: 'gt', value: 40 },
      { field: 'turnoutPct', operator: 'gte', value: 75 }
    ]);
    expect(result.length).toBe(1);
    expect(result[0].code).toBe('3');
  });

  test('handles missing data (nulls) gracefully', () => {
    const result = applyFilters(records, [{ field: 'demPct', operator: 'gt', value: 0 }]);
    // Record 4 has null demPct, should be excluded
    expect(result.length).toBe(3);
    expect(result.map(r => r.code)).not.toContain('4');
  });

  test('between operator works', () => {
    const result = applyFilters(records, [{ field: 'medianIncome', operator: 'between', value: [80000, 100000] }]);
    expect(result.length).toBe(1);
    expect(result[0].code).toBe('1');
  });
});

describe('generateUniverseBuilderHTML', () => {
  test('renders basic structure', () => {
    const html = generateUniverseBuilderHTML([], 0, 100);
    expect(html).toContain('universe-builder');
    expect(html).toContain('Universe Builder');
    expect(html).toContain('>0</span> of 100 precincts match');
    expect(html).toContain('universe-add-filter');
    expect(html).toContain('universe-highlight-toggle');
    expect(html).toContain('universe-export-btn');
  });

  test('shows filter pills for each criterion', () => {
    const criteria = [
      { field: 'demPct', operator: 'gt', value: 50 },
      { field: 'turnoutPct', operator: 'gte', value: 70 }
    ];
    const html = generateUniverseBuilderHTML(criteria, 23, 252);
    expect(html).toContain('filter-pill');
    expect(html).toContain('Dem Vote %');
    expect(html).toContain('Turnout %');
    expect(html).toContain('>23</span> of 252 precincts match');
    // Two remove buttons
    const removeMatches = html.match(/filter-pill-remove/g);
    expect(removeMatches.length).toBe(2);
  });

  test('field dropdown has all filter fields', () => {
    const html = generateUniverseBuilderHTML();
    for (const f of FILTER_FIELDS) {
      expect(html).toContain(f.label);
    }
  });
});

describe('exportUniverseCSV', () => {
  let createObjectURLMock;

  beforeEach(() => {
    createObjectURLMock = jest.fn(() => 'blob:test');
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = jest.fn();
    global.Blob = jest.fn((content, options) => ({ content, options }));
  });

  test('creates CSV with correct headers and data', () => {
    const records = [
      { code: '1', demPct: 55, repPct: 40, margin: 15, turnoutPct: 70, registeredVoters: 5000, population: 8000, medianIncome: 90000, collegePct: 45, partyLean: 'Dem' }
    ];

    const clickMock = jest.fn();
    jest.spyOn(document, 'createElement').mockReturnValue({
      href: '', download: '', click: clickMock, style: {}
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    exportUniverseCSV(records);

    expect(global.Blob).toHaveBeenCalled();
    const blobContent = global.Blob.mock.calls[0][0][0];
    const lines = blobContent.split('\n');
    expect(lines.length).toBe(2); // header + 1 data row
    expect(lines[0]).toContain('Precinct');
    expect(lines[0]).toContain('Dem %');
    expect(lines[1]).toContain('1');
    expect(lines[1]).toContain('55');
  });

  test('does nothing for empty records', () => {
    exportUniverseCSV([]);
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });
});

describe('highlightUniverseOnMap', () => {
  test('sets correct styles for matching and non-matching precincts', () => {
    const setStyleMock1 = jest.fn();
    const setStyleMock2 = jest.fn();

    const mockLayer = {
      eachLayer: (fn) => {
        fn({ feature: { properties: { PRECINCT: '1' } }, setStyle: setStyleMock1 });
        fn({ feature: { properties: { PRECINCT: '2' } }, setStyle: setStyleMock2 });
      }
    };

    highlightUniverseOnMap(mockLayer, ['1']);

    // Matching precinct gets highlighted
    expect(setStyleMock1).toHaveBeenCalledWith({ fillOpacity: 0.7, opacity: 1 });
    // Non-matching precinct gets dimmed
    expect(setStyleMock2).toHaveBeenCalledWith({ fillColor: '#cccccc', fillOpacity: 0.15, opacity: 0.3 });
  });

  test('does nothing with null layer', () => {
    expect(() => highlightUniverseOnMap(null, ['1'])).not.toThrow();
  });
});

describe('CSV formula injection protection', () => {
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:test');
    global.URL.revokeObjectURL = jest.fn();
    global.Blob = jest.fn((content, options) => ({ content, options }));
    jest.spyOn(document, 'createElement').mockReturnValue({
      href: '', download: '', click: jest.fn(), style: {}
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
  });

  test('string values starting with = are neutralized in export', () => {
    const records = [
      { code: '=2+5', demPct: 55, repPct: 40, margin: 15, turnoutPct: 70, registeredVoters: 5000, population: 8000, medianIncome: 90000, collegePct: 45, partyLean: '@cmd' }
    ];

    exportUniverseCSV(records);

    const blobContent = global.Blob.mock.calls[0][0][0];
    const dataLine = blobContent.split('\n')[1];
    expect(dataLine.startsWith("'=2+5")).toBe(true);
    expect(dataLine).toContain("'@cmd");
  });

  test('negative numbers are not corrupted by formula escaping', () => {
    const records = [
      { code: '7', demPct: -5.2, repPct: 40, margin: 15, turnoutPct: 70, registeredVoters: 5000, population: 8000, medianIncome: 90000, collegePct: 45, partyLean: 'Dem' }
    ];

    exportUniverseCSV(records);

    const blobContent = global.Blob.mock.calls[0][0][0];
    const dataLine = blobContent.split('\n')[1];
    expect(dataLine).toContain('-5.2');
    expect(dataLine).not.toContain("'-5.2");
  });
});

describe('participation quirk handling', () => {
  test('precinct with ballots cast but zero candidate votes has null turnout', () => {
    const electionRow = {
      'PRECINCT CODE': '88',
      'REGISTERED VOTERS TOTAL': 4000,
      'BALLOTS CAST TOTAL': 2500, // county-wide ballots, but not this race
      'Dem Jane Smith': 0,
      'Rep John Doe': 0
    };
    const record = buildPrecinctRecord('88', electionRow, null, null, ['Dem Jane Smith', 'Rep John Doe']);
    expect(record.turnoutPct).toBeNull();
    expect(record.demPct).toBeNull();
    expect(record.registeredVoters).toBe(4000);
  });
});

describe('filter pill escaping', () => {
  test('user-supplied filter values are HTML-escaped in pills', () => {
    const criteria = [{ field: 'demPct', operator: 'gte', value: '<img src=x onerror=alert(1)>' }];
    const html = generateUniverseBuilderHTML(criteria, 0, 330);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
