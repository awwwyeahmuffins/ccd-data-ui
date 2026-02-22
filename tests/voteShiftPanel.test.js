// voteShiftPanel.test.js
// Unit tests for vote shift panel functions

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock electionTrends.js
jest.unstable_mockModule('./electionTrends.js', () => ({
  computePrecinctDeltas: jest.fn(),
  TREND_COLORS: {
    swingDem: { light: '#D6EAF8', medium: '#6D9EEB', dark: '#27408B', default: '#00AEF3' },
    swingRep: { light: '#fc9a9a', medium: '#d13636', dark: '#630202', default: '#E81B23' },
    neutral: '#888888',
    flipped: '#FFD700',
    noData: '#f5f5f5'
  },
  getTrendColor: jest.fn(function mockGetTrendColor(delta) {
    if (delta == null || isNaN(delta)) return '#f5f5f5';
    if (Math.abs(delta) < 0.1) return '#888888';
    if (delta > 0) return '#00AEF3';
    return '#E81B23';
  }),
  getRaceKey: jest.fn()
}));

// Mock electionFilters.js
jest.unstable_mockModule('./electionFilters.js', () => ({
  formatElectionName: jest.fn(function mockFormat(f) {
    return f.replace(/\.csv$/, '').replace(/_/g, ' ');
  }),
  ELECTION_CATEGORIES: { ALL: 'All' },
  CATEGORY_ORDER: ['All'],
  ElectionFilterManager: jest.fn()
}));

// Mock exportCSV.js
jest.unstable_mockModule('./exportCSV.js', () => ({
  arrayToCSV: jest.fn(function mockArrayToCSV(rows) {
    if (!rows.length) return '';
    let keys = Object.keys(rows[0]);
    let header = keys.join(',');
    let body = rows.map(r => keys.map(k => r[k] ?? '').join(',')).join('\n');
    return header + '\n' + body;
  }),
  downloadCSV: jest.fn()
}));

// Dynamic imports after mocks
let computeFilteredShifts;
let generateShiftLeaderboardHTML;
let exportShiftCSV;
let getShiftMapStyleFunction;
let generateVoteShiftPanelHTML;
let computePrecinctDeltas;

beforeEach(async () => {
  jest.clearAllMocks();

  let trends = await import('./electionTrends.js');
  computePrecinctDeltas = trends.computePrecinctDeltas;

  let panel = await import('./voteShiftPanel.js');
  computeFilteredShifts = panel.computeFilteredShifts;
  generateShiftLeaderboardHTML = panel.generateShiftLeaderboardHTML;
  exportShiftCSV = panel.exportShiftCSV;
  getShiftMapStyleFunction = panel.getShiftMapStyleFunction;
  generateVoteShiftPanelHTML = panel.generateVoteShiftPanelHTML;
});

// ============================================================================
// Mock election data
// ============================================================================

function createMockDeltas() {
  return {
    '101': { delta: 5.0, margin1: 10, margin2: 15, flipped: false, winner1: 'Rep Smith', winner2: 'Rep Smith', votes1: 500, votes2: 600 },
    '102': { delta: -8.5, margin1: -5, margin2: -13.5, flipped: false, winner1: 'Dem Jones', winner2: 'Dem Jones', votes1: 400, votes2: 350 },
    '103': { delta: 12.0, margin1: -2, margin2: 10, flipped: true, winner1: 'Rep Smith', winner2: 'Dem Jones', votes1: 300, votes2: 320 },
    '104': { delta: -1.0, margin1: 3, margin2: 2, flipped: false, winner1: 'Rep Smith', winner2: 'Rep Smith', votes1: 200, votes2: 210 },
    '105': { delta: null, margin1: null, margin2: null, flipped: false, winner1: 'Rep Smith', winner2: null, votes1: 100, votes2: null, missing: 'year2' },
  };
}

