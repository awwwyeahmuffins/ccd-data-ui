// swingScatter.test.js — ui/swingScatter: the Trends page's precinct swing
// chart. Covers the two things a broken chart would get silently wrong — the
// shared square domain that makes the no-change diagonal a true 45° line, and
// the exclusions that keep an unsupportable claim off the plot — plus the
// plain-language sentence shared by the chart, readout, and table.
import { describe, it, expect } from '@jest/globals';
import {
  swingDirection,
  describeSwing,
  computeExtent,
  ticksFor,
  plottableRows,
  swingScatterHTML,
} from '../js/ui/swingScatter.js';
import { SWING_EPSILON } from '../js/domain/trends.js';

const LABELS = { a: '2022', b: '2024' };

const point = (over = {}) => ({
  precinct: '42',
  marginA: -20,
  marginB: -10,
  swing: 10,
  flipped: false,
  tinyElectorate: false,
  votesA: 1000,
  votesB: 1200,
  raceCountA: 17,
  raceCountB: 18,
  ...over,
});

describe('swingDirection', () => {
  it('calls movement beyond the epsilon by its party', () => {
    expect(swingDirection(5)).toBe('dem');
    expect(swingDirection(-5)).toBe('rep');
  });

  it('treats movement inside the epsilon as flat', () => {
    expect(swingDirection(0)).toBe('flat');
    expect(swingDirection(SWING_EPSILON)).toBe('flat');
    expect(swingDirection(-SWING_EPSILON)).toBe('flat');
  });

  it('treats a missing swing as flat rather than throwing', () => {
    expect(swingDirection(null)).toBe('flat');
    expect(swingDirection(NaN)).toBe('flat');
  });
});

describe('describeSwing', () => {
  it('names both margins, the size of the move, and its direction', () => {
    const text = describeSwing(point(), LABELS);
    expect(text).toContain('Precinct 42');
    expect(text).toContain('R+20.0 in 2022');
    expect(text).toContain('R+10.0 in 2024');
    expect(text).toContain('10.0 points toward Democrats');
  });

  it('calls out a flip and which party took the lead', () => {
    const text = describeSwing(point({ marginA: -2, marginB: 3, swing: 5, flipped: true }), LABELS);
    expect(text).toContain('flipped to Democratic');
  });

  it('says a precinct is unchanged rather than inventing a direction', () => {
    expect(describeSwing(point({ swing: 0.2 }), LABELS)).toContain('essentially unchanged');
  });

  it('explains a precinct that only appears in one cycle', () => {
    const text = describeSwing(point({ marginB: null, swing: null }), LABELS);
    expect(text).toContain('only voted in 2022');
    expect(text).not.toContain('toward');
  });

  it('carries the tiny-electorate caveat in the sentence itself', () => {
    // The caveat must ride on the shared sentence so the chart's aria-label,
    // the readout, and the table cannot disagree about it.
    expect(describeSwing(point({ tinyElectorate: true }), LABELS)).toContain('Too few votes');
    expect(describeSwing(point(), LABELS)).not.toContain('Too few votes');
  });

  it('reads an exactly-tied margin as "even", not "D+0.0"', () => {
    expect(describeSwing(point({ marginA: 0 }), LABELS)).toContain('even in 2022');
  });
});

describe('computeExtent', () => {
  it('spans the data, not the full theoretical ±100', () => {
    const { lo, hi } = computeExtent([point({ marginA: -40, marginB: -30 }), point({ marginA: 10, marginB: 20 })]);
    expect(lo).toBeGreaterThan(-100);
    expect(hi).toBeLessThan(100);
    expect(lo).toBeLessThanOrEqual(-40);
    expect(hi).toBeGreaterThanOrEqual(20);
  });

  it('covers every plotted value, so no mark falls outside the axes', () => {
    const rows = [point({ marginA: -83, marginB: 44 })];
    const { lo, hi } = computeExtent(rows);
    expect(lo).toBeLessThanOrEqual(-83);
    expect(hi).toBeGreaterThanOrEqual(44);
  });

  it('falls back to a usable range for empty or degenerate input', () => {
    expect(computeExtent([])).toEqual({ lo: -10, hi: 10 });
    const flat = computeExtent([point({ marginA: 5, marginB: 5 })]);
    expect(flat.hi).toBeGreaterThan(flat.lo);
  });
});

