// glossary.test.js — plain-language term dictionary + tap-to-define popover.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { TERMS, termButton, initGlossary } from './glossary.js';

// Terms already referenced by live pages — removing one breaks a page.
const REQUIRED_TERMS = ['margin', 'moderate', 'turnout', 'voter-universe', 'pvi'];

describe('TERMS dictionary', () => {
  it('defines every term the pages already use', () => {
    for (const key of REQUIRED_TERMS) {
      expect(TERMS[key]).toBeDefined();
      expect(TERMS[key].title.length).toBeGreaterThan(0);
      expect(TERMS[key].body.length).toBeGreaterThan(20);
    }
  });

  it('keeps definitions plain: short sentences, no unexplained jargon', () => {
    for (const [key, def] of Object.entries(TERMS)) {
      // Plain-language guardrail: no sentence longer than ~200 chars.
      for (const sentence of def.body.split(/[.!?]/)) {
        expect(sentence.length).toBeLessThan(200);
      }
      expect(key).toBe(key.toLowerCase());
    }
  });
});

describe('termButton()', () => {
  it('renders the tappable marked-term markup precinctLookup also hand-rolls', () => {
    const html = termButton('margin', 'Win margin');
    expect(html).toContain('class="term"');
    expect(html).toContain('data-term="margin"');
    expect(html).toContain('term-mark');
    expect(html).toContain('type="button"');
    expect(html).toContain('Win margin');
  });

  it('returns the plain label for unknown terms (never a dead button)', () => {
    expect(termButton('nope', 'Some label')).toBe('Some label');
  });
});

describe('initGlossary() popover', () => {
  beforeEach(() => {
    // Replacing body content detaches any prior popover; the module must
    // recover (real pages re-render their containers the same way).
    document.body.innerHTML = termButton('turnout', 'Turnout');
    initGlossary(); // idempotent — only the first call installs the listener
  });

  function openIt() {
    document.querySelector('.term[data-term]').click();
    return document.querySelector('.glossary-pop');
  }

  it('opens an accessible dialog with the definition on tap', () => {
    const pop = openIt();
    expect(pop).not.toBeNull();
    expect(pop.hidden).toBe(false);
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.textContent).toContain(TERMS.turnout.title);
    expect(pop.textContent).toContain('Close');
  });

  it('closes on Escape and returns focus to the term button', () => {
    const btn = document.querySelector('.term[data-term]');
    const pop = openIt();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('un-expands the previous term when a second one is opened', () => {
    // Two terms both reading aria-expanded="true" with one popover on screen
    // is a lie to a screen reader about what is open.
    document.body.innerHTML = termButton('turnout', 'Turnout') + termButton('margin', 'Margin');
    const [a, b] = document.querySelectorAll('.term[data-term]');
    a.click();
    expect(a.getAttribute('aria-expanded')).toBe('true');
    b.click();
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(b.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes from its Close button', () => {
    const pop = openIt();
    pop.querySelector('.glossary-pop-close').click();
    expect(pop.hidden).toBe(true);
  });

  it('is idempotent: double init never double-opens', () => {
    initGlossary();
    openIt();
    expect(document.querySelectorAll('.glossary-pop').length).toBe(1);
  });
});
