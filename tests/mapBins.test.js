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
