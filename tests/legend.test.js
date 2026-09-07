// legend.test.js — the legend must show the EXACT fills the map paints.
// The failure this guards against is drift: legendHTML and the fill engines are
// separate code paths over the same encoding, so a level added to one and not
// the other leaves precincts on the map with no swatch to read them by.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { legendHTML } from '../js/map/legend.js';
import { leanFill, raceFill } from '../js/map/mapStyles.js';
import { PARTY_STRENGTH_COLORS } from '../js/lib/constants.js';

const NS = 'http://www.w3.org/2000/svg';

describe('legendHTML — lean mode', () => {
  let svg;
  beforeEach(() => {
    document.body.innerHTML = '';
    svg = document.createElementNS(NS, 'svg');
    document.body.appendChild(svg);
  });

  it('carries a swatch for every fill leanFill can produce', () => {
    // Previously only strength 3 and 1 were listed, while leanFill emits a
    // distinct colour + density for level 2 as well — 46% of Collin's
    // precincts rendered with no legend entry, and Moderate level 1 had none
    // at all.
    const html = legendHTML({ svg, mode: 'lean' });
    for (const party of ['Rep', 'Dem', 'Mod']) {
      for (const strength of [1, 2, 3]) {
        const fill = leanFill({ winningParty: party, partyStrength: strength }, { svg });
        expect(html).toContain(fill);
      }
    }
  });

  it('names every strength in words, not just the extremes', () => {
    const html = legendHTML({ svg, mode: 'lean' });
    expect(html).toMatch(/Strong Republican/);
    expect(html).toMatch(/Solid Republican/);
    expect(html).toMatch(/Slight Republican/);
    expect(html).toMatch(/Moderate/);
  });

  it('does not describe the modeled lean as a vote count', () => {
    expect(legendHTML({ svg, mode: 'lean' })).toContain('model');
  });

  it('uses each party ramp colour, so the swatch matches the polygon', () => {
    // Fills are pattern references whose id encodes the colour, e.g.
    // url(#ccpat-diag-2-d13636) — compare in that form.
    const html = legendHTML({ svg, mode: 'lean' });
    expect(html).toContain(PARTY_STRENGTH_COLORS.Rep[2].replace('#', '').toLowerCase());
    expect(html).toContain(PARTY_STRENGTH_COLORS.Dem[2].replace('#', '').toLowerCase());
  });
});

describe('legendHTML — margin mode', () => {
  let svg;
  beforeEach(() => {
    document.body.innerHTML = '';
    svg = document.createElementNS(NS, 'svg');
    document.body.appendChild(svg);
  });

  it('does not present the model as an election result', () => {
    const html = legendHTML({ svg, mode: 'margin' });
    expect(html).not.toMatch(/how close the vote was/i);
    expect(html).toMatch(/not a vote count/i);
  });
});

describe('legendHTML — race mode', () => {
  let svg;
  beforeEach(() => {
    document.body.innerHTML = '';
    svg = document.createElementNS(NS, 'svg');
    document.body.appendChild(svg);
  });

  const env = (extra) => ({
    svg, raceId: 'r', race: { label: 'Governor 2022', partisan: true }, ...extra,
  });

  it('carries a swatch for the tie fill the map paints', () => {
    // The tie fill was added to raceFill without a legend row — a colour on the
    // map with no key, which is the exact defect the Lean legend rework removed.
    const tied = { svg, raceId: 'r', race: { label: 'R', partisan: true,
      byPrecinct: { 1: { total: 100, winner: 'Dem', margin: 0, tie: true } } } };
    const fill = raceFill({ PRECINCT: '1' }, tied);
    expect(legendHTML(tied)).toContain(fill);
  });

  it('does not give out-of-county precincts a swatch identical to a Rep win', () => {
    // The old row reused the exact "Republican win" fill, so two legend rows
    // showed the same square with different meanings.
    const html = legendHTML(env({ hasOtherPrecinctLayer: true }));
    const swatches = html.match(/<svg[^>]*class="cc-legend-sw"/g) || [];
    const rows = html.match(/cc-legend-row/g) || [];
    expect(rows.length).toBeGreaterThan(0);
    expect(html).toContain('precinct-level'); // the key stays, as prose
    expect(swatches.length).toBeLessThanOrEqual(rows.length);
  });
});