function createMockElectionData(label) {
  return [
    { 'PRECINCT CODE': '101', 'REGISTERED VOTERS TOTAL': '1000', 'BALLOTS CAST TOTAL': '500', [`${label} Smith`]: '300', [`${label} Jones`]: '200' },
    { 'PRECINCT CODE': '102', 'REGISTERED VOTERS TOTAL': '800', 'BALLOTS CAST TOTAL': '400', [`${label} Smith`]: '150', [`${label} Jones`]: '250' },
    { 'PRECINCT CODE': '103', 'REGISTERED VOTERS TOTAL': '600', 'BALLOTS CAST TOTAL': '300', [`${label} Smith`]: '160', [`${label} Jones`]: '140' },
  ];
}

// ============================================================================
// TESTS FOR computeFilteredShifts
// ============================================================================

describe('computeFilteredShifts', () => {
  it('should filter by minDelta correctly', () => {
    let mockDeltas = createMockDeltas();
    computePrecinctDeltas.mockReturnValue(mockDeltas);

    let result = computeFilteredShifts([], [], [], [], { minDelta: 6 });

    // Only deltas with |delta| >= 6 should pass: 102 (8.5) and 103 (12.0)
    expect(Object.keys(result.filteredDeltas)).toHaveLength(2);
    expect(result.filteredDeltas['102']).toBeDefined();
    expect(result.filteredDeltas['103']).toBeDefined();
    expect(result.filteredDeltas['101']).toBeUndefined(); // 5.0 < 6
    expect(result.filteredDeltas['104']).toBeUndefined(); // 1.0 < 6
  });

  it('should filter direction=dem correctly (only positive deltas)', () => {
    let mockDeltas = createMockDeltas();
    computePrecinctDeltas.mockReturnValue(mockDeltas);

    let result = computeFilteredShifts([], [], [], [], { direction: 'dem' });

    // Only positive deltas: 101 (5.0) and 103 (12.0)
    expect(Object.keys(result.filteredDeltas)).toHaveLength(2);
    expect(result.filteredDeltas['101']).toBeDefined();
    expect(result.filteredDeltas['103']).toBeDefined();
    expect(result.filteredDeltas['102']).toBeUndefined(); // negative
    expect(result.filteredDeltas['104']).toBeUndefined(); // negative
  });

  it('should filter direction=rep correctly (only negative deltas)', () => {
    let mockDeltas = createMockDeltas();
    computePrecinctDeltas.mockReturnValue(mockDeltas);

    let result = computeFilteredShifts([], [], [], [], { direction: 'rep' });

    // Only negative deltas: 102 (-8.5) and 104 (-1.0)
    expect(Object.keys(result.filteredDeltas)).toHaveLength(2);
    expect(result.filteredDeltas['102']).toBeDefined();
    expect(result.filteredDeltas['104']).toBeDefined();
  });

  it('should compute summary stats correctly', () => {
    let mockDeltas = createMockDeltas();
    computePrecinctDeltas.mockReturnValue(mockDeltas);

    let result = computeFilteredShifts([], [], [], [], {});

    // 4 precincts with valid deltas (105 has null delta)
    expect(result.summary.precinctCount).toBe(4);
    expect(result.summary.flippedCount).toBe(1); // only 103 flipped
    expect(result.summary.totalPrecincts).toBe(4);

    // avgShift = (5.0 + -8.5 + 12.0 + -1.0) / 4 = 7.5 / 4 = 1.875
    expect(result.summary.avgShift).toBeCloseTo(1.875);

    // totalVoteChange = (600-500) + (350-400) + (320-300) + (210-200) = 100 + -50 + 20 + 10 = 80
    expect(result.summary.totalVoteChange).toBe(80);
  });

  it('should sort precincts by absolute delta descending', () => {
    let mockDeltas = createMockDeltas();
    computePrecinctDeltas.mockReturnValue(mockDeltas);

    let result = computeFilteredShifts([], [], [], [], {});

    expect(result.sortedPrecincts[0].code).toBe('103'); // |12.0|
    expect(result.sortedPrecincts[1].code).toBe('102'); // |8.5|
    expect(result.sortedPrecincts[2].code).toBe('101'); // |5.0|
    expect(result.sortedPrecincts[3].code).toBe('104'); // |1.0|
  });

  it('should combine minDelta and direction filters', () => {
    let mockDeltas = createMockDeltas();
    computePrecinctDeltas.mockReturnValue(mockDeltas);

    let result = computeFilteredShifts([], [], [], [], { minDelta: 3, direction: 'dem' });

    // Positive deltas with |delta| >= 3: 101 (5.0) and 103 (12.0)
    expect(Object.keys(result.filteredDeltas)).toHaveLength(2);
    expect(result.filteredDeltas['101']).toBeDefined();
    expect(result.filteredDeltas['103']).toBeDefined();
  });
});

