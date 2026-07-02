// mapPatterns.test.js — SVG pattern factory: stable ids, one defs block,
// party geometry mapping, contrast-aware hatch ink.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { patternFill, patternId, partyKind, hatchColorFor, swatchSVG } from './mapPatterns.js';

const NS = 'http://www.w3.org/2000/svg';

describe('partyKind', () => {
  it('gives each party family a distinct geometry', () => {
    expect(partyKind('Rep')).toBe('diag');
    expect(partyKind('REP')).toBe('diag');
    expect(partyKind('Dem')).toBe('horiz');
    expect(partyKind('Mod')).toBe('dots');
    expect(partyKind('Lib')).toBe('dots');
    expect(partyKind(undefined)).toBe('dots');
  });
});

describe('patternFill', () => {
  let svg;
  beforeEach(() => {
    svg = document.createElementNS(NS, 'svg');
    document.body.innerHTML = '';
    document.body.appendChild(svg);
  });

  it('creates a pattern def once and returns a url() fill', () => {
    const fill = patternFill(svg, 'diag', 2, '#E81B23');
    expect(fill).toBe(`url(#${patternId('diag', 2, '#E81B23')})`);
    expect(svg.querySelectorAll('defs[data-ccpat]').length).toBe(1);
    expect(svg.querySelectorAll('pattern').length).toBe(1);
    // second call: no duplicate def
    patternFill(svg, 'diag', 2, '#E81B23');
    expect(svg.querySelectorAll('pattern').length).toBe(1);
  });

  it('level 0 and missing svg fall back to the plain color (canvas mode)', () => {
    expect(patternFill(svg, 'dots', 0, '#EDF1F8')).toBe('#EDF1F8');
    expect(patternFill(null, 'diag', 3, '#E81B23')).toBe('#E81B23');
    expect(svg.querySelectorAll('pattern').length).toBe(0);
  });

  it('pattern tile carries its own background so color stays the encoding', () => {
    patternFill(svg, 'horiz', 2, '#00AEF3');
    const rect = svg.querySelector('pattern rect');
    expect(rect.getAttribute('fill')).toBe('#00AEF3');
  });

  it('cross-hatch (not-on-ballot) has two line directions', () => {
    patternFill(svg, 'cross', 2, '#EFEBE2');
    expect(svg.querySelectorAll('pattern line').length).toBe(2);
  });
});

describe('hatchColorFor', () => {
  it('uses ink lines on light fills and paper lines on dark fills', () => {
    expect(hatchColorFor('#D6EAF8')).toContain('28,39,51'); // light bg -> ink
    expect(hatchColorFor('#630202')).toContain('255,253,249'); // dark bg -> paper
  });
});

describe('swatchSVG', () => {
  it('renders a decorative swatch that reuses the shared defs by url()', () => {
    const html = swatchSVG('url(#ccpat-diag-2-e81b23)');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('fill="url(#ccpat-diag-2-e81b23)"');
  });
});
