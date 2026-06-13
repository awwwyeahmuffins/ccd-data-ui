/**
 * @jest-environment node
 */

import { describe, it, expect } from '@jest/globals';
import {
  AUDIENCES,
  isAudience,
  derivePrecinctSignature,
  recommendAudience,
  buildTargetedTalkingPoints,
  buildCanvassScript,
} from './talkingPointsBuilder.js';

// ---------------------------------------------------------------------------
// Fixtures — shaped like the data precinctLookup.js already loads.
// ---------------------------------------------------------------------------

const demBattleground = {
  partyData: { demShare: 0.46, repShare: 0.42, modShare: 0.12, dem: 460, rep: 420, mod: 120 },
  racialData: { pct_white: 0.4, pct_hispanic: 0.35, pct_black: 0.15, pct_asian: 0.05, pct_others: 0.05 },
  votingHistory: {
    byCategory: {
      Federal: [
        { raceName: 'President 2020', registeredVoters: 1000, totalVotes: 480 },
        { raceName: 'U.S. Senate 2018', registeredVoters: 950, totalVotes: 400 },
      ],
    },
  },
  pvi: { pvi: 3, label: 'D+3' },
  strategy: { classification: 'persuade' },
};

const safeRepLowTurnout = {
  partyData: { demShare: 0.25, repShare: 0.7, modShare: 0.05, dem: 250, rep: 700, mod: 50 },
  racialData: { pct_white: 0.82, pct_hispanic: 0.1, pct_black: 0.04, pct_asian: 0.02, pct_others: 0.02 },
  votingHistory: {
    byCategory: { Federal: [{ raceName: 'President 2020', registeredVoters: 2000, totalVotes: 800 }] },
  },
  pvi: { pvi: -18, label: 'R+18' },
  strategy: { classification: 'grow' },
};

// ---------------------------------------------------------------------------

describe('AUDIENCES / isAudience', () => {
  it('exposes the three chair objectives', () => {
    expect(AUDIENCES.map((a) => a.id).sort()).toEqual(['mobilize', 'persuade', 'register']);
  });
  it('validates ids', () => {
    expect(isAudience('mobilize')).toBe(true);
    expect(isAudience('nonsense')).toBe(false);
  });
});

describe('derivePrecinctSignature', () => {
  it('reads lean and competitiveness from PVI', () => {
    const sig = derivePrecinctSignature(demBattleground);
    expect(sig.leanParty).toBe('Dem');
    expect(sig.leanLabel).toBe('D+3');
    expect(sig.competitiveness).toBe('battleground');
    expect(sig.hasData).toBe(true);
  });

  it('uses the most-recent federal race for turnout + non-voter split', () => {
    const sig = derivePrecinctSignature(demBattleground);
    // Recent race = President 2020 (1000 reg, 480 votes).
    expect(sig.registeredVoters).toBe(1000);
    expect(Math.round(sig.turnoutPct)).toBe(48);
    expect(sig.turnoutLevel).toBe('low');
    expect(sig.nonVoters).toBe(520);
    // 520 non-voters * 0.46 dem share.
    expect(sig.estDemNonVoters).toBe(Math.round(520 * 0.46));
  });

  it('classifies diversity from the racial profile', () => {
    const sig = derivePrecinctSignature(demBattleground);
    expect(Math.round(sig.nonWhitePct)).toBe(60);
    expect(sig.majorityMinority).toBe(true);
    expect(sig.topGroups[0].label).toBe('Hispanic');
  });

  it('falls back to party shares when PVI is absent', () => {
    const sig = derivePrecinctSignature({
      partyData: { demShare: 0.3, repShare: 0.65, modShare: 0.05 },
    });
    expect(sig.leanParty).toBe('Rep');
    expect(sig.pviPts).toBeNull();
    expect(sig.competitiveness).toBe('unknown');
  });

  it('is safe with no data at all', () => {
    const sig = derivePrecinctSignature({});
    expect(sig.hasData).toBe(false);
    expect(sig.estDemNonVoters).toBe(0);
    expect(sig.nonWhitePct).toBeNull();
  });

  it('enriches with census income when present', () => {
    const sig = derivePrecinctSignature({
      ...demBattleground,
      census: { income: { medianHousehold: 72000 } },
    });
    expect(sig.medianIncome).toBe(72000);
  });
});

describe('recommendAudience', () => {
  it('maps strategy classification to an audience', () => {
    expect(recommendAudience(derivePrecinctSignature(demBattleground))).toBe('persuade');
    expect(recommendAudience(derivePrecinctSignature(safeRepLowTurnout))).toBe('register');
  });

  it('infers from the signature when strategy is missing', () => {
    const sig = derivePrecinctSignature({
      partyData: { demShare: 0.46, repShare: 0.42, modShare: 0.12 },
      pvi: { pvi: 2, label: 'D+2' },
    });
    expect(recommendAudience(sig)).toBe('persuade'); // battleground
  });

  it('defaults to mobilize with no signature', () => {
    expect(recommendAudience(null)).toBe('mobilize');
  });
});

describe('buildTargetedTalkingPoints', () => {
  it('returns nothing when the precinct has no data', () => {
    expect(buildTargetedTalkingPoints(derivePrecinctSignature({}), 'mobilize')).toEqual([]);
  });

  it('mobilize points lead with the turnout gap and a real estimate', () => {
    const sig = derivePrecinctSignature(demBattleground);
    const pts = buildTargetedTalkingPoints(sig, 'mobilize');
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length).toBeLessThanOrEqual(5);
    const joined = pts.map((p) => p.text).join(' ');
    expect(joined).toMatch(/stayed home/);
    expect(joined).toContain(String(sig.estDemNonVoters));
  });

  it('persuade points emphasize battleground + moderates', () => {
    const pts = buildTargetedTalkingPoints(derivePrecinctSignature(demBattleground), 'persuade');
    const cats = pts.map((p) => p.category).join(' | ');
    expect(cats).toMatch(/battleground/i);
    expect(cats).toMatch(/[Mm]oderates/);
  });

  it('register points emphasize untapped support + diversity for a safe-R precinct', () => {
    const pts = buildTargetedTalkingPoints(derivePrecinctSignature(safeRepLowTurnout), 'register');
    const joined = pts.map((p) => p.category + ' ' + p.text).join(' ');
    expect(joined).toMatch(/[Uu]ntapped|grow|registration/);
  });

  it('audience changes the output', () => {
    const sig = derivePrecinctSignature(demBattleground);
    const a = buildTargetedTalkingPoints(sig, 'mobilize').map((p) => p.text).join();
    const b = buildTargetedTalkingPoints(sig, 'persuade').map((p) => p.text).join();
    expect(a).not.toEqual(b);
  });
});

describe('buildCanvassScript', () => {
  it('produces a labelled, audience-specific script with the precinct code', () => {
    const sig = derivePrecinctSignature(demBattleground);
    const script = buildCanvassScript(sig, 'mobilize', '42');
    expect(script).toContain('PRECINCT 42');
    expect(script).toMatch(/Mobilize the base/);
    expect(script).toMatch(/polling place/i);
    // carries a real number from the signature
    expect(script).toContain(String(sig.estDemNonVoters));
  });

  it('persuade script asks an open question, register script asks about registration', () => {
    const sig = derivePrecinctSignature(demBattleground);
    expect(buildCanvassScript(sig, 'persuade', '7')).toMatch(/issues are on your mind/i);
    expect(buildCanvassScript(sig, 'register', '7')).toMatch(/registered to vote/i);
  });

  it('is safe with a null signature', () => {
    expect(buildCanvassScript(null, 'mobilize', '1')).toBe('');
  });
});
