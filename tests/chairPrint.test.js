/**
 * @jest-environment node
 *
 * chairPrint.test.js — the chair packet's HTML builders. The load-bearing
 * test here is HANDOUT PURITY: page 2 goes to voters' doors as apolitical
 * voting information (individual-spending compliance), so its output must
 * never contain partisan language. Its signature already can't receive party
 * data; this locks the copy too.
 */
import { describe, it, expect } from '@jest/globals';
import {
  generateChairSummaryHTML,
  generateGOTVHandoutHTML,
} from '../js/chairPrint.js';

const VOTING_INFO = {
  election: {
    name: 'November 2026 General Election',
    electionDay: '2026-11-03',
    electionDayHours: '7:00 a.m. to 7:00 p.m.',
    earlyVoting: { start: '2026-10-19', end: '2026-10-30' },
    registrationDeadline: '2026-10-05',
    mailBallotApplicationDeadline: '2026-10-23',
  },
  voterId: {
    accepted: ['Texas driver license', 'U.S. passport (book or card)'],
    expirationNote: 'The ID can be expired up to 4 years.',
    noIdNote: 'No photo ID? You can still vote: sign a short form at the polls.',
  },
  voteCenters: [],
  links: { vote411: 'https://www.vote411.org' },
};
const NEAREST = [
  { name: 'Collin County Elections Office', address: '2010 Redbud Blvd, Suite 102, McKinney, TX 75069', distanceMiles: 2.4 },
  { name: 'Community Center', address: '1 Main St, Plano, TX' },
];

// Partisan/field-jargon terms that must NEVER appear on the door handout.
const BANNED =
  /democrat|republican|\bdem\b|\brep\b|partisan|persuasion|persuade|gotv|turnout focus|base voter|liberal|conservative|campaign/i;

describe('generateGOTVHandoutHTML (page 2 — apolitical)', () => {
  it('contains no partisan or field-jargon language on a fully-populated card', () => {
    const html = generateGOTVHandoutHTML({
      code: '42',
      votingInfo: VOTING_INFO,
      nearestCenters: NEAREST,
    });
    expect(html).not.toMatch(BANNED);
  });

  it('carries the dates, centers, precinct number, and the vote411 directive', () => {
    const html = generateGOTVHandoutHTML({
      code: '42',
      votingInfo: VOTING_INFO,
      nearestCenters: NEAREST,
    });
    expect(html).toContain('Precinct 42');
    expect(html).toContain('Tuesday, November 3, 2026');
    expect(html).toContain('polls open 7:00 a.m. to 7:00 p.m.');
    expect(html).toContain('Monday, October 19, 2026');
    expect(html).toContain('Friday, October 30, 2026');
    expect(html).toContain('Last day to register to vote');
    expect(html).toContain('Monday, October 5, 2026');
    expect(html).toContain('Collin County Elections Office');
    expect(html).toContain('about 2.4 miles away');
    expect(html).toContain('vote411.org');
    expect(html).toMatch(/does not support or oppose/);
  });

  it('carries the voter-ID checklist and its honest no-ID fallback', () => {
    const html = generateGOTVHandoutHTML({
      code: '42',
      votingInfo: VOTING_INFO,
      nearestCenters: NEAREST,
    });
    expect(html).toContain('any ONE of these photo IDs');
    expect(html).toContain('Texas driver license');
    expect(html).toContain('U.S. passport (book or card)');
    expect(html).toContain('expired up to 4 years');
    expect(html).toContain('You can still vote');
    // Omitting voterId omits the section — never an invented list.
    const bare = generateGOTVHandoutHTML({
      code: '42',
      votingInfo: { ...VOTING_INFO, voterId: null },
      nearestCenters: [],
    });
    expect(bare).not.toContain('photo ID');
  });

  it('renders honest fallbacks (vote411 directive, no invented dates) when voting info is absent', () => {
    const html = generateGOTVHandoutHTML({ code: '42', votingInfo: null, nearestCenters: [] });
    expect(html).toContain('vote411.org');
    expect(html).not.toMatch(/November|October|20\d\d/); // no dates from nowhere
    expect(html).not.toMatch(BANNED);
  });

  it('escapes hostile content from the hand-maintained JSON', () => {
    const html = generateGOTVHandoutHTML({
      code: '42',
      votingInfo: VOTING_INFO,
      nearestCenters: [{ name: '<script>alert(1)</script>', address: '"quoted" & <b>bold</b>' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;');
  });
});

describe('generateChairSummaryHTML (page 1 — internal)', () => {
  const bundle = {
    code: '42',
    label: 'Precinct 42',
    boundaryLabel: '2026 Boundaries (273)',
    turnoutCaption: 'the 2024 election vs the 2025 election',
    party: { dem: 400, mod: 300, rep: 300 },
    focus: { id: 'persuasion', label: 'Persuasion Focus', rationale: 'The two parties are about 3 points apart.' },
    volunteers: { pool: 120, method: 'Strong Democratic voters who vote in nearly every election' },
    inactive: { count: 88, activeCount: 900, share: 88 / 988 },
    matrix: {
      cells: ['dem', 'mod', 'rep'].flatMap((party) =>
        ['high', 'mid', 'low'].map((band) => ({
          party,
          band,
          count: 100,
          role:
            party === 'dem' && band === 'high' ? 'base'
            : party === 'dem' ? 'gotv'
            : party === 'mod' && band !== 'low' ? 'persuasion'
            : null,
        }))
      ),
      totals: { dem: 300, mod: 300, rep: 300, all: 900 },
      roles: { base: 100, gotv: 200, persuasion: 200 },
    },
  };

  it('renders the header, badge, matrix, and working numbers', () => {
    const html = generateChairSummaryHTML(bundle);
    expect(html).toContain('Precinct 42');
    expect(html).toContain('Persuasion Focus');
    expect(html).toContain('Strong Democratic voters');
    expect(html).toContain('88');
    expect(html).toContain('modeled estimate');
    expect(html).toContain('packet-page-1'); // the page-break carrier
  });

  it('renders N/A rows instead of numbers when data is missing', () => {
    const html = generateChairSummaryHTML({ code: '7', label: 'Precinct 7' });
    expect(html).toContain('N/A');
    expect(html).toMatch(/not on file/);
  });
});
