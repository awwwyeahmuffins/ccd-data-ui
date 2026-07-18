// matchup.test.js — domain/matchup, the general-election matchup projector:
// office pairing across the 2026 primaries, county-wide primary leaders,
// two-candidate synthesis from a baseline general, participation scoping,
// and the sim-result → map-env conversion.
import { describe, it, expect } from '@jest/globals';
import {
  OFFICE_ALIASES,
  canonicalOffice,
  pairPrimaryOffices,
  primaryField,
  synthesizeMatchup,
  matchupParticipation,
  toRaceEnvByPrecinct,
  countyHeadline,
} from '../js/domain/matchup.js';
import { runFullSimulation } from '../js/domain/simulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const entry = (office, year = 2026, category = 'State', extra = {}) => ({
  office,
  year,
  category,
  filename: `races/${office.replace(/\s+/g, '_')}_${year}.csv`,
  raceKey: office.toLowerCase().replace(/\s+/g, '-') + `-${year}`,
  ...extra,
});

function manifestFixture() {
  return [
    entry('DEM Governor'),
    entry('REP Governor'),
    entry('DEM US Senator', 2026, 'Federal'),
    entry('REP US Senator', 2026, 'Federal'),
    entry('DEM County Judge', 2026, 'County'),
    entry('REP County Judge', 2026, 'County'),
    entry('DEM Attorney General'),
    entry('REP Attorney General'),
    // Alias mismatch: different strings on the two ballots, same office.
    entry('DEM Commissioner of the General Land Office'),
    entry('REP Commissioner General Land Office'),
    // Party-internal contests — excluded even though both parties ran them.
    entry('DEM Proposition 3'),
    entry('REP Proposition 3'),
    entry('DEM County Chair', 2026, 'County'),
    entry('REP County Chair', 2026, 'County'),
    entry('REP Precinct Chair No 42', 2026, 'County'),
    // One-sided primaries — unpairable.
    entry('REP District Clerk', 2026, 'County'),
    // Historical general on the same boundary set — not a 2026 primary.
    entry('Governor', 2022),
  ];
}

// Pivoted-row fixture builder: values stay strings like the real pivot.
const row = (code, cols, meta = {}) => ({
  'PRECINCT CODE': String(code),
  'REGISTERED VOTERS TOTAL': meta.registered ?? '1000',
  'BALLOTS CAST TOTAL': meta.ballots ?? '500',
  ...Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, String(v)])),
});

describe('canonicalOffice', () => {
  it('strips the DEM/REP ballot prefix', () => {
    expect(canonicalOffice('DEM Governor')).toBe('Governor');
    expect(canonicalOffice('REP US Senator')).toBe('US Senator');
  });

  it('applies both known office-name aliases', () => {
    expect(canonicalOffice('REP Commissioner General Land Office')).toBe(
      'Commissioner of the General Land Office'
    );
    expect(canonicalOffice('REP Justice Supreme Court Place 2 Unexpired Term')).toBe(
      'Justice Supreme Court Place 2 Unexpired'
    );
    // Alias map covers exactly the variants we know about.
    expect(Object.keys(OFFICE_ALIASES)).toHaveLength(2);
  });

  it('is null-safe', () => {
    expect(canonicalOffice(null)).toBeNull();
    expect(canonicalOffice(undefined)).toBeNull();
  });
});

describe('pairPrimaryOffices', () => {
  const pairs = pairPrimaryOffices(manifestFixture());
  const offices = pairs.map((p) => p.office);

  it('pairs offices with both a DEM and REP 2026 primary, including aliases', () => {
    expect(offices).toContain('Governor');
    expect(offices).toContain('US Senator');
    expect(offices).toContain('Commissioner of the General Land Office');
    const land = pairs.find((p) => p.office === 'Commissioner of the General Land Office');
    expect(land.dem.office).toBe('DEM Commissioner of the General Land Office');
    expect(land.rep.office).toBe('REP Commissioner General Land Office');
  });

  it('excludes party-internal contests and one-sided primaries', () => {
    expect(offices).not.toContain('Proposition 3');
    expect(offices).not.toContain('County Chair');
    expect(offices.some((o) => o.startsWith('Precinct Chair'))).toBe(false);
    expect(offices).not.toContain('District Clerk'); // REP only
  });

  it('ignores non-primary (historical) entries even for the same office name', () => {
    // 'Governor' pairs from the two 2026 primaries, not the 2022 general.
    const gov = pairs.find((p) => p.office === 'Governor');
    expect(gov.dem.year).toBe(2026);
    expect(gov.rep.year).toBe(2026);
  });

  it('sorts marquee contests first, then by category', () => {
    // Governor before US Senator (both marquee, Governor ranks higher);
    // County Judge (County, non-marquee) last.
    expect(offices.indexOf('Governor')).toBeLessThan(offices.indexOf('US Senator'));
    expect(offices.indexOf('US Senator')).toBeLessThan(offices.indexOf('County Judge'));
  });

  it('is empty for missing/invalid input', () => {
    expect(pairPrimaryOffices(null)).toEqual([]);
    expect(pairPrimaryOffices([])).toEqual([]);
  });
});