// ============================================================================
// TESTS FOR exportShiftCSV
// ============================================================================

describe('exportShiftCSV', () => {
  it('should produce valid CSV with correct headers', () => {
    // Setup DOM mocks for export
    let mockLink = { click: jest.fn(), style: {} };
    let appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    let removeSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    jest.spyOn(document, 'createElement').mockReturnValue(mockLink);

    let capturedContent = null;
    let blobSpy = jest.spyOn(globalThis, 'Blob').mockImplementation(function MockBlob(parts) {
      capturedContent = parts[0];
    });

    // jsdom doesn't have URL.createObjectURL, so define them
    let origCreateObjectURL = URL.createObjectURL;
    let origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn().mockReturnValue('blob:test');
    URL.revokeObjectURL = jest.fn();

    let deltas = {
      '101': { delta: 5.0, margin1: 10, margin2: 15, flipped: false, winner1: 'Rep Smith', winner2: 'Rep Smith', votes1: 500, votes2: 600 },
      '102': { delta: -3.0, margin1: -5, margin2: -8, flipped: false, winner1: 'Dem Jones', winner2: 'Dem Jones', votes1: 400, votes2: 350 },
    };

    exportShiftCSV(deltas, 'test_export.csv');

    // Verify blob was created
    expect(blobSpy).toHaveBeenCalled();

    // Check headers in captured CSV content
    expect(capturedContent).toContain('Precinct');
    expect(capturedContent).toContain('Year1 Dem%');
    expect(capturedContent).toContain('Year2 Dem%');
    expect(capturedContent).toContain('Delta');
    expect(capturedContent).toContain('Direction');
    expect(capturedContent).toContain('Flipped');
    expect(capturedContent).toContain('Winner Year1');
    expect(capturedContent).toContain('Winner Year2');
    expect(capturedContent).toContain('Votes Year1');
    expect(capturedContent).toContain('Votes Year2');

    // Verify download was triggered
    expect(mockLink.download).toBe('test_export.csv');
    expect(mockLink.click).toHaveBeenCalled();

    // Cleanup
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    blobSpy.mockRestore();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });
});

// ============================================================================
// TESTS FOR getShiftMapStyleFunction
// ============================================================================

