// campaign.test.js — domain/campaign, the pure campaign-dashboard engine:
// win numbers, persuasion-vs-turnout classification, district roll-ups,
// multi-key sort, and the VAN target-list CSV.
import { describe, it, expect } from '@jest/globals';
import {
  winNumber,
  median,
  classifyPrecinct,
  buildCampaignRows,
  aggregateByDistrict,
  sortRowsMulti,
  buildTargetCSV,
  TARGET_CSV_COLUMNS,
} from '../js/domain/campaign.js';

describe('winNumber', () => {
  it('is floor(ballots/2)+1 for even and odd ballot counts', () => {
    expect(winNumber(1000)).toBe(501);
    expect(winNumber(1001)).toBe(501);
    expect(winNumber(999)).toBe(500);
    expect(winNumber(1)).toBe(1);
  });

  it('is null for missing or non-positive input (never fabricate)', () => {
    expect(winNumber(null)).toBeNull();
    expect(winNumber(undefined)).toBeNull();
    expect(winNumber(0)).toBeNull();
    expect(winNumber(-5)).toBeNull();
    expect(winNumber(NaN)).toBeNull();
  });
});

describe('median', () => {
  it('handles odd, even, and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median(null)).toBeNull();
  });

  it('ignores nulls and NaN', () => {
    expect(median([null, 5, NaN, 1, 3])).toBe(3);
  });
});

describe('classifyPrecinct', () => {
  const opts = { party: 'Dem', medianRate: 0.5 };

  it('Persuasion: close margin with a real moderate bloc, regardless of winner', () => {
    expect(classifyPrecinct({ winner: 'Rep', margin: 0.05, modShare: 0.2, rate: 0.6 }, opts)).toBe('Persuasion');
    expect(classifyPrecinct({ winner: 'Dem', margin: 0.09, modShare: 0.15, rate: 0.6 }, opts)).toBe('Persuasion');
  });

  it('Turnout: our precinct turning out below the county median', () => {
    expect(classifyPrecinct({ winner: 'Dem', margin: 0.2, modShare: 0.1, rate: 0.3 }, opts)).toBe('Turnout');
  });

  it('Base: our precinct at or above median turnout', () => {
    expect(classifyPrecinct({ winner: 'Dem', margin: 0.2, modShare: 0.1, rate: 0.6 }, opts)).toBe('Base');
    // no rate data → cannot claim a turnout gap → Base
    expect(classifyPrecinct({ winner: 'Dem', margin: 0.2, modShare: 0.1, rate: null }, opts)).toBe('Base');
  });

  it('Watch: safely the other side', () => {
    expect(classifyPrecinct({ winner: 'Rep', margin: 0.3, modShare: 0.1, rate: 0.6 }, opts)).toBe('Watch');
  });

  it('respects the party perspective', () => {
    const rep = { party: 'Rep', medianRate: 0.5 };
    expect(classifyPrecinct({ winner: 'Rep', margin: 0.3, modShare: 0.1, rate: 0.3 }, rep)).toBe('Turnout');
    expect(classifyPrecinct({ winner: 'Dem', margin: 0.3, modShare: 0.1, rate: 0.6 }, rep)).toBe('Watch');
  });

  it('null when partisan data is absent', () => {
    expect(classifyPrecinct({ winner: null, margin: null, modShare: null, rate: 0.5 }, opts)).toBeNull();
  });
});

// Two precincts with full data + one with no turnout history.
function fixtures() {
  const records = [
    { precinct: '1', winner: 'Dem', demShare: 0.55, repShare: 0.35, modShare: 0.10, margin: 0.20, nonWhite: 0.40 },
    { precinct: '2', winner: 'Rep', demShare: 0.40, repShare: 0.48, modShare: 0.12, margin: 0.08, nonWhite: 0.25 },
    { precinct: '3', winner: 'Dem', demShare: 0.60, repShare: 0.30, modShare: 0.10, margin: 0.30, nonWhite: 0.55 },
  ];
  const raw = {
    1: { rep: 350, mod: 100, dem: 550, white: 600, total: 1000 },
    2: { rep: 240, mod: 60, dem: 200, white: 375, total: 500 },
    3: { rep: 300, mod: 100, dem: 600, white: 450, total: 1000 },
  };
  const t2024 = {
    1: { registered: 2000, ballots: 1500 }, // rate .75
    2: { registered: 1000, ballots: 500 },  // rate .50
    3: { registered: 1000, ballots: 250 },  // rate .25
  };
  const t2022 = {
    1: { registered: 1800, ballots: 900 },  // rate .50
    2: { registered: 1000, ballots: 450 },  // rate .45
    // precinct 3 missing — dropoff must stay null
  };
  const tBase = {
    1: { registered: 1800, ballots: 1001 },
    2: { registered: 1000, ballots: 500 },
    3: { registered: 1000, ballots: 400 },
  };
  return { records, raw, t2024, t2022, tBase };
}

