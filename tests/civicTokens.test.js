// civicTokens.test.js — mathematically enforces the civic-plain guarantees
// in js/civic.css so they can't silently regress:
//   * every `--*-aaa` ink token is >= 7:1 (WCAG AAA) on the paper surface,
//   * white text is >= 7:1 on every token used as a filled-button background,
//   * no font-size in the sheet dips below the 16px floor (0.889rem),
//   * the text-size toggle rule (html.text-large) exists.
import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const PAPER = '#fffdf9';

function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex color: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

let css;
let tokens;

beforeAll(() => {
  css = readFileSync(join(process.cwd(), 'js', 'civic.css'), 'utf8');
  tokens = {};
  for (const [, name, value] of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    if (!(name in tokens)) tokens[name] = value; // first (light-mode) definition wins
  }
});

describe('AAA ink tokens', () => {
  it('every --*-aaa token clears 7:1 on the paper surface', () => {
    const aaa = Object.keys(tokens).filter((k) => k.endsWith('-aaa'));
    expect(aaa.length).toBeGreaterThanOrEqual(5); // ink, ink-dim, accent, rep, dem
    for (const name of aaa) {
      const ratio = contrast(tokens[name], PAPER);
      expect(`${name} ${ratio.toFixed(2)}:1`).toBe(`${name} ${ratio.toFixed(2)}:1`);
      expect(ratio).toBeGreaterThanOrEqual(7);
    }
  });

  it('white text clears 7:1 on the accent used for filled buttons', () => {
    expect(contrast('#ffffff', tokens['--accent-aaa'])).toBeGreaterThanOrEqual(7);
  });

  it('the locked party fills keep their AAA text variants', () => {
    // data encodings stay #E81B23/#00AEF3 (constants.js); these are the
    // *text* companions — losing them reintroduces 4.9:1 party text.
    expect(tokens['--rep-text-aaa']).toBeDefined();
    expect(tokens['--dem-text-aaa']).toBeDefined();
  });
});

describe('type floor', () => {
  it('no font-size below 0.889rem / 16px anywhere in civic.css', () => {
    for (const [, val, unit] of css.matchAll(/font-size:\s*([\d.]+)(px|rem|em)/g)) {
      const px = unit === 'px' ? +val : +val * 18;
      expect(px).toBeGreaterThanOrEqual(15.9);
    }
  });

  it('the text-size toggle scale exists (18px base, 20px large)', () => {
    expect(css).toMatch(/html\s*\{\s*[^}]*font-size:\s*112\.5%/);
    expect(css).toMatch(/html\.text-large\s*\{\s*[^}]*font-size:\s*125%/);
  });

  it('body line-height stays at the 1.5 reading floor', () => {
    expect(css).toMatch(/line-height:\s*1\.5/);
  });
});

describe('backplate + focus guarantees', () => {
  it('the backplate utility is solid (no backdrop blur)', () => {
    const block = css.match(/\.backplate\s*\{[^}]+\}/)?.[0] || '';
    expect(block).toContain('background:');
    expect(block).toMatch(/backdrop-filter:\s*none/);
  });

  it('gold :focus-visible outline is 3px', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-gold\)/);
  });

  it('44px touch-target token exists', () => {
    expect(tokens['--tap'] || css.includes('--tap: 44px')).toBeTruthy();
  });
});