describe('getShiftMapStyleFunction', () => {
  it('should return correct color for positive delta (Dem shift)', () => {
    let deltas = {
      '101': { delta: 5.0, flipped: false }
    };

    let styleFn = getShiftMapStyleFunction(deltas);
    let style = styleFn({ properties: { PRECINCT: '101' } });

    // Positive delta -> blue (Dem) color
    expect(style.fillColor).toBe('#00AEF3');
    expect(style.fillOpacity).toBe(0.7);
  });

  it('should return correct color for negative delta (Rep shift)', () => {
    let deltas = {
      '102': { delta: -5.0, flipped: false }
    };

    let styleFn = getShiftMapStyleFunction(deltas);
    let style = styleFn({ properties: { PRECINCT: '102' } });

    // Negative delta -> red (Rep) color
    expect(style.fillColor).toBe('#E81B23');
  });

  it('should gray out precincts below magnitude threshold', () => {
    let deltas = {
      '101': { delta: 2.0, flipped: false }
    };

    let styleFn = getShiftMapStyleFunction(deltas, { minDelta: 5 });
    let style = styleFn({ properties: { PRECINCT: '101' } });

    // Below threshold -> grayed out
    expect(style.fillColor).toBe('#e0e0e0');
    expect(style.fillOpacity).toBe(0.2);
  });

  it('should add dashed border for flipped precincts', () => {
    let deltas = {
      '103': { delta: 12.0, flipped: true }
    };

    let styleFn = getShiftMapStyleFunction(deltas);
    let style = styleFn({ properties: { PRECINCT: '103' } });

    expect(style.dashArray).toBe('5, 5');
    expect(style.weight).toBe(3);
    expect(style.color).toBe('#FFD700'); // gold for flipped
  });

  it('should return no-data style for missing precincts', () => {
    let deltas = {};

    let styleFn = getShiftMapStyleFunction(deltas);
    let style = styleFn({ properties: { PRECINCT: '999' } });

    expect(style.fillColor).toBe('#f5f5f5');
    expect(style.fillOpacity).toBe(0.3);
  });

  it('should gray out filtered-out direction precincts', () => {
    let deltas = {
      '101': { delta: 5.0, flipped: false }
    };

    // Filter for Rep only -> positive (Dem) delta should be grayed out
    let styleFn = getShiftMapStyleFunction(deltas, { direction: 'rep' });
    let style = styleFn({ properties: { PRECINCT: '101' } });

    expect(style.fillColor).toBe('#e0e0e0');
    expect(style.fillOpacity).toBe(0.2);
  });
});

// ============================================================================
// TESTS FOR generateShiftLeaderboardHTML
// ============================================================================

describe('generateShiftLeaderboardHTML', () => {
  it('should respect limit parameter', () => {
    let precincts = [];
    for (let i = 0; i < 10; i++) {
      precincts.push({ code: String(100 + i), delta: (10 - i) * 1.5, flipped: false });
    }

    let html = generateShiftLeaderboardHTML(precincts, 3);

    // Count leaderboard items - should be exactly 3
    let itemCount = (html.match(/shift-leaderboard-item/g) || []).length;
    expect(itemCount).toBe(3);
  });

  it('should show all precincts when limit exceeds count', () => {
    let precincts = [
      { code: '101', delta: 5.0, flipped: false },
      { code: '102', delta: -3.0, flipped: false }
    ];

    let html = generateShiftLeaderboardHTML(precincts, 25);

    let itemCount = (html.match(/shift-leaderboard-item/g) || []).length;
    expect(itemCount).toBe(2);
  });

  it('should show "no data" message for empty array', () => {
    let html = generateShiftLeaderboardHTML([]);
    expect(html).toContain('No precincts match');
  });

  it('should use correct direction badges', () => {
    let precincts = [
      { code: '101', delta: 5.0, flipped: false },
      { code: '102', delta: -3.0, flipped: false }
    ];

    let html = generateShiftLeaderboardHTML(precincts);

    // Positive delta -> dem badge with "D"
    expect(html).toContain('shift-direction-badge dem');
    // Negative delta -> rep badge with "R"
    expect(html).toContain('shift-direction-badge rep');
  });

  it('should mark flipped precincts with asterisk', () => {
    let precincts = [
      { code: '103', delta: 12.0, flipped: true }
    ];

    let html = generateShiftLeaderboardHTML(precincts);
    expect(html).toContain('103 *');
  });
});

// ============================================================================
// TESTS FOR generateVoteShiftPanelHTML
// ============================================================================

describe('generateVoteShiftPanelHTML', () => {
  it('should generate HTML with required elements', () => {
    let elections = [
      { filename: 'governor_2024.csv', displayName: 'Governor 2024', year: 2024 },
      { filename: 'governor_2022.csv', displayName: 'Governor 2022', year: 2022 }
    ];

    let html = generateVoteShiftPanelHTML(elections);

    expect(html).toContain('Vote Shift Analysis');
    expect(html).toContain('trend-toggle');
    expect(html).toContain('trend-second-select');
    expect(html).toContain('shift-magnitude-slider');
    expect(html).toContain('shift-direction-select');
    expect(html).toContain('shift-export-btn');
    expect(html).toContain('shift-summary-bar');
    expect(html).toContain('shift-leaderboard');
  });
});