describe('buildCampaignRows', () => {
  const { records, raw, t2024, t2022, tBase } = fixtures();
  const rows = buildCampaignRows(records, raw, { t2024, t2022, tBase, party: 'Dem' });
  const byCode = Object.fromEntries(rows.map((r) => [r.precinct, r]));

  it('computes win number and vote gap from the baseline election', () => {
    expect(byCode['1'].expectedBallots).toBe(1001);
    expect(byCode['1'].winNumber).toBe(501);
    expect(byCode['1'].partyVotes).toBe(550);
    expect(byCode['1'].voteGap).toBe(501 - 550); // surplus → negative gap
    expect(byCode['2'].winNumber).toBe(251);
    expect(byCode['2'].voteGap).toBe(251 - 200);
  });

  it('signs the margin from the selected party perspective', () => {
    expect(byCode['1'].signedMargin).toBeCloseTo(0.20);
    expect(byCode['2'].signedMargin).toBeCloseTo(-0.08);
    const repRows = buildCampaignRows(records, raw, { t2024, t2022, tBase, party: 'Rep' });
    expect(repRows.find((r) => r.precinct === '2').signedMargin).toBeCloseTo(0.08);
    expect(repRows.find((r) => r.precinct === '2').partyVotes).toBe(240);
  });

  it('computes cross-election dropoff and propagates nulls', () => {
    expect(byCode['1'].turnoutDropoff).toBeCloseTo(0.75 - 0.50);
    expect(byCode['2'].turnoutDropoff).toBeCloseTo(0.50 - 0.45);
    expect(byCode['3'].turnoutDropoff).toBeNull(); // no 2022 file row
  });

  it('classifies with the computed county median rate when none is given', () => {
    // rates .75/.50/.25 → median .50; precinct 3 (Dem, rate .25 < .50) → Turnout
    expect(byCode['3'].classification).toBe('Turnout');
    expect(byCode['1'].classification).toBe('Base');
    // margin .08 is close but modShare .12 < .15 → not Persuasion; Rep-won → Watch
    expect(byCode['2'].classification).toBe('Watch');
  });

  it('keeps the original record fields (spread, not replace)', () => {
    expect(byCode['1'].nonWhite).toBeCloseTo(0.40);
    expect(byCode['1'].winner).toBe('Dem');
  });
});

describe('aggregateByDistrict', () => {
  const { records, raw, t2024, t2022, tBase } = fixtures();
  const rows = buildCampaignRows(records, raw, { t2024, t2022, tBase, party: 'Dem' });
  const memberOf = { 1: 'comm-1', 2: 'comm-1', 3: 'comm-2' };
  const labels = { 'comm-1': 'Commissioner Pct 1', 'comm-2': 'Commissioner Pct 2' };
  const districts = aggregateByDistrict(rows, memberOf, labels, { party: 'Dem', medianRate: 0.5 });
  const d1 = districts.find((d) => d.precinct === 'comm-1');

  it('groups by the membership map and labels districts', () => {
    expect(districts).toHaveLength(2);
    expect(d1.label).toBe('Commissioner Pct 1');
    expect(d1.memberCodes.sort()).toEqual(['1', '2']);
    expect(d1.isDistrict).toBe(true);
  });

  it('recomputes shares from summed counts — NOT the mean of member shares', () => {
    // comm-1 sums: dem 750, rep 590, mod 160 → votes 1500 (members weighted 1000 vs 500)
    expect(d1.demShare).toBeCloseTo(750 / 1500);
    expect(d1.repShare).toBeCloseTo(590 / 1500);
    // mean of member demShares would be (0.55+0.40)/2 = 0.475 — must NOT match
    expect(d1.demShare).not.toBeCloseTo(0.475, 10);
    expect(d1.margin).toBeCloseTo((750 - 590) / 1500);
    expect(d1.winner).toBe('Dem');
  });

  it('recomputes rates from summed ballots/registered and win number from summed expected', () => {
    // comm-1: 2024 = 2000/3000 registered? ballots 1500+500=2000, registered 2000+1000=3000
    expect(d1.rate2024).toBeCloseTo(2000 / 3000);
    expect(d1.rateMidterm).toBeCloseTo((900 + 450) / (1800 + 1000));
    expect(d1.expectedBallots).toBe(1501);
    expect(d1.winNumber).toBe(751);
    expect(d1.voteGap).toBe(751 - 750);
  });

  it('nonWhite comes from summed counts', () => {
    expect(d1.nonWhite).toBeCloseTo(1 - (600 + 375) / 1500);
  });

  it('skips rows not in the membership map and handles missing member data', () => {
    const partial = aggregateByDistrict(rows, { 3: 'comm-2' }, null, { party: 'Dem' });
    expect(partial).toHaveLength(1);
    expect(partial[0].rateMidterm).toBeNull(); // precinct 3 has no 2022 data
    expect(partial[0].turnoutDropoff).toBeNull();
  });
});

