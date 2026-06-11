// competitiveRanker.test.js
// Unit tests for the swing-precinct ranking engine — imports the REAL module
// (several older suites tested inline copies; don't repeat that pattern).
// Run with: node --experimental-vm-modules node_modules/jest/bin/jest.js tests/competitiveRanker.test.js

import { describe, it, expect } from '@jest/globals';
import {
  rankCompetitivePrecincts,
  generateRankerHTML,
  generateRankerCSV,
} from '../js/competitiveRanker.js';

const CANDIDATES = ['Rep Alice Smith', 'Dem Bob Jones'];

function row(code, repVotes, demVotes, registered = 1000, ballots = 500) {
  return {
    'PRECINCT CODE': code,
    'REGISTERED VOTERS TOTAL': registered,
    'BALLOTS CAST TOTAL': ballots,
    'Rep Alice Smith': repVotes,
    'Dem Bob Jones': demVotes,
  };
}

describe('rankCompetitivePrecincts', () => {
  it('returns empty array for invalid input', () => {
    expect(rankCompetitivePrecincts(null, CANDIDATES, {}, [])).toEqual([]);
    expect(rankCompetitivePrecincts([], null, {}, [])).toEqual([]);
    expect(rankCompetitivePrecincts([], ['only one'], {}, [])).toEqual([]);
  });

  it('sorts tightest margins first', () => {
    const data = [
      row('1', 300, 100), // margin 200
      row('2', 210, 200), // margin 10 — tightest
      row('3', 180, 120), // margin 60
    ];
    const ranked = rankCompetitivePrecincts(data, CANDIDATES, {}, []);
    expect(ranked.map((r) => r.precinctCode)).toEqual(['2', '3', '1']);
    expect(ranked[0].margin).toBe(10);
  });

  it('skips precincts with zero candidate votes (county-wide CSVs include non-participating precincts)', () => {
    const data = [row('1', 0, 0), row('2', 50, 40)];
    const ranked = rankCompetitivePrecincts(data, CANDIDATES, {}, []);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].precinctCode).toBe('2');
  });

  it('computes winner, margin percent, and turnout', () => {
    const data = [row('7', 150, 100, 1000, 250)];
    const [r] = rankCompetitivePrecincts(data, CANDIDATES, {}, []);
    expect(r.winner).toBe('Rep Alice Smith');
    expect(r.runnerUp).toBe('Dem Bob Jones');
    expect(r.winnerParty).toBe('Rep');
    expect(r.marginPct).toBe(20); // 50 of 250 votes
    expect(r.turnoutPct).toBe(25); // 250 of 1000
  });

  it('attaches census and feature context when available', () => {
    const profiles = {
      9: undefined,
      7: {
        population: 4200,
        income: { medianHousehold: 88000 },
        education: { bachelors: 0.3, graduateProfessional: 0.1 },
      },
    };
    const features = [
      { properties: { PRECINCT: '7', winningParty: 'Dem', partyStrength: 2, pct_hispanic: 0.25 } },
    ];
    const [r] = rankCompetitivePrecincts([row('7', 10, 9)], CANDIDATES, profiles, features);
    expect(r.population).toBe(4200);
    expect(r.medianIncome).toBe(88000);
    expect(r.collegePct).toBe(40);
    expect(r.hispanicPct).toBe(25);
    expect(r.partyLean).toBe('Dem');
  });
});

describe('generateRankerHTML', () => {
  it('renders cards for ranked precincts and respects the limit', () => {
    const ranked = rankCompetitivePrecincts(
      [row('1', 210, 200), row('2', 180, 120), row('3', 300, 100)],
      CANDIDATES, {}, []
    );
    const html = generateRankerHTML(ranked, 2);
    expect(html).toContain('Precinct 1');
    expect(html).toContain('Precinct 2');
    expect(html).not.toContain('Precinct 3');
  });

  it('escapes HTML in candidate names', () => {
    const data = [{
      'PRECINCT CODE': '5',
      'REGISTERED VOTERS TOTAL': 100,
      'BALLOTS CAST TOTAL': 50,
      'Rep <img src=x onerror=alert(1)>': 30,
      'Dem Safe Name': 20,
    }];
    const ranked = rankCompetitivePrecincts(
      data,
      ['Rep <img src=x onerror=alert(1)>', 'Dem Safe Name'],
      {}, []
    );
    const html = generateRankerHTML(ranked, 10);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('generateRankerCSV', () => {
  it('produces a header row plus one row per precinct', () => {
    const ranked = rankCompetitivePrecincts(
      [row('1', 210, 200), row('2', 180, 120)],
      CANDIDATES, {}, []
    );
    const csv = generateRankerCSV(ranked, 10);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].toLowerCase()).toContain('precinct');
  });

  it('escapes formula-injection attempts', () => {
    const data = [{
      'PRECINCT CODE': '=HYPERLINK("evil")',
      'REGISTERED VOTERS TOTAL': 100,
      'BALLOTS CAST TOTAL': 50,
      'Rep A': 30,
      'Dem B': 20,
    }];
    const ranked = rankCompetitivePrecincts(data, ['Rep A', 'Dem B'], {}, []);
    const csv = generateRankerCSV(ranked, 10);
    expect(csv).not.toMatch(/^=HYPERLINK/m);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});
