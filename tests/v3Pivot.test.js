// v3Pivot.test.js
// The pivot layer is the keystone of the v3 format: it must rebuild the exact
// legacy in-memory row shape from normalized long files, and computeWinners
// must exactly mirror data_processor/unified_parser.compute_winning_candidate
// (alphabetical candidate order, first maximum, first-token party).

import { describe, it, expect } from '@jest/globals';
import { pivotRace, computeWinners } from './v3Pivot.js';

const LONG = [
  { precinct: '1', party: 'REP', candidate: 'Greg Abbott', votes: '824' },
  { precinct: '1', party: 'DEM', candidate: "Beto O'Rourke", votes: '638' },
  { precinct: '1', party: 'LIB', candidate: 'Mark Tippetts', votes: '21' },
  { precinct: '1', party: '', candidate: 'Write-in', votes: '0' },
  { precinct: '1', party: '', candidate: 'Over Votes', votes: '0' },
  { precinct: '1', party: '', candidate: 'Under Votes', votes: '4' },
  { precinct: '2', party: 'REP', candidate: 'Greg Abbott', votes: '10' },
  { precinct: '2', party: 'DEM', candidate: "Beto O'Rourke", votes: '20' },
  { precinct: '2', party: 'LIB', candidate: 'Mark Tippetts', votes: '0' },
];

const TURNOUT = [
  { precinct: '1', registered: '2737', ballots_cast: '1491', blank: '0' },
  { precinct: '2', registered: '900', ballots_cast: '40', blank: '' },
];

describe('pivotRace', () => {
  it('rebuilds the legacy row shape with string values', () => {
    const rows = pivotRace(LONG, TURNOUT);
    expect(rows).toHaveLength(2);
    const r1 = rows[0];
    expect(r1['PRECINCT CODE']).toBe('1');
    expect(r1['REGISTERED VOTERS TOTAL']).toBe('2737');
    expect(r1['BALLOTS CAST TOTAL']).toBe('1491');
    expect(r1['REP Greg Abbott']).toBe('824');
    expect(r1["DEM Beto O'Rourke"]).toBe('638');
    expect(r1['Write-in']).toBe('0');
    expect(r1['OVER VOTES']).toBe('0');
    expect(r1['UNDER VOTES']).toBe('4');
    // everything stays a string, like the legacy CSV parser produced
    for (const v of Object.values(r1)) expect(typeof v).toBe('string');
  });

  it('leaves turnout columns empty when there is no turnout file (honest gap)', () => {
    const rows = pivotRace(LONG, null);
    expect(rows[0]['REGISTERED VOTERS TOTAL']).toBe('');
    expect(rows[0]['BALLOTS CAST TOTAL']).toBe('');
  });

  it('preserves empty turnout fields as empty (never invents values)', () => {
    const rows = pivotRace(LONG, TURNOUT);
    expect(rows[1]['BALLOTS CAST BLANK']).toBe('');
  });

  it('handles nonpartisan candidates (no party prefix) and preserves party case', () => {
    const rows = pivotRace([
      { precinct: '5', party: '', candidate: 'For', votes: '12' },
      { precinct: '5', party: '', candidate: 'Against', votes: '30' },
      { precinct: '5', party: 'Dem', candidate: 'Rachel Mello', votes: '7' },
    ], null);
    expect(rows[0]['For']).toBe('12');
    expect(rows[0]['Against']).toBe('30');
    expect(rows[0]['Dem Rachel Mello']).toBe('7');
  });

  it('fills missing precinct/candidate combinations with "0"', () => {
    const rows = pivotRace([
      { precinct: '1', party: 'REP', candidate: 'A B', votes: '5' },
      { precinct: '2', party: 'DEM', candidate: 'C D', votes: '6' },
    ], null);
    expect(rows[0]['DEM C D']).toBe('0');
    expect(rows[1]['REP A B']).toBe('0');
  });

  it('sorts precincts numerically and candidate columns alphabetically', () => {
    const rows = pivotRace([
      { precinct: '10', party: 'REP', candidate: 'Zed', votes: '1' },
      { precinct: '2', party: 'DEM', candidate: 'Amy', votes: '1' },
    ], null);
    expect(rows.map(r => r['PRECINCT CODE'])).toEqual(['2', '10']);
    const candidateKeys = Object.keys(rows[0]).filter(k => /^(REP|DEM)/.test(k));
    expect(candidateKeys).toEqual(['DEM Amy', 'REP Zed']);
  });
});

describe('computeWinners', () => {
  it('picks the max-vote candidate and first-token party', () => {
    const rows = computeWinners(pivotRace(LONG, TURNOUT));
    expect(rows[0]['Winning Candidate']).toBe('REP Greg Abbott');
    expect(rows[0]['Winning Party']).toBe('REP');
    expect(rows[1]['Winning Candidate']).toBe("DEM Beto O'Rourke");
    expect(rows[1]['Winning Party']).toBe('DEM');
  });

  it('flags an exact tie instead of silently crowning the alphabetical winner', () => {
    // The first-max pick is kept (blanking it would repaint a real tie as "no
    // data"), but Tie is what consumers read to say "tied" rather than "DEM won".
    const rows = computeWinners(pivotRace([
      { precinct: '1', party: 'REP', candidate: 'Zeta', votes: '10' },
      { precinct: '1', party: 'DEM', candidate: 'Alpha', votes: '10' },
    ], null));
    expect(rows[0]['Winning Candidate']).toBe('DEM Alpha');
    expect(rows[0]['Tie']).toBe(true);
  });

  it('does not flag a decided race', () => {
    const rows = computeWinners(pivotRace([
      { precinct: '1', party: 'REP', candidate: 'Zeta', votes: '11' },
      { precinct: '1', party: 'DEM', candidate: 'Alpha', votes: '10' },
    ], null));
    expect(rows[0]['Winning Candidate']).toBe('REP Zeta');
    expect(rows[0]['Tie']).toBe(false);
  });

  it('on all-zero rows still names the first alphabetical candidate, and is not a tie', () => {
    // Nobody voted; that is emptiness, not a tied contest.
    const rows = computeWinners(pivotRace([
      { precinct: '1', party: 'REP', candidate: 'B', votes: '0' },
      { precinct: '1', party: 'DEM', candidate: 'A', votes: '0' },
    ], null));
    expect(rows[0]['Winning Candidate']).toBe('DEM A');
    expect(rows[0]['Winning Party']).toBe('DEM');
    expect(rows[0]['Tie']).toBe(false);
  });

  it('excludes Write-in and meta columns from winner computation', () => {
    const rows = computeWinners(pivotRace([
      { precinct: '1', party: 'REP', candidate: 'A', votes: '3' },
      { precinct: '1', party: '', candidate: 'Write-in', votes: '99' },
      { precinct: '1', party: '', candidate: 'Under Votes', votes: '99' },
    ], TURNOUT));
    expect(rows[0]['Winning Candidate']).toBe('REP A');
  });

  it('nonpartisan winner gets its first word as the party (e.g. "For")', () => {
    const rows = computeWinners(pivotRace([
      { precinct: '1', party: '', candidate: 'For', votes: '40' },
      { precinct: '1', party: '', candidate: 'Against', votes: '12' },
    ], null));
    expect(rows[0]['Winning Candidate']).toBe('For');
    expect(rows[0]['Winning Party']).toBe('For');
  });
});