describe('sortRowsMulti', () => {
  const rows = [
    { id: 'a', cls: 'Base', gap: 50 },
    { id: 'b', cls: 'Persuasion', gap: 10 },
    { id: 'c', cls: 'Base', gap: 10 },
    { id: 'd', cls: 'Persuasion', gap: null },
  ];

  it('sorts by multiple keys in order', () => {
    const sorted = sortRowsMulti(rows, [
      { key: 'cls', dir: 'asc' },
      { key: 'gap', dir: 'desc' },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('sinks nulls to the bottom regardless of direction', () => {
    const asc = sortRowsMulti(rows, [{ key: 'gap', dir: 'asc' }]);
    expect(asc[asc.length - 1].id).toBe('d');
    const desc = sortRowsMulti(rows, [{ key: 'gap', dir: 'desc' }]);
    expect(desc[desc.length - 1].id).toBe('d');
  });

  it('is stable and non-mutating; empty sorts returns a copy', () => {
    const out = sortRowsMulti(rows, []);
    expect(out).not.toBe(rows);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('buildTargetCSV', () => {
  const row = {
    precinct: '42',
    registered: 1234,
    expectedBallots: 1001,
    winNumber: 501,
    partyVotes: 450,
    voteGap: 51,
    signedMargin: -0.123456,
    classification: 'Persuasion',
    turnoutDropoff: 0.25004,
    nonWhite: 0.4,
  };

  it('emits the exact VAN header', () => {
    const csv = buildTargetCSV([]);
    expect(csv.split('\r\n')[0]).toBe(
      'Precinct_ID,Total_Registered,Expected_Ballots,Target_Win_Number,Modeled_Party_Votes,Vote_Gap,Partisan_Margin,Classification,Turnout_Dropoff,Pct_NonWhite,District'
    );
    expect(TARGET_CSV_COLUMNS).toHaveLength(11);
  });

  it('emits raw values: bare integers, 4-dp decimals, no % or thousands separators', () => {
    const csv = buildTargetCSV([row]);
    const line = csv.split('\r\n')[1];
    expect(line).toBe('42,1234,1001,501,450,51,-0.1235,Persuasion,0.25,0.4,');
    expect(line).not.toContain('%');
  });

  it('null values become empty cells, never fabricated zeros', () => {
    const csv = buildTargetCSV([{ precinct: '7' }]);
    expect(csv.split('\r\n')[1]).toBe('7,,,,,,,,,,');
  });

  it('guards formula injection in string cells', () => {
    const csv = buildTargetCSV([{ ...row, precinct: '=2+2' }]);
    expect(csv.split('\r\n')[1].startsWith("'=2+2")).toBe(true);
  });

  it('fills the District column from the label map (roll-up export)', () => {
    const csv = buildTargetCSV([row], { districtLabels: { 42: 'Commissioner Pct 3' } });
    expect(csv.split('\r\n')[1].endsWith(',Commissioner Pct 3')).toBe(true);
  });

  it('uses CRLF line endings with a trailing newline (RFC 4180)', () => {
    const csv = buildTargetCSV([row]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3); // header, row, trailing empty
  });
});