describe('primaryField', () => {
  const rows = [
    row(1, { 'DEM Andrew White': 28, 'DEM Bobby Cole': 24 }),
    row(2, { 'DEM Andrew White': 2, 'DEM Bobby Cole': 10 }),
  ];
  const cols = ['DEM Andrew White', 'DEM Bobby Cole'];

  it('sums string vote values across precincts and ranks by votes', () => {
    const field = primaryField(rows, cols);
    expect(field[0]).toEqual({ column: 'DEM Bobby Cole', name: 'Bobby Cole', votes: 34, share: 34 / 64 });
    expect(field[1].name).toBe('Andrew White');
    expect(field[1].votes).toBe(30);
  });

  it('keeps alphabetical order on ties (stable sort = first-max rule)', () => {
    const tied = primaryField([row(1, { 'DEM Aaa Bbb': 5, 'DEM Zzz Yyy': 5 })], ['DEM Aaa Bbb', 'DEM Zzz Yyy']);
    expect(tied[0].column).toBe('DEM Aaa Bbb');
  });

  it('is empty-safe and zero-vote-safe', () => {
    expect(primaryField(null, cols)).toEqual([]);
    expect(primaryField(rows, null)).toEqual([]);
    const zero = primaryField([row(1, { 'DEM A B': 0 })], ['DEM A B']);
    expect(zero[0].share).toBe(0);
  });
});

describe('synthesizeMatchup', () => {
  it('folds uppercase (2022-style) party columns into two candidate columns', () => {
    const baseRows = [
      row(1, { "DEM Beto O'Rourke": 300, 'REP Greg Abbott': 400, 'LIB Mark Tippetts': 10 }),
    ];
    const cols = ["DEM Beto O'Rourke", 'REP Greg Abbott', 'LIB Mark Tippetts'];
    const synth = synthesizeMatchup(baseRows, cols, 'Nom D', 'Nom R');
    expect(synth.candidates).toEqual(['DEM Nom D', 'REP Nom R']);
    expect(synth.rows[0]['DEM Nom D']).toBe('300');
    expect(synth.rows[0]['REP Nom R']).toBe('400');
    expect(synth.otherVotes).toBe(10);
    expect(synth.twoPartyVotes).toBe(700);
  });

  it('folds mixed-case (2024-style) party columns, incl. fused tickets', () => {
    const baseRows = [
      row(7, { 'Dem Kamala D. Harris/Tim Walz': 120, 'Rep Donald J. Trump/JD Vance': 150, 'Grn Jill Stein': 3 }),
    ];
    const cols = ['Dem Kamala D. Harris/Tim Walz', 'Rep Donald J. Trump/JD Vance', 'Grn Jill Stein'];
    const synth = synthesizeMatchup(baseRows, cols, 'Nom D', 'Nom R');
    expect(synth.rows[0]['DEM Nom D']).toBe('120');
    expect(synth.rows[0]['REP Nom R']).toBe('150');
    expect(synth.otherVotes).toBe(3);
  });

  it('copies turnout metadata verbatim so the non-voter pool stays honest', () => {
    const baseRows = [row(1, { 'DEM A B': 1, 'REP C D': 2 }, { registered: '2639', ballots: '871' })];
    const synth = synthesizeMatchup(baseRows, ['DEM A B', 'REP C D'], 'X', 'Y');
    expect(synth.rows[0]['REGISTERED VOTERS TOTAL']).toBe('2639');
    expect(synth.rows[0]['BALLOTS CAST TOTAL']).toBe('871');
  });

  it('sets aside party-less columns (write-ins) as otherVotes', () => {
    const baseRows = [row(1, { 'DEM A B': 5, 'REP C D': 6, 'Write-in': 2 })];
    const synth = synthesizeMatchup(baseRows, ['DEM A B', 'REP C D', 'Write-in'], 'X', 'Y');
    expect(synth.otherVotes).toBe(2);
    expect(Object.keys(synth.rows[0])).not.toContain('Write-in');
  });

  it('propagates emptiness — no rows, no names, no columns', () => {
    expect(synthesizeMatchup([], [], 'X', 'Y')).toEqual({ rows: [], candidates: [], otherVotes: 0, twoPartyVotes: 0 });
    expect(synthesizeMatchup(null, null, 'X', 'Y').rows).toEqual([]);
    expect(synthesizeMatchup([row(1, { 'DEM A B': 5 })], ['DEM A B'], '', 'Y').rows).toEqual([]);
  });
});

