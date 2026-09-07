// mapBins.test.js — bin edges, N/A handling, and the shared plain-language
// precinct formatter (the map's aria-labels, readout card, and List View all
// read from these — a drift here mis-labels the whole app).
import { describe, it, expect } from '@jest/globals';
import {
  MARGIN_BINS,
  DIVERSITY_BINS,
  binIndex,
  marginBin,
  diversityBin,
  describePrecinct,
  partyName,
  legendBins,
} from './mapBins.js';

describe('bin edges', () => {
  it('margin bins split at 5 / 15 / 30 / 50 points', () => {
    expect(marginBin(0)).toBe(0);
    expect(marginBin(0.049)).toBe(0);
    expect(marginBin(0.05)).toBe(1);
    expect(marginBin(0.149)).toBe(1);
    expect(marginBin(0.15)).toBe(2);
    expect(marginBin(0.3)).toBe(3);
    expect(marginBin(0.5)).toBe(4);
    expect(marginBin(0.99)).toBe(4);
    expect(marginBin(1)).toBe(4);
  });

  it('diversity bins are fixed 20-point steps', () => {
    expect(diversityBin(0.1)).toBe(0);
    expect(diversityBin(0.2)).toBe(1);
    expect(diversityBin(0.55)).toBe(2);
    expect(diversityBin(0.79)).toBe(3);
    expect(diversityBin(0.9)).toBe(4);
  });

  it('missing values never bin (N/A stays N/A — no fabricated data)', () => {
    expect(binIndex(null, MARGIN_BINS)).toBe(-1);
    expect(binIndex(undefined, MARGIN_BINS)).toBe(-1);
    expect(binIndex(NaN, DIVERSITY_BINS)).toBe(-1);
  });

  it('every bin has a plain name and an explicit numeric range', () => {
    for (const bins of [MARGIN_BINS, DIVERSITY_BINS]) {
      expect(bins.length).toBe(5);
      for (const b of bins) {
        expect(b.name.length).toBeGreaterThan(0);
        expect(b.range).toMatch(/\d/);
      }
    }
    expect(legendBins('margin').map((b) => b.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('partyName', () => {
  it('spells out party abbreviations (no jargon)', () => {
    expect(partyName('Rep')).toBe('Republican');
    expect(partyName('DEM')).toBe('Democratic');
    expect(partyName('Mod')).toContain('Moderate');
    expect(partyName(null)).toBe('Unknown');
  });
});

describe('describePrecinct', () => {
  const p = { PRECINCT: '42', winningParty: 'Rep', partyStrength: 3, demShare: 0.44, repShare: 0.52, pct_white: 0.62 };

  it('lean mode: party spelled out with strength in words', () => {
    expect(describePrecinct(p, { mode: 'lean' })).toBe('Precinct 42 — leans Republican (strong lean)');
  });

  it('margin mode: points + named bin + numeric range', () => {
    const s = describePrecinct(p, { mode: 'margin' });
    expect(s).toContain('Precinct 42');
    expect(s).toContain('8 points');
    expect(s).toContain('close');
    expect(s).toContain('5–15 points');
  });

  it('margin mode does not claim an election result (it is a model)', () => {
    // This mode reads dnc_scores.csv, a MODEL of partisan makeup. "decided by"
    // described a vote that never happened.
    const s = describePrecinct(p, { mode: 'margin' });
    expect(s).toContain('modeled');
    expect(s).not.toMatch(/decided by|won by/);
  });

  it('never prints a number that contradicts the bin it names', () => {
    // The fill is computed from the unrounded value, so a printed number that
    // rounds across the bin edge makes the sentence fight the map. Extra
    // precision alone does not fix it: 4.999 rounds to "5.0" at one decimal and
    // "5.00" at two, so the formatter must floor toward the bin.
    for (const pts of [4.9, 4.95, 4.98, 4.999, 14.97, 29.999, 49.995]) {
      const m = pts / 100;
      const s = describePrecinct({ PRECINCT: '7', demShare: 0.5 + m / 2, repShare: 0.5 - m / 2 }, { mode: 'margin' });
      const shown = Number(s.match(/split ([\d.]+) points/)[1]);
      const range = s.match(/\((.+)\)$/)[1];
      // the printed number must satisfy the range it is labelled with
      if (range === 'under 5 points') expect(shown).toBeLessThan(5);
      if (range === '5–15 points') { expect(shown).toBeGreaterThanOrEqual(5); expect(shown).toBeLessThan(15); }
      if (range === '15–30 points') { expect(shown).toBeGreaterThanOrEqual(15); expect(shown).toBeLessThan(30); }
      if (range === '30–50 points') { expect(shown).toBeGreaterThanOrEqual(30); expect(shown).toBeLessThan(50); }
    }
  });

  it('still prints a whole number when rounding does not cross a bin edge', () => {
    const s = describePrecinct({ PRECINCT: '7', demShare: 0.54, repShare: 0.46 }, { mode: 'margin' });
    expect(s).toContain('8 points');
  });

  it('diversity mode: percentage of residents', () => {
    expect(describePrecinct(p, { mode: 'diversity' })).toBe('Precinct 42 — 38% of residents are not white');
  });

  it('race view: winner, margin bin, and vote count', () => {
    const race = { partisan: true, byPrecinct: { 42: { winner: 'Dem', total: 5400, margin: 0.12 } } };
    const s = describePrecinct(p, { mode: 'lean', race });
    expect(s).toContain('Democratic won by 12 points');
    expect(s).toContain('close');
    expect(s).toContain('5,400 votes');
  });

  it('race view: non-partisan races name the candidate, not a party', () => {
    const race = { partisan: false, byPrecinct: { 42: { winner: 'SMITH', winnerName: 'Jane Smith', total: 900, margin: 0.4 } } };
    expect(describePrecinct(p, { mode: 'lean', race })).toContain('Jane Smith won');
  });

  it('race view: off-ballot precincts say so', () => {
    const race = { partisan: true, byPrecinct: {} };
    expect(describePrecinct(p, { mode: 'lean', race })).toBe('Precinct 42 — not on this ballot');
  });

  it('missing data renders N/A wording, never a fabricated value', () => {
    expect(describePrecinct({ PRECINCT: '9' }, { mode: 'lean' })).toContain('N/A');
    expect(describePrecinct({ PRECINCT: '9' }, { mode: 'margin' })).toContain('N/A');
    expect(describePrecinct({ PRECINCT: '9' }, { mode: 'diversity' })).toContain('N/A');
  });
});
