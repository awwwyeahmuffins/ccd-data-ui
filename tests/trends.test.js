// trends.test.js — domain/trends' two-party composite index and cycle-over-cycle
// swing: the math behind the Trends page's precinct swing scatter.
//
// The fixtures deliberately mix DEM/REP (the 2022 file convention) with Dem/Rep
// (the 2024 one) because the real data does, and a case-sensitive party check
// would silently produce an all-null index.
import { describe, it, expect } from '@jest/globals';
import {
  COMPOSITE_MIN_COVERAGE,
  SWING_EPSILON,
  TINY_ELECTORATE_PER_RACE,
  SWING_BINS,
  EMPTY_FILTERS,
  swingBin,
  buildPrimaryIndex,
  primaryYearsAvailable,
  filterSwingSeries,
  twoPartyColumns,
  twoPartyMargin,
  selectCompositeRaces,
  buildPartisanIndex,
  buildSwingSeries,
  summarizeSwing,
} from '../js/domain/trends.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// One pivoted race row. Votes are strings, matching the pivot's output.
const row = (code, votes) => ({
  'PRECINCT CODE': String(code),
  'REGISTERED VOTERS TOTAL': '1000',
  'BALLOTS CAST TOTAL': '600',
  ...Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, String(v)])),
});

// A statewide race: every precinct in `codes` votes in it.
function statewideRace(name, codes, votesFor) {
  const demCol = `DEM ${name} D`;
  const repCol = `REP ${name} R`;
  return {
    entry: { office: name, filename: `races/${name}.csv` },
    candidateCols: [demCol, repCol],
    rows: codes.map((c) => row(c, { [demCol]: votesFor(c).dem, [repCol]: votesFor(c).rep })),
  };
}

describe('twoPartyColumns', () => {
  it('buckets Dem and Rep columns regardless of prefix casing', () => {
    const { dem, rep } = twoPartyColumns([
      'DEM Beto O’Rourke',
      'Dem Kamala D. Harris/Tim Walz',
      'REP Greg Abbott',
      'Rep Donald J. Trump/JD Vance',
    ]);
    expect(dem).toHaveLength(2);
    expect(rep).toHaveLength(2);
  });

  it('excludes third parties and write-ins from both buckets', () => {
    const { dem, rep } = twoPartyColumns([
      'DEM Beto O’Rourke',
      'REP Greg Abbott',
      'LIB Mark Tippetts',
      'GRN Delilah Barrios',
      'W-I Someone',
    ]);
    expect(dem).toEqual(['DEM Beto O’Rourke']);
    expect(rep).toEqual(['REP Greg Abbott']);
  });

  it('tolerates a missing column list', () => {
    expect(twoPartyColumns(undefined)).toEqual({ dem: [], rep: [] });
  });
});

describe('twoPartyMargin', () => {
  const cols = ['DEM D', 'REP R', 'LIB L'];

  it('returns Dem-positive margin in percentage points', () => {
    // 600 D / 400 R -> (600-400)/1000 = +20 points
    const result = twoPartyMargin(row(1, { 'DEM D': 600, 'REP R': 400 }), cols);
    expect(result.margin).toBeCloseTo(20, 10);
    expect(result.demVotes).toBe(600);
    expect(result.repVotes).toBe(400);
  });

  it('returns a negative margin when Republicans lead', () => {
    expect(twoPartyMargin(row(1, { 'DEM D': 400, 'REP R': 600 }), cols).margin).toBeCloseTo(-20, 10);
  });

  it('excludes third-party votes from the denominator', () => {
    // With LIB in the denominator this would be (600-400)/1400 ≈ 14.3 points.
    const result = twoPartyMargin(row(1, { 'DEM D': 600, 'REP R': 400, 'LIB L': 400 }), cols);
    expect(result.margin).toBeCloseTo(20, 10);
    expect(result.demVotes + result.repVotes).toBe(1000);
  });

  it('parses mixed-case party prefixes the same way', () => {
    const mixed = ['Dem D', 'Rep R'];
    const result = twoPartyMargin(row(1, { 'Dem D': 300, 'Rep R': 100 }), mixed);
    expect(result.margin).toBeCloseTo(50, 10);
  });

  it('sums multiple columns of the same party', () => {
    const multi = ['DEM A', 'DEM B', 'REP C'];
    const result = twoPartyMargin(row(1, { 'DEM A': 100, 'DEM B': 100, 'REP C': 100 }), multi);
    expect(result.demVotes).toBe(200);
    expect(result.margin).toBeCloseTo(100 / 3, 10);
  });

  it('returns null when the precinct cast no two-party votes', () => {
    expect(twoPartyMargin(row(1, { 'DEM D': 0, 'REP R': 0, 'LIB L': 25 }), cols)).toBeNull();
  });

  it('returns null for a missing row rather than throwing', () => {
    expect(twoPartyMargin(null, cols)).toBeNull();
  });
});

