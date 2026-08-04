// swingLayer.test.js — map/swingLayer: the Trends map's arrows, fills and key.
//
// The arrows are the map's whole reading, so the tests concentrate on the two
// ways they could lie: drawing an arrow a precinct hasn't earned, and sizing
// arrows so the loudest mark is the least consequential one.
import { describe, it, expect } from '@jest/globals';
import {
  swingFill,
  swingStyle,
  swingLegend,
  arrowSVG,
  arrowLength,
  makeArrowScale,
} from '../js/map/swingLayer.js';
import { SWING_EPSILON } from '../js/domain/trends.js';

const row = (over = {}) => ({
  precinct: '1', marginA: -20, marginB: -10, swing: 10, netVotes: 200,
  tinyElectorate: false, votesA: 900, votesB: 1000, ...over,
});

// No overlay SVG in jsdom, so patternFill falls back to the flat colour. That
// is the right thing to assert against here — the pattern wiring is covered by
// the e2e pass, which has a real Leaflet layer.
const env = { svg: null };

describe('swingFill', () => {
  it('marks a filtered-out precinct differently from one with no data', () => {
    // Same silence, different reasons: the user hid one, the data lacks the other.
    const hidden = swingFill(row(), env, false);
    const missing = swingFill(row({ swing: null }), env, true);
    expect(hidden).not.toBe(missing);
  });

  it('gives a tiny electorate its own mark rather than a band it has not earned', () => {
    const tiny = swingFill(row({ tinyElectorate: true }), env, true);
    const ordinary = swingFill(row(), env, true);
    const missing = swingFill(row({ swing: null }), env, true);
    expect(tiny).not.toBe(ordinary);
    expect(tiny).not.toBe(missing);
  });

  it('puts precincts that do have a swing on quiet paper — the arrows do the talking', () => {
    expect(swingFill(row({ swing: 30 }), env, true)).toBe(swingFill(row({ swing: -30 }), env, true));
  });
});

describe('swingStyle', () => {
  const feature = { properties: { PRECINCT: '7' } };
  const ctx = (over = {}) => ({ byPrecinct: { 7: row({ precinct: '7' }) }, visible: null, selected: null, env, ...over });

  it('raises and outlines the selected precinct', () => {
    const plain = swingStyle(feature, ctx());
    const chosen = swingStyle(feature, ctx({ selected: '7' }));
    expect(chosen.weight).toBeGreaterThan(plain.weight);
    expect(chosen.className).toBe('swing-selected');
  });

  it('fades a precinct the filters exclude', () => {
    const shown = swingStyle(feature, ctx({ visible: new Set(['7']) }));
    const hidden = swingStyle(feature, ctx({ visible: new Set(['9']) }));
    expect(hidden.fillOpacity).toBeLessThan(shown.fillOpacity);
  });

  it('tolerates a precinct with no row', () => {
    expect(() => swingStyle({ properties: {} }, ctx())).not.toThrow();
  });
});

describe('arrowSVG', () => {
  it('points UP for a Democratic move and DOWN for a Republican one', () => {
    // Direction is the arrow's own geometry, so the map survives greyscale.
    const up = arrowSVG(row({ swing: 12 }));
    const down = arrowSVG(row({ swing: -12 }));
    expect(up).toContain('<polygon');
    expect(down).toContain('<polygon');
    expect(up).not.toBe(down);
  });

  it('draws no arrow for movement inside the shared no-change epsilon', () => {
    expect(arrowSVG(row({ swing: SWING_EPSILON - 0.01 }))).toBe('');
    expect(arrowSVG(row({ swing: 0 }))).toBe('');
  });

  it('draws no arrow where the data cannot support one', () => {
    expect(arrowSVG(row({ swing: null }))).toBe('');
    expect(arrowSVG(row({ tinyElectorate: true, swing: 40 }))).toBe('');
    expect(arrowSVG(null)).toBe('');
  });

  it('honours a supplied scale', () => {
    const short = arrowSVG(row({ swing: 12 }), () => 12);
    const long = arrowSVG(row({ swing: 12 }), () => 40);
    expect(short).not.toBe(long);
  });
});