describe('ticksFor', () => {
  it('always includes zero — the tipping point is the tick that matters', () => {
    expect(ticksFor({ lo: -83, hi: 44 })).toContain(0);
  });

  it('stays inside the domain and ascends', () => {
    const ticks = ticksFor({ lo: -83, hi: 44 });
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(-83);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(44);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('produces a readable number of ticks across a wide range', () => {
    const ticks = ticksFor({ lo: -100, hi: 100 });
    expect(ticks.length).toBeGreaterThan(3);
    expect(ticks.length).toBeLessThan(15);
  });
});

describe('plottableRows', () => {
  it('drops precincts with no comparison instead of pinning them at zero', () => {
    const rows = plottableRows([point(), point({ precinct: '7', swing: null, marginB: null })]);
    expect(rows.map((r) => r.precinct)).toEqual(['42']);
  });

  it('drops tiny electorates, whose percentages are noise', () => {
    const rows = plottableRows([point(), point({ precinct: '9', tinyElectorate: true })]);
    expect(rows.map((r) => r.precinct)).toEqual(['42']);
  });

  it('tolerates junk input', () => {
    expect(plottableRows(null)).toEqual([]);
  });
});

describe('swingScatterHTML', () => {
  const many = [
    point({ precinct: '1', marginA: -60, marginB: -55, swing: 5 }),
    point({ precinct: '2', marginA: 10, marginB: 2, swing: -8 }),
    point({ precinct: '3', marginA: -5, marginB: -4.9, swing: 0.1 }),
  ];

  it('keeps the plot area square so the no-change line is a true 45°', () => {
    // Both axes share one domain; equal pixel extents are what make the
    // diagonal meaningful. A non-square plot would silently tilt it.
    const svg = swingScatterHTML(many, { labels: LABELS, width: 760 });
    const [, , w, h] = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
    const plotW = w - 88 - 56;
    const plotH = h - 30 - 58;
    expect(plotW).toBeCloseTo(plotH, 6);
  });

  it('ignores a caller-supplied height rather than tilting the diagonal', () => {
    const a = swingScatterHTML(many, { labels: LABELS, width: 760 });
    const b = swingScatterHTML(many, { labels: LABELS, width: 760, height: 200 });
    expect(a).toBe(b);
  });

  it('encodes direction with shape, not colour alone', () => {
    const svg = swingScatterHTML(many, { labels: LABELS });
    expect(svg).toContain('sc-mark-dem');
    expect(svg).toContain('sc-mark-rep');
    expect(svg).toContain('sc-mark-flat');
    expect(svg).toContain('<polygon'); // triangles for the two directions
    expect(svg).toContain('<circle'); // and a circle for no real change
  });

  it('gives every mark a focusable role and a full-sentence label', () => {
    const svg = swingScatterHTML(many, { labels: LABELS });
    expect(svg.match(/role="img"/g)).toHaveLength(3);
    expect(svg).toContain('aria-label="Precinct 1:');
  });

  it('renders the selected precinct last so its ring is not overdrawn', () => {
    const svg = swingScatterHTML(many, { labels: LABELS, selected: '1' });
    const selectedAt = svg.indexOf('is-selected');
    const lastOther = Math.max(svg.lastIndexOf('data-precinct="2"'), svg.lastIndexOf('data-precinct="3"'));
    expect(selectedAt).toBeGreaterThan(lastOther);
  });

  it('escapes precinct codes into attributes', () => {
    const svg = swingScatterHTML([point({ precinct: '4"><script>' })], { labels: LABELS });
    expect(svg).not.toContain('<script>');
  });

  it('says so plainly when nothing can be plotted', () => {
    const svg = swingScatterHTML([point({ swing: null, marginB: null })], { labels: LABELS });
    expect(svg).toContain('nothing to plot');
    expect(svg).not.toContain('<svg');
  });
});
