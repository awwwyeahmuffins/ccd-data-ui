// listView.test.js — the linear (List) view's pure row model and sorts.
import { describe, it, expect } from '@jest/globals';
import { buildRows, sortRows, countLine, SORTS } from './listView.js';

const feat = (props) => ({ properties: props });
const FEATURES = [
  feat({ PRECINCT: '10', winningParty: 'Rep', partyStrength: 3, repShare: 0.6, demShare: 0.3, pct_white: 0.8, total: 4000 }),
  feat({ PRECINCT: '2', winningParty: 'Dem', repShare: 0.44, demShare: 0.48, pct_white: 0.3, total: 900 }),
  feat({ PRECINCT: '7' }), // no data at all
];

describe('buildRows', () => {
  it('uses the shared plain-language formatter for card text', () => {
    const rows = buildRows(FEATURES, { mode: 'lean' });
    expect(rows[0].text).toBe('Precinct 10 — leans Republican (strong lean)');
    expect(rows[2].text).toContain('N/A');
  });

  it('computes lean segments only when party data exists', () => {
    const rows = buildRows(FEATURES, { mode: 'lean' });
    expect(rows[0].lean).toEqual({ rep: 60, dem: 30, mod: 10 });
    expect(rows[2].lean).toBeNull();
  });

  it('marks off-ballot rows in a race view', () => {
    const race = { partisan: true, byPrecinct: { 10: { winner: 'Rep', total: 100, margin: 0.2 } } };
    const rows = buildRows(FEATURES, { mode: 'lean', race });
    expect(rows.find((r) => r.code === '10').onBallot).toBe(true);
    expect(rows.find((r) => r.code === '2').onBallot).toBe(false);
  });
});

describe('sortRows', () => {
  const rows = buildRows(FEATURES, { mode: 'lean' });

  it('sorts by precinct number by default', () => {
    expect(sortRows(rows, 'code').map((r) => r.code)).toEqual(['2', '7', '10']);
  });

  it('closest margin first, N/A rows last', () => {
    expect(sortRows(rows, 'margin').map((r) => r.code)).toEqual(['2', '10', '7']);
  });

  it('most diverse first, N/A last', () => {
    expect(sortRows(rows, 'diverse').map((r) => r.code)).toEqual(['2', '10', '7']);
  });

  it('largest population first, N/A last', () => {
    expect(sortRows(rows, 'population').map((r) => r.code)).toEqual(['10', '2', '7']);
  });

  it('off-ballot rows sink below on-ballot rows in a race view', () => {
    const race = { partisan: true, byPrecinct: { 10: { winner: 'Rep', total: 100, margin: 0.2 } } };
    const raceRows = buildRows(FEATURES, { mode: 'lean', race });
    const sorted = sortRows(raceRows, 'code');
    expect(sorted[0].code).toBe('10'); // the only on-ballot precinct leads
  });

  it('never mutates its input', () => {
    const before = rows.map((r) => r.code).join();
    sortRows(rows, 'population');
    expect(rows.map((r) => r.code).join()).toBe(before);
  });
});

describe('countLine', () => {
  it('states count and sort in plain words', () => {
    const rows = buildRows(FEATURES, { mode: 'lean' });
    expect(countLine(rows, 'margin')).toBe('3 precincts, sorted by closest margin first');
  });

  it('every sort option has a plain-language label', () => {
    for (const s of SORTS) expect(s.label.length).toBeGreaterThan(5);
  });
});
