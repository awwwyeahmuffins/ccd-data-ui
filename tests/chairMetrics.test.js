/**
 * @jest-environment node
 *
 * chairMetrics.test.js — the chair dashboard's pure math: turnout bands,
 * the 3x3 universe matrix, the focus badge, the volunteer proxy, suspense
 * summaries/snippets, and vote-center geometry. Imports the REAL module.
 */
import { describe, it, expect } from '@jest/globals';
import {
  turnoutBands,
  buildUniverseMatrix,
  classifyChairFocus,
  estimateVolunteerPool,
  summarizeSuspense,
  suspenseDoorSnippet,
  featureCentroid,
  haversineMiles,
  nearestVoteCenters,
  MATRIX_PARTIES,
  MATRIX_BANDS,
} from '../js/domain/chairMetrics.js';
import { SOS_ADDRESS_CHANGE_URL } from '../js/lib/constants.js';

// ---------------------------------------------------------------------------
// turnoutBands
// ---------------------------------------------------------------------------
describe('turnoutBands', () => {
  it('decomposes two turnout files into high/mid/low that sum to 1', () => {
    const bands = turnoutBands({
      marquee: { registered: 1000, ballots: 700 },
      lowSalience: { registered: 950, ballots: 300 },
    });
    expect(bands.mode).toBe('two-file');
    expect(bands.high).toBeCloseTo(0.3, 5);
    expect(bands.mid).toBeCloseTo(0.4, 5);
    expect(bands.low).toBeCloseTo(0.3, 5);
    expect(bands.high + bands.mid + bands.low).toBeCloseTo(1, 5);
    expect(bands.marqueeRate).toBeCloseTo(0.7, 5);
  });

  it('degrades to the single-rate model with one turnout file', () => {
    const bands = turnoutBands({ marquee: { registered: 1000, ballots: 600 } });
    expect(bands.mode).toBe('single');
    expect(bands.high).toBeCloseTo(0.6, 5);
    expect(bands.mid).toBeCloseTo(0.4, 5);
    expect(bands.low).toBe(0);
  });

  it('clamps and renormalizes when low-salience ballots exceed the marquee', () => {
    const bands = turnoutBands({
      marquee: { registered: 100, ballots: 50 },
      lowSalience: { registered: 100, ballots: 80 }, // odd but must not break
    });
    expect(bands.mid).toBe(0); // negative clamped
    expect(bands.high + bands.mid + bands.low).toBeCloseTo(1, 5);
    expect(bands.high).toBeGreaterThanOrEqual(0);
    expect(bands.low).toBeGreaterThanOrEqual(0);
  });

  it('returns null without registered/ballots', () => {
    expect(turnoutBands({})).toBeNull();
    expect(turnoutBands({ marquee: { registered: 0, ballots: 0 } })).toBeNull();
    expect(turnoutBands({ marquee: { registered: 500 } })).toBeNull();
    expect(turnoutBands()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildUniverseMatrix
// ---------------------------------------------------------------------------
describe('buildUniverseMatrix', () => {
  const bands = turnoutBands({
    marquee: { registered: 1000, ballots: 700 },
    lowSalience: { registered: 1000, ballots: 300 },
  });
  const party = { dem: 400, mod: 300, rep: 300 };

  it('produces 9 cells covering every party x band pair', () => {
    const m = buildUniverseMatrix({ party, bands });
    expect(m.cells).toHaveLength(9);
    for (const p of MATRIX_PARTIES) {
      for (const b of MATRIX_BANDS) {
        expect(m.cells.filter((c) => c.party === p && c.band === b)).toHaveLength(1);
      }
    }
  });

  it('cell counts per party row sum to about the party total', () => {
    const m = buildUniverseMatrix({ party, bands });
    for (const p of MATRIX_PARTIES) {
      const rowSum = m.cells
        .filter((c) => c.party === p)
        .reduce((s, c) => s + c.count, 0);
      expect(Math.abs(rowSum - party[p])).toBeLessThanOrEqual(2); // rounding
      expect(m.totals[p]).toBe(rowSum);
    }
    expect(m.totals.all).toBe(m.totals.dem + m.totals.mod + m.totals.rep);
  });

  it('assigns the canvassing roles to the right cells', () => {
    const m = buildUniverseMatrix({ party, bands });
    const role = (p, b) => m.cells.find((c) => c.party === p && c.band === b).role;
    expect(role('dem', 'high')).toBe('base');
    expect(role('dem', 'mid')).toBe('gotv');
    expect(role('dem', 'low')).toBe('gotv');
    expect(role('mod', 'high')).toBe('persuasion');
    expect(role('mod', 'mid')).toBe('persuasion');
    expect(role('mod', 'low')).toBeNull();
    expect(role('rep', 'high')).toBeNull();
    // role totals = sums of their highlighted cells
    expect(m.roles.base).toBe(m.cells.find((c) => c.role === 'base').count);
    expect(m.roles.gotv).toBe(
      m.cells.filter((c) => c.role === 'gotv').reduce((s, c) => s + c.count, 0)
    );
  });

  it('returns null when party or bands are missing (never fabricates)', () => {
    expect(buildUniverseMatrix({ party: null, bands })).toBeNull();
    expect(buildUniverseMatrix({ party: {}, bands })).toBeNull();
    expect(buildUniverseMatrix({ party, bands: null })).toBeNull();
    expect(buildUniverseMatrix()).toBeNull();
  });

  it('a party bucket missing from the row yields null cells, not zeros', () => {
    const m = buildUniverseMatrix({ party: { dem: 100 }, bands });
    expect(m.cells.find((c) => c.party === 'rep' && c.band === 'high').count).toBeNull();
    expect(m.totals.rep).toBe(0);
    expect(m.totals.dem).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifyChairFocus
// ---------------------------------------------------------------------------
describe('classifyChairFocus', () => {
  const bands = { high: 0.3, mid: 0.2, low: 0.5, marqueeRate: 0.5, mode: 'two-file' };

  it('heavy Dem lean -> Turnout Focus', () => {
    const f = classifyChairFocus({
      party: { demShare: 0.5, repShare: 0.3, modShare: 0.2 },
      bands,
    });
    expect(f.id).toBe('turnout');
    expect(f.label).toBe('Turnout Focus');
    expect(f.rationale).toMatch(/20 points/);
  });

  it('tight margins -> Persuasion Focus', () => {
    const f = classifyChairFocus({
      party: { demShare: 0.36, repShare: 0.4, modShare: 0.24 },
      bands,
    });
    expect(f.id).toBe('persuasion');
    expect(f.label).toBe('Persuasion Focus');
  });

  it('heavy Rep lean -> Build & Register', () => {
    const f = classifyChairFocus({
      party: { demShare: 0.25, repShare: 0.55, modShare: 0.2 },
      bands,
    });
    expect(f.id).toBe('build');
  });

  it('returns null without party shares', () => {
    expect(classifyChairFocus({ party: null, bands })).toBeNull();
    expect(classifyChairFocus({ party: { demShare: 0.5 }, bands })).toBeNull();
    expect(classifyChairFocus()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// estimateVolunteerPool
// ---------------------------------------------------------------------------
describe('estimateVolunteerPool', () => {
  it('pool = strong Dems x high-propensity band, with a method label', () => {
    const v = estimateVolunteerPool({
      party: { dem: 400 },
      bands: { high: 0.3, mid: 0.4, low: 0.3 },
    });
    expect(v.pool).toBe(120);
    expect(v.method).toMatch(/vote in nearly every election/);
  });

  it('returns null without dem count or bands', () => {
    expect(estimateVolunteerPool({ party: {}, bands: { high: 0.3 } })).toBeNull();
    expect(estimateVolunteerPool({ party: { dem: 400 }, bands: null })).toBeNull();
    expect(estimateVolunteerPool()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// suspense
// ---------------------------------------------------------------------------
describe('summarizeSuspense', () => {
  it('summarizes a field_ops row', () => {
    const s = summarizeSuspense({ active: 900, suspense: 100 });
    expect(s.count).toBe(100);
    expect(s.activeCount).toBe(900);
    expect(s.share).toBeCloseTo(0.1, 5);
  });

  it('returns null when the suspense count is absent (suppressed cell or no file)', () => {
    expect(summarizeSuspense({ active: 900, suspense: '' })).toBeNull();
    expect(summarizeSuspense({ active: 900 })).toBeNull();
    expect(summarizeSuspense(null)).toBeNull();
  });
});

describe('suspenseDoorSnippet', () => {
  it('includes the SOS portal URL and the precinct count when known', () => {
    const text = suspenseDoorSnippet({
      code: '42',
      count: 1234,
      sosUrl: SOS_ADDRESS_CHANGE_URL,
    });
    expect(text).toContain(SOS_ADDRESS_CHANGE_URL);
    expect(text).toContain('Precinct 42');
    expect(text).toContain('1,234');
  });

  it('omits the count line when the count is unknown — never fabricates', () => {
    const text = suspenseDoorSnippet({ code: '42', count: null, sosUrl: SOS_ADDRESS_CHANGE_URL });
    expect(text).toContain(SOS_ADDRESS_CHANGE_URL);
    expect(text).not.toMatch(/About .* voters in this precinct/);
    expect(text).toMatch(/suspense/i);
  });

  it('returns null without a URL', () => {
    expect(suspenseDoorSnippet({ code: '42', count: 5 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------
describe('featureCentroid', () => {
  it('finds the center of a square Polygon', () => {
    const c = featureCentroid({
      type: 'Polygon',
      coordinates: [[[-96.7, 33.1], [-96.5, 33.1], [-96.5, 33.3], [-96.7, 33.3], [-96.7, 33.1]]],
    });
    expect(c.lng).toBeCloseTo(-96.6, 5);
    expect(c.lat).toBeCloseTo(33.2, 5);
  });

  it('picks the largest ring of a MultiPolygon', () => {
    const small = [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]];
    const big = [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]];
    const c = featureCentroid({ type: 'MultiPolygon', coordinates: [small, big] });
    expect(c.lng).toBeCloseTo(11, 5);
    expect(c.lat).toBeCloseTo(11, 5);
  });

  it('returns null for missing or unsupported geometry', () => {
    expect(featureCentroid(null)).toBeNull();
    expect(featureCentroid({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(featureCentroid({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});

describe('haversineMiles / nearestVoteCenters', () => {
  const mckinney = { lat: 33.1972, lng: -96.6398 };
  const plano = { lat: 33.0198, lng: -96.6989 };

  it('computes a plausible McKinney-Plano distance', () => {
    const miles = haversineMiles(mckinney, plano);
    expect(miles).toBeGreaterThan(10);
    expect(miles).toBeLessThan(16);
  });

  it('sorts centers by distance, skips bad coordinates, respects the limit', () => {
    const centers = [
      { name: 'Far', lat: 33.6, lng: -96.6 },
      { name: 'Near', lat: 33.2, lng: -96.64 },
      { name: 'Broken', lat: 'oops', lng: null },
      { name: 'Mid', lat: 33.05, lng: -96.7 },
    ];
    const out = nearestVoteCenters(mckinney, centers, 2);
    expect(out.map((c) => c.name)).toEqual(['Near', 'Mid']);
    expect(out[0].distanceMiles).toBeLessThan(out[1].distanceMiles);
  });

  it('returns [] when inputs are missing', () => {
    expect(nearestVoteCenters(null, [{ lat: 1, lng: 1 }])).toEqual([]);
    expect(nearestVoteCenters(mckinney, null)).toEqual([]);
  });
});