describe('matchupParticipation', () => {
  it('marks a precinct in-scope on candidate votes in EITHER primary', () => {
    const dem = [row(1, { 'DEM A B': 3 }), row(2, { 'DEM A B': 0 })];
    const rep = [row(2, { 'REP C D': 1 }), row(3, { 'REP C D': 0 })];
    const set = matchupParticipation(dem, ['DEM A B'], rep, ['REP C D']);
    expect(set).toEqual(new Set(['1', '2']));
  });

  it('never keys off ballots-cast (county-wide turnout file gotcha)', () => {
    // Ballots recorded but zero candidate votes → not on this office's ballot.
    const dem = [row(9, { 'DEM A B': 0 }, { ballots: '500' })];
    const set = matchupParticipation(dem, ['DEM A B'], [], []);
    expect(set.size).toBe(0);
  });
});

describe('toRaceEnvByPrecinct', () => {
  const candidates = ['DEM X', 'REP Y'];
  const synthRows = [
    row(1, { 'DEM X': 60, 'REP Y': 40 }),
    row(2, { 'DEM X': 10, 'REP Y': 30 }),
    row(3, { 'DEM X': 5, 'REP Y': 5 }),
  ];

  it('uses simulated votes where present, falls back to baseline rows', () => {
    const sim = {
      precinctResults: {
        1: { adjustedVotes: { 'DEM X': 30, 'REP Y': 40 }, flipped: true },
        // precinct 2 skipped (no modeled-party data) → baseline fallback
      },
    };
    const env = toRaceEnvByPrecinct(sim, synthRows, candidates);
    expect(env['1']).toEqual({ winner: 'Rep', margin: 10 / 70, total: 70, flipped: true });
    expect(env['2']).toEqual({ winner: 'Rep', margin: 20 / 40, total: 40, flipped: false });
  });

  it('ties go Dem (alphabetical first-max over DEM/REP columns)', () => {
    const env = toRaceEnvByPrecinct(null, synthRows, candidates);
    expect(env['3'].winner).toBe('Dem');
    expect(env['3'].margin).toBe(0);
  });

  it('marks precincts outside the participation set as not-on-ballot', () => {
    const env = toRaceEnvByPrecinct(null, synthRows, candidates, new Set(['1']));
    expect(env['1'].total).toBe(100);
    expect(env['2']).toEqual({ winner: null, margin: 0, total: 0, flipped: false });
  });

  it('is empty-safe', () => {
    expect(toRaceEnvByPrecinct(null, null, candidates)).toEqual({});
    expect(toRaceEnvByPrecinct(null, synthRows, [])).toEqual({});
  });
});

describe('countyHeadline', () => {
  it('reads the simulated summary and strips party prefixes from the name', () => {
    const sim = {
      simulatedSummary: {
        totalVotes: 100,
        candidateTotals: { 'DEM Jane Doe': 45, 'REP John Roe': 55 },
      },
      flippedPrecincts: ['7'],
      countyFlipped: false,
    };
    const h = countyHeadline(sim, 'DEM Jane Doe', 'REP John Roe');
    expect(h.winnerName).toBe('John Roe');
    expect(h.winnerParty).toBe('Rep');
    expect(h.demVotes).toBe(45);
    expect(h.repVotes).toBe(55);
    expect(h.marginPts).toBeCloseTo(10);
    expect(h.flippedPrecincts).toEqual(['7']);
    expect(h.countyFlipped).toBe(false);
  });

  it('is null for a missing or empty summary (never fabricate)', () => {
    expect(countyHeadline(null, 'DEM A', 'REP B')).toBeNull();
    expect(countyHeadline({ simulatedSummary: { totalVotes: 0 } }, 'DEM A', 'REP B')).toBeNull();
  });
});

describe('integration: synthesized rows through the real simulator', () => {
  it('a Dem-surge scenario flips a close precinct', () => {
    const baseRows = [
      row(1, { 'DEM Old D': 48, 'REP Old R': 52 }, { registered: '1000', ballots: '100' }),
    ];
    const synth = synthesizeMatchup(baseRows, ['DEM Old D', 'REP Old R'], 'New D', 'New R');
    const dnc = { 1: { Precinct: '1', Rep: 400, Mod: 200, Dem: 400, Total: 1000 } };

    const baseline = runFullSimulation(synth.rows, dnc, synth.candidates, { Rep: 1, Mod: 1, Dem: 1 });
    expect(baseline.simulatedSummary.winner.name).toBe('REP New R');

    const surge = runFullSimulation(synth.rows, dnc, synth.candidates, { Rep: 1, Mod: 1, Dem: 1.25 });
    expect(surge.simulatedSummary.winner.name).toBe('DEM New D');
    expect(surge.flippedPrecincts).toEqual(['1']);
    expect(surge.countyFlipped).toBe(true);

    const env = toRaceEnvByPrecinct(surge, synth.rows, synth.candidates);
    expect(env['1'].winner).toBe('Dem');
    expect(env['1'].flipped).toBe(true);
  });
});