describe('selectCompositeRaces', () => {
  const ALL = Array.from({ length: 100 }, (_, i) => i + 1);

  it('keeps a statewide race that covers nearly every precinct', () => {
    const race = statewideRace('Governor', ALL, () => ({ dem: 50, rep: 50 }));
    expect(selectCompositeRaces([race], 100)).toHaveLength(1);
  });

  it('rejects a district-limited race, which is the whole point of the filter', () => {
    // Mirrors State Representative District 33: ~18 of 273 precincts.
    const race = statewideRace('StateRep33', ALL.slice(0, 18), () => ({ dem: 50, rep: 50 }));
    expect(selectCompositeRaces([race], 100)).toHaveLength(0);
  });

  it('rejects a one-party race — no margin without an opponent', () => {
    const race = {
      entry: { office: 'Sheriff' },
      candidateCols: ['REP Jim Skinner'],
      rows: ALL.map((c) => row(c, { 'REP Jim Skinner': 500 })),
    };
    expect(selectCompositeRaces([race], 100)).toHaveLength(0);
  });

  it('counts a precinct as uncovered when it cast zero two-party votes', () => {
    // 90 precincts vote, 10 are on the ballot but cast nothing -> 0.90 coverage.
    const race = statewideRace('Governor', ALL, (c) =>
      c <= 90 ? { dem: 50, rep: 50 } : { dem: 0, rep: 0 }
    );
    expect(selectCompositeRaces([race], 100)).toHaveLength(0);
    expect(selectCompositeRaces([race], 100, 0.85)).toHaveLength(1);
  });

  it('reports the coverage it measured', () => {
    const race = statewideRace('Governor', ALL.slice(0, 96), () => ({ dem: 1, rep: 1 }));
    const [selected] = selectCompositeRaces([race], 100);
    expect(selected.coverage).toBeCloseTo(0.96, 10);
  });

  it('defaults to a threshold that admits statewide and excludes district races', () => {
    expect(COMPOSITE_MIN_COVERAGE).toBeGreaterThan(0.5);
    expect(COMPOSITE_MIN_COVERAGE).toBeLessThanOrEqual(1);
  });

  it('returns empty for junk input instead of throwing', () => {
    expect(selectCompositeRaces(null, 100)).toEqual([]);
    expect(selectCompositeRaces([], 0)).toEqual([]);
  });
});

