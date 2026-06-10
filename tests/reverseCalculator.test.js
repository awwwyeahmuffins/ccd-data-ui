import { describe, it, expect, beforeEach, jest, beforeAll } from '@jest/globals';

let computeWinScenario, generateReverseCalculatorHTML;

beforeAll(async () => {
  // Use jest.unstable_mockModule before dynamic import to mock turnoutSimulator
  jest.unstable_mockModule('./turnoutSimulator.js', () => ({
    runFullSimulation: (...args) => global.__mockRunFullSimulation(...args)
  }));
  const mod = await import('./reverseCalculator.js');
  computeWinScenario = mod.computeWinScenario;
  generateReverseCalculatorHTML = mod.generateReverseCalculatorHTML;
});

describe('computeWinScenario', () => {
  let electionData, dncData, candidates;

  beforeEach(() => {
    electionData = [
      { 'PRECINCT CODE': '101', 'REGISTERED VOTERS TOTAL': 1000, 'BALLOTS CAST TOTAL': 500, 'Rep Alice': 300, 'Dem Bob': 200 },
      { 'PRECINCT CODE': '102', 'REGISTERED VOTERS TOTAL': 1000, 'BALLOTS CAST TOTAL': 500, 'Rep Alice': 250, 'Dem Bob': 250 }
    ];
    dncData = {
      '101': { Rep: 500, Dem: 300, Mod: 200 },
      '102': { Rep: 400, Dem: 400, Mod: 200 }
    };
    candidates = ['Rep Alice', 'Dem Bob'];
  });

  it('returns multiplier 1.0 when target already wins at baseline', () => {
    global.__mockRunFullSimulation = jest.fn(() => ({
      simulatedSummary: {
        winner: { name: 'Dem Bob', party: 'Dem', votes: 600 },
        candidateTotals: { 'Rep Alice': 400, 'Dem Bob': 600 }
      },
      flippedPrecincts: []
    }));

    let result = computeWinScenario(electionData, dncData, candidates, 'Dem');
    expect(result.achievable).toBe(true);
    expect(result.requiredMultiplier).toBe(1.0);
  });

  it('returns achievable=false when target never wins', () => {
    global.__mockRunFullSimulation = jest.fn(() => ({
      simulatedSummary: {
        winner: { name: 'Rep Alice', party: 'Rep', votes: 700 },
        candidateTotals: { 'Rep Alice': 700, 'Dem Bob': 300 }
      },
      flippedPrecincts: []
    }));

    let result = computeWinScenario(electionData, dncData, candidates, 'Dem');
    expect(result.achievable).toBe(false);
    expect(result.requiredMultiplier).toBe(1.5);
  });

  it('search converges correctly with mock data', () => {
    global.__mockRunFullSimulation = jest.fn((data, dnc, cands, multipliers) => {
      let demMult = multipliers.Dem || 1.0;
      let demWins = demMult >= 1.25;
      return {
        simulatedSummary: {
          winner: demWins
            ? { name: 'Dem Bob', party: 'Dem', votes: 550 }
            : { name: 'Rep Alice', party: 'Rep', votes: 550 },
          candidateTotals: demWins
            ? { 'Rep Alice': 450, 'Dem Bob': 550 }
            : { 'Rep Alice': 550, 'Dem Bob': 450 }
        },
        flippedPrecincts: demWins ? ['101'] : []
      };
    });

    let result = computeWinScenario(electionData, dncData, candidates, 'Dem');
    expect(result.achievable).toBe(true);
    expect(result.requiredMultiplier).toBe(1.25);
    expect(result.flippedPrecincts).toEqual(['101']);
  });

  it('returns safe defaults for null inputs', () => {
    let result = computeWinScenario(null, null, null, null);
    expect(result.achievable).toBe(false);
    expect(result.requiredMultiplier).toBe(1.5);
  });
});

describe('generateReverseCalculatorHTML', () => {
  let candidates = ['Rep Alice', 'Dem Bob'];

  it('shows dropdown and button in initial state (no result)', () => {
    let html = generateReverseCalculatorHTML(candidates);
    expect(html).toContain('reverse-party-select');
    expect(html).toContain('reverse-calculate-btn');
    expect(html).toContain('What do I need to win?');
  });

  it('shows correct text for achievable result', () => {
    let result = {
      achievable: true,
      requiredMultiplier: 1.27,
      projectedMargin: 1500,
      flippedPrecincts: ['101', '102'],
      scenario: { Rep: 1.0, Dem: 1.27, Mod: 1.0 }
    };
    let html = generateReverseCalculatorHTML(candidates, result);
    expect(html).toContain('achievable');
    expect(html).toContain('127%');
    expect(html).toContain('Democrats need 127% turnout to win county-wide');
  });

  it('shows correct text for not-achievable result', () => {
    let result = {
      achievable: false,
      requiredMultiplier: 1.5,
      projectedMargin: -2000,
      flippedPrecincts: ['101'],
      scenario: { Rep: 1.5, Dem: 1.0, Mod: 1.0 }
    };
    let html = generateReverseCalculatorHTML(candidates, result);
    expect(html).toContain('not-achievable');
    expect(html).toContain('Not achievable within 150% turnout range');
  });

  it('shows projected margin and flipped count for achievable result', () => {
    let result = {
      achievable: true,
      requiredMultiplier: 1.10,
      projectedMargin: 500,
      flippedPrecincts: ['101', '102', '103'],
      scenario: { Rep: 1.0, Dem: 1.10, Mod: 1.0 }
    };
    let html = generateReverseCalculatorHTML(candidates, result);
    expect(html).toContain('Projected margin');
    expect(html).toContain('Flipped precincts: 3');
  });
});

describe('computeWinScenario edge cases', () => {
  it('handles a summary with missing candidateTotals without producing NaN', () => {
    global.__mockRunFullSimulation = jest.fn(() => ({
      simulatedSummary: {
        winner: { name: 'Dem Bob', party: 'Dem', votes: 600 }
        // candidateTotals intentionally missing
      },
      flippedPrecincts: []
    }));

    const electionData = [
      { 'PRECINCT CODE': '101', 'REGISTERED VOTERS TOTAL': 1000, 'BALLOTS CAST TOTAL': 500, 'Rep Alice': 300, 'Dem Bob': 200 }
    ];
    const dncData = { '101': { Rep: 500, Dem: 300, Mod: 200 } };

    const result = computeWinScenario(electionData, dncData, ['Rep Alice', 'Dem Bob'], 'Dem');
    expect(Number.isNaN(result.projectedMargin ?? 0)).toBe(false);
    expect(result).toBeDefined();
  });
});
