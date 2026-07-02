// countyBriefing.test.js — the dock's pure "so what" model.
import { describe, it, expect } from '@jest/globals';
import { buildCountyBriefing, competitiveCount, leanCounts } from './countyBriefing.js';

const feat = (props) => ({ properties: props });

const SAMPLE = [
  feat({ winningParty: 'Rep', repShare: 0.6, demShare: 0.35, pct_white: 0.7 }),
  feat({ winningParty: 'Rep', repShare: 0.52, demShare: 0.47, pct_white: 0.6 }),
  feat({ winningParty: 'Dem', repShare: 0.4, demShare: 0.55, pct_white: 0.4 }),
  feat({ winningParty: 'Mod', repShare: 0.45, demShare: 0.44, pct_white: 0.5 }),
];

describe('leanCounts / competitiveCount', () => {
  it('counts party wins and close precincts', () => {
    const c = leanCounts(SAMPLE);
    expect(c).toEqual({ rep: 2, dem: 1, mod: 1, nd: 0, total: 4 });
    expect(competitiveCount(SAMPLE)).toBe(2); // 5-pt and 1-pt precincts
  });
});

describe('buildCountyBriefing', () => {
  it('writes a plain-language headline with direction and competitiveness', () => {
    const b = buildCountyBriefing(SAMPLE, { countyName: 'Collin' });
    expect(b.headline).toContain('Collin County leans Republican by 4 points');
    expect(b.headline).toContain('2 of 4 precincts were decided by under 10 points');
  });

  it('keeps the e2e-locked sub format ("N precincts · M with party data")', () => {
    const b = buildCountyBriefing(SAMPLE, { countyName: 'Collin' });
    expect(b.sub).toBe('4 precincts · 4 with party data');
  });

  it('caps the dock at 4 stat tiles, values as text', () => {
    const b = buildCountyBriefing(SAMPLE, { countyName: 'Collin' });
    expect(b.stats.length).toBeLessThanOrEqual(4);
    for (const s of b.stats) expect(typeof s.value).toBe('string');
  });

  it('calls a near-tie "closely divided"', () => {
    const tied = [
      feat({ winningParty: 'Rep', repShare: 0.5, demShare: 0.49 }),
      feat({ winningParty: 'Dem', repShare: 0.48, demShare: 0.51 }),
    ];
    expect(buildCountyBriefing(tied, { countyName: 'Swing' }).headline).toContain('closely divided');
  });

  it('districts brand without the "County" suffix', () => {
    const b = buildCountyBriefing(SAMPLE, { countyName: 'Congressional District 3', isDistrict: true });
    expect(b.headline).toMatch(/^Congressional District 3 leans/);
  });

  it('renders honest N/A when party or Census data is missing (VEST counties)', () => {
    const bare = [feat({}), feat({})];
    const b = buildCountyBriefing(bare, { countyName: 'Loving' });
    expect(b.headline).toContain('no precinct party data');
    expect(b.lean).toBeNull();
    expect(b.stats.find((s) => s.label.includes('under 10'))?.value).toBe('N/A');
    expect(b.stats.find((s) => s.label.includes('Non-white'))?.value).toBe('N/A');
    expect(b.sub).toBe('2 precincts · 0 with party data');
  });
});