describe('buildPartisanIndex', () => {
  it('averages each race equally rather than pooling votes', () => {
    // Race 1: tiny turnout, D+100. Race 2: huge turnout, D-100.
    // Equal weighting -> 0. Pooling votes would give roughly -96.
    const races = [
      { candidateCols: ['DEM A', 'REP B'], rows: [row(7, { 'DEM A': 10, 'REP B': 0 })] },
      { candidateCols: ['DEM C', 'REP D'], rows: [row(7, { 'DEM C': 0, 'REP D': 500 })] },
    ];
    const index = buildPartisanIndex(races);
    expect(index['7'].margin).toBeCloseTo(0, 10);
    expect(index['7'].raceCount).toBe(2);
    expect(index['7'].demVotes).toBe(10);
    expect(index['7'].repVotes).toBe(500);
  });

  it('only counts races a precinct actually voted in', () => {
    const races = [
      { candidateCols: ['DEM A', 'REP B'], rows: [row(1, { 'DEM A': 60, 'REP B': 40 })] },
      {
        candidateCols: ['DEM C', 'REP D'],
        rows: [row(1, { 'DEM C': 0, 'REP D': 0 }), row(2, { 'DEM C': 30, 'REP D': 70 })],
      },
    ];
    const index = buildPartisanIndex(races);
    expect(index['1'].raceCount).toBe(1);
    expect(index['1'].margin).toBeCloseTo(20, 10);
    expect(index['2'].raceCount).toBe(1);
    expect(index['2'].margin).toBeCloseTo(-40, 10);
  });

  it('skips rows with no precinct code', () => {
    const races = [
      {
        candidateCols: ['DEM A', 'REP B'],
        rows: [{ 'PRECINCT CODE': '', 'DEM A': '10', 'REP B': '5' }],
      },
    ];
    expect(buildPartisanIndex(races)).toEqual({});
  });

  it('returns empty for junk input', () => {
    expect(buildPartisanIndex(null)).toEqual({});
  });
});

describe('buildSwingSeries', () => {
  const indexA = { 1: { margin: -20, demVotes: 400, repVotes: 600, raceCount: 3 } };
  const indexB = { 1: { margin: -10, demVotes: 450, repVotes: 550, raceCount: 3 } };

  it('reports swing as later minus earlier, positive toward Dem', () => {
    const [p1] = buildSwingSeries(indexA, indexB);
    expect(p1.precinct).toBe('1');
    expect(p1.swing).toBeCloseTo(10, 10);
    expect(p1.votesA).toBe(1000);
    expect(p1.votesB).toBe(1000);
  });

  it('reports a negative swing when a precinct moves Republican', () => {
    const [p1] = buildSwingSeries(indexB, indexA);
    expect(p1.swing).toBeCloseTo(-10, 10);
  });

  it('marks a flip only when the leading party changes', () => {
    const before = { 5: { margin: -2, demVotes: 49, repVotes: 51, raceCount: 2 } };
    const after = { 5: { margin: 3, demVotes: 52, repVotes: 48, raceCount: 2 } };
    const [flip] = buildSwingSeries(before, after);
    expect(flip.flipped).toBe(true);

    // A 30-point swing that never crosses zero is movement, not a flip.
    const stayRep = { 5: { margin: -5, demVotes: 47, repVotes: 53, raceCount: 2 } };
    expect(buildSwingSeries(before, stayRep)[0].flipped).toBe(false);
  });

  it('keeps a one-cycle-only precinct with a null swing, never zero-filled', () => {
    const series = buildSwingSeries(indexA, {});
    expect(series).toHaveLength(1);
    expect(series[0].marginA).toBeCloseTo(-20, 10);
    expect(series[0].marginB).toBeNull();
    expect(series[0].swing).toBeNull();
    expect(series[0].flipped).toBe(false);
  });

  it('includes precincts that exist only in the later cycle', () => {
    const series = buildSwingSeries({}, indexB);
    expect(series[0].marginA).toBeNull();
    expect(series[0].swing).toBeNull();
  });

  it('sorts numerically, so precinct 10 follows precinct 9', () => {
    const wide = {};
    for (const c of [10, 2, 9, 1]) wide[c] = { margin: 0, demVotes: 1, repVotes: 1, raceCount: 1 };
    expect(buildSwingSeries(wide, wide).map((r) => r.precinct)).toEqual(['1', '2', '9', '10']);
  });

  it('tolerates null indices', () => {
    expect(buildSwingSeries(null, null)).toEqual([]);
  });

  // Collin really does have precincts casting one or two votes per contest,
  // where a single ballot reads as "100% Democratic" and would otherwise
  // stretch the chart's axes to ±100.
  describe('tiny electorates', () => {
    const thin = { 9: { margin: 100, demVotes: 17, repVotes: 0, raceCount: 17 } }; // 1 vote/race
    const thick = { 9: { margin: -12, demVotes: 4000, repVotes: 5000, raceCount: 18 } };

    it('flags a precinct whose per-race vote count is below the threshold', () => {
      const [row] = buildSwingSeries(thin, thick);
      expect(row.tinyElectorate).toBe(true);
      expect(row.votesPerRaceA).toBeCloseTo(1, 10);
    });

    it('measures votes PER RACE, not the composite total', () => {
      // 34 total votes looks respectable but is 2 per race across 17 contests.
      const twoPerRace = { 9: { margin: 100, demVotes: 34, repVotes: 0, raceCount: 17 } };
      expect(buildSwingSeries(twoPerRace, thick)[0].tinyElectorate).toBe(true);
    });

    it('leaves an ordinary precinct unflagged', () => {
      const ok = { 9: { margin: 5, demVotes: 900, repVotes: 800, raceCount: 17 } };
      expect(buildSwingSeries(ok, thick)[0].tinyElectorate).toBe(false);
    });

    it('flags when EITHER cycle is thin, not only the earlier one', () => {
      expect(buildSwingSeries(thick, thin)[0].tinyElectorate).toBe(true);
    });

    it('still reports the real margins and votes — flagged, never deleted', () => {
      const [row] = buildSwingSeries(thin, thick);
      expect(row.marginA).toBe(100);
      expect(row.votesA).toBe(17);
      expect(row.swing).toBeCloseTo(-112, 10);
    });

    it('uses a threshold in the same spirit as the Data Table', () => {
      expect(TINY_ELECTORATE_PER_RACE).toBeGreaterThan(0);
    });
  });
});