describe('arrowLength', () => {
  it('grows with the size of the move and then stops', () => {
    expect(arrowLength(20)).toBeGreaterThan(arrowLength(5));
    // Clamped, so one outlier cannot dominate the map.
    expect(arrowLength(200)).toBeCloseTo(arrowLength(25), 6);
  });

  it('is symmetric — direction is carried by the arrow, not its length', () => {
    expect(arrowLength(-12)).toBeCloseTo(arrowLength(12), 10);
  });
});

describe('makeArrowScale', () => {
  const rows = [
    row({ precinct: '1', swing: 40, netVotes: 4 }), // huge % move, trivial impact
    row({ precinct: '2', swing: 3, netVotes: 400 }), // small % move, real impact
  ];

  it('by impact, the consequential precinct gets the longer arrow', () => {
    // This is the whole point: a 40-point swing across a handful of ballots
    // must not out-shout a 3-point swing across thousands.
    const scale = makeArrowScale(rows, 'impact');
    expect(scale(rows[1])).toBeGreaterThan(scale(rows[0]));
  });

  it('by points, the percentage move wins instead', () => {
    const scale = makeArrowScale(rows, 'points');
    expect(scale(rows[0])).toBeGreaterThan(scale(rows[1]));
  });

  it('uses a percentile so one giant precinct cannot flatten the rest', () => {
    // Needs a realistic spread: with a handful of rows the outlier IS the 95th
    // percentile. Fifty ordinary precincts plus one enormous one.
    const ordinary = Array.from({ length: 50 }, (_, i) => row({ precinct: String(i), netVotes: 100 }));
    const scale = makeArrowScale(ordinary, 'impact');
    const withOutlier = makeArrowScale([...ordinary, row({ precinct: 'x', netVotes: 100000 })], 'impact');
    const sample = row({ netVotes: 100 });
    // A max-based scale would shrink every ordinary arrow to nothing here.
    expect(withOutlier(sample)).toBeCloseTo(scale(sample), 6);
    // …and the outlier itself is clamped rather than drawn off the map.
    expect(withOutlier(row({ netVotes: 100000 }))).toBeCloseTo(withOutlier(sample), 6);
  });

  it('degrades to a minimum length when nothing has impact', () => {
    const scale = makeArrowScale([row({ netVotes: 0 })], 'impact');
    expect(scale(row({ netVotes: 0 }))).toBeGreaterThan(0);
  });
});

describe('swingLegend', () => {
  const rows = [
    row({ precinct: '1', swing: 20 }),
    row({ precinct: '2', swing: 3 }),
    row({ precinct: '3', swing: -20 }),
    row({ precinct: '4', swing: 0 }),
    row({ precinct: '5', swing: 8, tinyElectorate: true }),
    row({ precinct: '6', swing: null }),
  ];

  it('counts by direction, with the strong moves as a sub-count', () => {
    const { bands } = swingLegend(rows);
    const dem = bands.find((b) => b.key === 'dem');
    expect(dem.count).toBe(2);
    expect(dem.strong).toBe(1);
    expect(bands.find((b) => b.key === 'rep').count).toBe(1);
    expect(bands.find((b) => b.key === 'flat').count).toBe(1);
  });

  it('keeps the two data silences separate and counted', () => {
    const { silences, tooFew, noComparison } = swingLegend(rows);
    expect(tooFew).toBe(1);
    expect(noComparison).toBe(1);
    expect(silences.map((s) => s.key)).toEqual(['too-few', 'no-comparison']);
  });

  it('omits a silence nobody is in', () => {
    const { silences } = swingLegend([row({ swing: 10 })]);
    expect(silences).toEqual([]);
  });

  it('never counts a tiny electorate inside a direction band', () => {
    // It has no arrow on the map, so claiming it in a band would overstate.
    const { bands } = swingLegend([row({ swing: 30, tinyElectorate: true })]);
    expect(bands.reduce((n, b) => n + b.count, 0)).toBe(0);
  });

  it('tolerates junk', () => {
    expect(() => swingLegend(null)).not.toThrow();
  });
});
