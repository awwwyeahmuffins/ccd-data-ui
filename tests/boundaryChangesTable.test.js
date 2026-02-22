/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  loadBoundaryChangeSummary,
  generateBoundaryTableHTML,
  generateBoundaryStatsHTML,
  exportBoundaryCSV
} from './boundaryChangesTable.js';

// Mock fetch
const MOCK_METADATA = {
  "1": {
    "dataQuality": "exact",
    "interpolationType": "unchanged",
    "maxWeight": 1.0,
    "sources": [{ "old": 1, "weight": 1.0 }]
  },
  "2": {
    "dataQuality": "exact",
    "interpolationType": "unchanged",
    "maxWeight": 1.0,
    "sources": [{ "old": 2, "weight": 1.0 }]
  },
  "3": {
    "dataQuality": "exact",
    "interpolationType": "merged",
    "maxWeight": 1.0,
    "sources": [{ "old": 3, "weight": 1.0 }, { "old": 100, "weight": 1.0 }]
  },
  "8": {
    "dataQuality": "estimated",
    "interpolationType": "split",
    "maxWeight": 0.7519,
    "sources": [{ "old": 8, "weight": 0.751936 }],
    "crosswalkMethod": "voter_file"
  },
  "253": {
    "dataQuality": "estimated",
    "interpolationType": "new_boundary",
    "maxWeight": 0.558,
    "sources": [{ "old": 220, "weight": 0.557967 }],
    "crosswalkMethod": "voter_file"
  },
  "260": {
    "dataQuality": "low_confidence",
    "interpolationType": "sliver",
    "maxWeight": 0.0877,
    "sources": [{ "old": 22, "weight": 0.087709 }],
    "isSliver": true
  }
};

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(MOCK_METADATA)
    })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loadBoundaryChangeSummary', () => {
  test('parses metadata correctly into flat array', async () => {
    const result = await loadBoundaryChangeSummary();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(6);

    const pct1 = result.find(r => r.precinctCode === '1');
    expect(pct1).toBeDefined();
    expect(pct1.changeType).toBe('unchanged');
    expect(pct1.dataQuality).toBe('exact');
    expect(pct1.sources).toEqual([{ old: 1, weight: 1.0 }]);
  });

  test('handles all change types', async () => {
    const result = await loadBoundaryChangeSummary();
    const types = result.map(r => r.changeType);
    expect(types).toContain('unchanged');
    expect(types).toContain('merged');
    expect(types).toContain('split');
    expect(types).toContain('new_boundary');
    expect(types).toContain('sliver');
  });

  test('throws on failed fetch', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404 }));
    await expect(loadBoundaryChangeSummary()).rejects.toThrow('Failed to load precinct metadata');
  });
});

describe('generateBoundaryTableHTML', () => {
  let changeData;

  beforeEach(async () => {
    changeData = await loadBoundaryChangeSummary();
  });

  test('renders table with all rows', () => {
    const html = generateBoundaryTableHTML(changeData);
    expect(html).toContain('<table class="boundary-table">');
    expect(html).toContain('Precinct');
    expect(html).toContain('Change Type');
    // Should have 6 data rows
    const rowMatches = html.match(/<tr>/g);
    // 1 header row + 6 data rows = 7 total <tr> elements
    expect(rowMatches.length).toBe(7);
  });

  test('counts change types correctly in filter dropdown', () => {
    const html = generateBoundaryTableHTML(changeData);
    // 2 unchanged, 1 merged, 1 split, 1 new_boundary, 1 sliver
    expect(html).toContain('Unchanged (2)');
    expect(html).toContain('Merged (1)');
    expect(html).toContain('Split (1)');
    expect(html).toContain('New (1)');
    expect(html).toContain('Sliver (1)');
  });

  test('filters by change type', () => {
    const html = generateBoundaryTableHTML(changeData, { changeType: 'split' });
    expect(html).toContain('Showing 1 of 6');
    // Should only have the split precinct
    expect(html).toContain('change-badge split');
  });

  test('returns empty message for empty data', () => {
    const html = generateBoundaryTableHTML([]);
    expect(html).toContain('No boundary change data available');
  });
});

describe('generateBoundaryStatsHTML', () => {
  test('shows all 5 stat cards', async () => {
    const changeData = await loadBoundaryChangeSummary();
    const html = generateBoundaryStatsHTML(changeData);
    expect(html).toContain('boundary-stats-grid');
    // Should have 5 stat cards
    const cardMatches = html.match(/boundary-stat-card/g);
    expect(cardMatches.length).toBe(5);
    expect(html).toContain('Unchanged');
    expect(html).toContain('Split');
    expect(html).toContain('Merged');
    expect(html).toContain('New');
    expect(html).toContain('Sliver');
  });

  test('counts are correct', async () => {
    const changeData = await loadBoundaryChangeSummary();
    const html = generateBoundaryStatsHTML(changeData);
    // 2 unchanged
    expect(html).toContain('>2<');
    // 1 merged, 1 split, 1 new, 1 sliver
    expect(html).toContain('>1<');
  });
});

describe('exportBoundaryCSV', () => {
  let createObjectURLMock;
  let revokeObjectURLMock;

  beforeEach(() => {
    createObjectURLMock = jest.fn(() => 'blob:test');
    revokeObjectURLMock = jest.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;
    global.Blob = jest.fn((content, options) => ({ content, options }));
  });

  test('creates CSV with correct headers', async () => {
    const changeData = await loadBoundaryChangeSummary();
    // Mock the link click
    const clickMock = jest.fn();
    jest.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickMock,
      style: {}
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    exportBoundaryCSV(changeData);

    expect(global.Blob).toHaveBeenCalled();
    const blobContent = global.Blob.mock.calls[0][0][0];
    const firstLine = blobContent.split('\n')[0];
    expect(firstLine).toContain('New Precinct');
    expect(firstLine).toContain('Change Type');
    expect(firstLine).toContain('Source Precincts');
    expect(firstLine).toContain('Source Weights');
    expect(firstLine).toContain('Data Quality');

    // Should have header + 6 data rows
    const lines = blobContent.split('\n');
    expect(lines.length).toBe(7);
  });

  test('does nothing for empty data', () => {
    exportBoundaryCSV([]);
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });
});