describe('summarizeSwing', () => {
  const series = [
    { precinct: '1', marginA: -20, marginB: -10, swing: 10, flipped: false, votesA: 100, votesB: 100 },
    { precinct: '2', marginA: -5, marginB: 5, swing: 10, flipped: true, votesA: 100, votesB: 100 },
    { precinct: '3', marginA: 10, marginB: -2, swing: -12, flipped: true, votesA: 100, votesB: 100 },
    { precinct: '4', marginA: 0, marginB: 0.1, swing: 0.1, flipped: false, votesA: 100, votesB: 100 },
    { precinct: '5', marginA: 3, marginB: null, swing: null, flipped: false, votesA: 100, votesB: null },
  ];

  it('counts only comparable precincts in the averages', () => {
    const s = summarizeSwing(series);
    expect(s.totalPrecincts).toBe(5);
    expect(s.comparablePrecincts).toBe(4);
    expect(s.meanSwing).toBeCloseTo((10 + 10 - 12 + 0.1) / 4, 10);
  });

  it('buckets direction using the noise epsilon', () => {
    const s = summarizeSwing(series);
    expect(s.towardDem).toBe(2);
    expect(s.towardRep).toBe(1);
    expect(s.unchanged).toBe(1); // the +0.1 pt precinct
    expect(SWING_EPSILON).toBeGreaterThan(0);
  });

  it('splits flips by which party ended up ahead', () => {
    const s = summarizeSwing(series);
    expect(s.flippedToDem).toBe(1); // precinct 2 ended D+5
    expect(s.flippedToRep).toBe(1); // precinct 3 ended R+2
  });

  it('weights the county-wide swing by votes', () => {
    const lopsided = [
      { precinct: '1', marginA: 0, marginB: 20, swing: 20, flipped: false, votesA: 10, votesB: 10 },
      { precinct: '2', marginA: 0, marginB: -2, swing: -2, flipped: false, votesA: 990, votesB: 990 },
    ];
    const s = summarizeSwing(lopsided);
    expect(s.meanSwing).toBeCloseTo(9, 10); // the typical precinct moved Dem
    expect(s.voteWeightedSwing).toBeLessThan(0); // the electorate moved Rep
  });

  it('returns nulls, not NaN, when nothing is comparable', () => {
    const s = summarizeSwing([{ precinct: '1', swing: null, marginA: 1, marginB: null }]);
    expect(s.comparablePrecincts).toBe(0);
    expect(s.meanSwing).toBeNull();
    expect(s.medianSwing).toBeNull();
    expect(s.voteWeightedSwing).toBeNull();
  });

  it('takes the median of an even-length set as the midpoint of the middle two', () => {
    const even = [10, 20, 30, 40].map((swing, i) => ({
      precinct: String(i),
      marginA: 0,
      marginB: swing,
      swing,
      flipped: false,
      votesA: 1,
      votesB: 1,
    }));
    expect(summarizeSwing(even).medianSwing).toBeCloseTo(25, 10);
  });

  it('tolerates junk input', () => {
    expect(summarizeSwing(null).comparablePrecincts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Primary participation — the page's second metric and its only three-cycle
// series. Shape must match buildPartisanIndex exactly so buildSwingSeries and
// summarizeSwing work on either metric with no branching.
// ---------------------------------------------------------------------------

describe('buildPrimaryIndex', () => {
  const turnout = {
    1: { 2022: { dem: 100, rep: 300 }, 2024: { dem: 200, rep: 200 } },
    2: { 2024: { dem: 0, rep: 0 } },
    3: { 2026: { dem: 90, rep: 10 } },
  };

  it('reads the margin as Dem minus Rep share of primary ballots', () => {
    // 100 D / 300 R -> (100-300)/400 = -50 points
    expect(buildPrimaryIndex(turnout, 2022)['1'].margin).toBeCloseTo(-50, 10);
    expect(buildPrimaryIndex(turnout, 2024)['1'].margin).toBeCloseTo(0, 10);
    expect(buildPrimaryIndex(turnout, 2026)['3'].margin).toBeCloseTo(80, 10);
  });

  it('emits the same shape as the general-election index', () => {
    const row = buildPrimaryIndex(turnout, 2022)['1'];
    expect(Object.keys(row).sort()).toEqual(['demVotes', 'margin', 'raceCount', 'repVotes']);
    // One "race" — the primary itself — so the per-race vote maths that drives
    // the tiny-electorate test stays meaningful.
    expect(row.raceCount).toBe(1);
  });

  it('skips a precinct that cast no primary ballots', () => {
    expect(buildPrimaryIndex(turnout, 2024)['2']).toBeUndefined();
  });

  it('accepts the year as a string or a number', () => {
    expect(buildPrimaryIndex(turnout, '2022')['1'].margin).toBeCloseTo(-50, 10);
  });

  it('returns empty for a year with no data, or junk input', () => {
    expect(buildPrimaryIndex(turnout, 2030)).toEqual({});
    expect(buildPrimaryIndex(null, 2022)).toEqual({});
  });

  it('feeds buildSwingSeries directly', () => {
    const series = buildSwingSeries(buildPrimaryIndex(turnout, 2022), buildPrimaryIndex(turnout, 2024));
    expect(series[0].swing).toBeCloseTo(50, 10); // -50 -> 0
  });
});

describe('primaryYearsAvailable', () => {
  it('lists the years present, ascending', () => {
    expect(primaryYearsAvailable({ 1: { 2024: {}, 2022: {} }, 2: { 2026: {} } })).toEqual([2022, 2024, 2026]);
  });

  it('tolerates junk', () => {
    expect(primaryYearsAvailable(null)).toEqual([]);
  });
});

describe('swingBin', () => {
  it('puts the no-change band exactly at the shared epsilon', () => {
    // The map's middle band MUST mean what the scatter's circle and the
    // summary's `unchanged` count mean — one threshold, three surfaces.
    expect(SWING_BINS[swingBin(0)].key).toBe('flat');
    expect(SWING_BINS[swingBin(SWING_EPSILON - 0.01)].key).toBe('flat');
    expect(SWING_BINS[swingBin(-SWING_EPSILON)].key).toBe('flat');
  });

  it('separates ordinary moves from strong ones', () => {
    expect(SWING_BINS[swingBin(5)].key).toBe('dem');
    expect(SWING_BINS[swingBin(25)].key).toBe('dem-strong');
    expect(SWING_BINS[swingBin(-5)].key).toBe('rep');
    expect(SWING_BINS[swingBin(-25)].key).toBe('rep-strong');
  });

  it('refuses to bin a missing swing — unknown is not unchanged', () => {
    expect(swingBin(null)).toBe(-1);
    expect(swingBin(NaN)).toBe(-1);
  });
});

describe('filterSwingSeries', () => {
  const row = (over) => ({
    precinct: '1', marginA: -20, marginB: -10, swing: 10, flipped: false,
    tinyElectorate: false, votesA: 900, votesB: 1000, ...over,
  });
  const series = [
    row({ precinct: '1', swing: 12, marginB: -8 }),
    row({ precinct: '2', swing: -12, marginA: 5, marginB: -7, flipped: true }),
    row({ precinct: '3', swing: 0.2, marginB: 40 }),
    row({ precinct: '4', swing: 5, tinyElectorate: true, votesB: 20 }),
    row({ precinct: '5', swing: null, marginB: null, votesB: null }),
  ];
  const codes = (rows) => rows.map((r) => r.precinct);

  it('keeps everything by default, including tiny electorates', () => {
    // They are flagged everywhere they appear, never deleted.
    expect(codes(filterSwingSeries(series))).toEqual(['1', '2', '3', '4', '5']);
    expect(EMPTY_FILTERS.includeTiny).toBe(true);
  });

  it('drops tiny electorates only when asked', () => {
    expect(codes(filterSwingSeries(series, { includeTiny: false }))).toEqual(['1', '2', '3', '5']);
  });

  it('filters by direction using the shared epsilon', () => {
    expect(codes(filterSwingSeries(series, { direction: 'dem' }))).toEqual(['1', '4']);
    expect(codes(filterSwingSeries(series, { direction: 'rep' }))).toEqual(['2']);
    expect(codes(filterSwingSeries(series, { direction: 'flat' }))).toEqual(['3']);
  });

  it('filters to flips', () => {
    expect(codes(filterSwingSeries(series, { flippedOnly: true }))).toEqual(['2']);
  });

  it('filters by a signed swing window', () => {
    expect(codes(filterSwingSeries(series, { swingMin: 1 }))).toEqual(['1', '4']);
    expect(codes(filterSwingSeries(series, { swingMax: 0 }))).toEqual(['2']);
    expect(codes(filterSwingSeries(series, { swingMin: -13, swingMax: -11 }))).toEqual(['2']);
  });

  it('filters to close races by absolute later-year margin', () => {
    expect(codes(filterSwingSeries(series, { maxAbsMarginB: 10 }))).toEqual(['1', '2', '4']);
  });

  it('filters by minimum votes cast', () => {
    expect(codes(filterSwingSeries(series, { minVotes: 100 }))).toEqual(['1', '2', '3']);
  });

  it('filters to an explicit precinct list, from a Set or an array', () => {
    expect(codes(filterSwingSeries(series, { precincts: new Set(['2', '3']) }))).toEqual(['2', '3']);
    expect(codes(filterSwingSeries(series, { precincts: [1, 4] }))).toEqual(['1', '4']);
  });

  it('drops no-comparison precincts as soon as any filter is a question about movement', () => {
    // Precinct 5 has no swing to test, so it cannot satisfy — or refute — a
    // movement filter. It survives only the untouched default.
    expect(codes(filterSwingSeries(series))).toContain('5');
    expect(codes(filterSwingSeries(series, { direction: 'dem' }))).not.toContain('5');
    expect(codes(filterSwingSeries(series, { swingMin: -999 }))).not.toContain('5');
    // …but the tiny toggle alone is not such a question.
    expect(codes(filterSwingSeries(series, { includeTiny: false }))).toContain('5');
  });

  it('stacks filters', () => {
    expect(codes(filterSwingSeries(series, { direction: 'dem', minVotes: 100 }))).toEqual(['1']);
  });

  it('preserves the original order', () => {
    expect(codes(filterSwingSeries(series, { minVotes: 0 }))).toEqual(['1', '2', '3', '4']);
  });

  it('tolerates junk input', () => {
    expect(filterSwingSeries(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Impact and the two bases. Percentage swing alone is misleading — a 40-point
// move across ten ballots and a 4-point move across four thousand look the same
// in points and nothing alike in consequence — and a margin is a ratio, so it
// hides a base that grew while the other grew faster.
// ---------------------------------------------------------------------------

describe('net votes and per-party bases', () => {
  // One race per cycle keeps the arithmetic checkable by eye.
  const idx = (dem, rep) => ({ 1: { margin: ((dem - rep) / (dem + rep)) * 100, demVotes: dem, repVotes: rep, raceCount: 1 } });

  it('reports net votes as the change in the Dem-minus-Rep gap', () => {
    // gap 100-300 = -200; gap 400-500 = -100 -> +100 net toward Dem
    const [row] = buildSwingSeries(idx(100, 300), idx(400, 500));
    expect(row.netVotes).toBeCloseTo(100, 10);
  });

  it('separates each base so a growing base is visible behind a losing margin', () => {
    // Dem +300 and Rep +500: the base grew, the margin moved Republican.
    const [row] = buildSwingSeries(idx(1000, 1000), idx(1300, 1500));
    expect(row.demChange).toBeCloseTo(300, 10);
    expect(row.repChange).toBeCloseTo(500, 10);
    expect(row.swing).toBeLessThan(0);
    expect(row.demGrewButMovedRep).toBe(true);
    expect(row.repGrewButMovedDem).toBe(false);
  });

  it('flags the mirror image too', () => {
    const [row] = buildSwingSeries(idx(1000, 1000), idx(1500, 1300));
    expect(row.repChange).toBeCloseTo(300, 10);
    expect(row.swing).toBeGreaterThan(0);
    expect(row.repGrewButMovedDem).toBe(true);
  });

  it('averages per race so the composite and a primary stay comparable', () => {
    // 17 races' worth of votes must not read as 17x one primary's.
    const many = { 1: { margin: 0, demVotes: 1700, repVotes: 1700, raceCount: 17 } };
    const one = { 1: { margin: 0, demVotes: 150, repVotes: 100, raceCount: 1 } };
    const [row] = buildSwingSeries(many, one);
    expect(row.demA).toBeCloseTo(100, 10); // 1700 / 17
    expect(row.demChange).toBeCloseTo(50, 10);
    expect(row.repChange).toBeCloseTo(0, 10);
  });

  it('leaves impact null when there is no comparison', () => {
    const [row] = buildSwingSeries(idx(100, 100), {});
    expect(row.netVotes).toBeNull();
    expect(row.demChange).toBeNull();
    expect(row.demGrewButMovedRep).toBe(false);
  });

  it('distinguishes a big percentage move from a consequential one', () => {
    // Ten ballots swinging hard vs four thousand nudging.
    const [tiny] = buildSwingSeries(idx(2, 8), idx(8, 2));
    const [big] = buildSwingSeries(idx(2000, 2000), idx(2060, 1940));
    expect(Math.abs(tiny.swing)).toBeGreaterThan(Math.abs(big.swing));
    expect(Math.abs(tiny.netVotes)).toBeLessThan(Math.abs(big.netVotes));
  });
});

describe('summarizeSwing — impact totals', () => {
  const series = [
    { precinct: '1', swing: -5, netVotes: -100, demChange: 300, repChange: 400, demGrewButMovedRep: true, repGrewButMovedDem: false, marginA: 0, marginB: -5, flipped: false, votesA: 1, votesB: 1 },
    { precinct: '2', swing: 5, netVotes: 60, demChange: 100, repChange: 40, demGrewButMovedRep: false, repGrewButMovedDem: true, marginA: 0, marginB: 5, flipped: false, votesA: 1, votesB: 1 },
    { precinct: '3', swing: null, netVotes: null, demChange: null, repChange: null, demGrewButMovedRep: false, repGrewButMovedDem: false, marginA: 1, marginB: null, flipped: false, votesA: 1, votesB: null },
  ];

  it('sums votes so the county total is just the sum of its precincts', () => {
    const s = summarizeSwing(series);
    expect(s.netVotes).toBeCloseTo(-40, 10);
    expect(s.demChange).toBeCloseTo(400, 10);
    expect(s.repChange).toBeCloseTo(440, 10);
    // The decomposition that makes the measure trustworthy.
    expect(s.demChange - s.repChange).toBeCloseTo(s.netVotes, 10);
  });

  it('counts the precincts whose base grew against the margin', () => {
    const s = summarizeSwing(series);
    expect(s.demGrewButMovedRep).toBe(1);
    expect(s.repGrewButMovedDem).toBe(1);
    expect(s.demBaseGrew).toBe(2);
  });

  it('returns zeroes, not NaN, when nothing is comparable', () => {
    const s = summarizeSwing([series[2]]);
    expect(s.netVotes).toBe(0);
    expect(s.demGrewButMovedRep).toBe(0);
  });
});

describe('filterSwingSeries — impact and base filters', () => {
  const r = (over) => ({ precinct: '1', marginA: 0, marginB: -5, swing: -5, flipped: false, tinyElectorate: false, votesA: 100, votesB: 100, netVotes: -50, demChange: 10, repChange: 60, demGrewButMovedRep: true, repGrewButMovedDem: false, ...over });
  const series = [
    r({ precinct: '1' }),
    r({ precinct: '2', netVotes: -5, demChange: -20, repChange: 10, demGrewButMovedRep: false }),
    r({ precinct: '3', netVotes: 400, swing: 6, demChange: 500, repChange: 100, demGrewButMovedRep: false }),
  ];
  const codes = (rows) => rows.map((x) => x.precinct);

  it('filters by impact, not by percentage', () => {
    expect(codes(filterSwingSeries(series, { minNetVotes: 50 }))).toEqual(['1', '3']);
  });

  it('keeps big movers in BOTH directions at a given impact threshold', () => {
    // Measured on the absolute value, so the threshold can't quietly favour a party.
    const kept = filterSwingSeries(series, { minNetVotes: 40 });
    expect(kept.some((x) => x.netVotes < 0)).toBe(true);
    expect(kept.some((x) => x.netVotes > 0)).toBe(true);
  });

  it('filters to precincts whose Democratic base grew or shrank', () => {
    expect(codes(filterSwingSeries(series, { base: 'dem-grew' }))).toEqual(['1', '3']);
    expect(codes(filterSwingSeries(series, { base: 'dem-shrank' }))).toEqual(['2']);
  });

  it('isolates the case the margin hides: base grew, precinct still moved Rep', () => {
    expect(codes(filterSwingSeries(series, { base: 'dem-grew-moved-rep' }))).toEqual(['1']);
  });
});
