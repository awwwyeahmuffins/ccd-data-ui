// siteNav.test.js — the shared civic header: flat nav, aria-current,
// text-size toggle persistence, idempotency, welcome panel.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { initSiteNav } from './siteNav.js';

const ALL_PAGES = [
  'index.html',
  'elections.html',
  'forecast.html',
  'targets.html',
  'explore.html',
  'precinct.html',
  'methodology.html',
];

function freshInit({ welcomeSeen = true } = {}) {
  localStorage.clear();
  if (welcomeSeen) localStorage.setItem('ccd_welcome_seen', '1');
  document.body.innerHTML = '<header id="site-header"></header>';
  document.documentElement.classList.remove('text-large');
  initSiteNav();
}

describe('shared header', () => {
  beforeEach(() => freshInit());

  it('renders exactly one flat text link per page', () => {
    for (const href of ALL_PAGES) {
      const links = document.querySelectorAll(`.site-nav a[href="${href}"]`);
      expect(links.length).toBe(1);
      expect(links[0].textContent.trim().length).toBeGreaterThan(2); // words, not icons
    }
  });

  it('marks the open page with aria-current (jsdom serves "/" -> index)', () => {
    const current = document.querySelectorAll('.site-nav a[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0].getAttribute('href')).toBe('index.html');
  });

  it('is idempotent — a second init never duplicates the nav', () => {
    initSiteNav();
    initSiteNav();
    expect(document.querySelectorAll('.site-nav').length).toBe(1);
    expect(document.querySelectorAll('#nav-text-size').length).toBe(1);
  });
});

describe('text-size toggle', () => {
  beforeEach(() => freshInit());

  it('toggles html.text-large and persists the choice', () => {
    const btn = document.getElementById('nav-text-size');
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    btn.click();
    expect(document.documentElement.classList.contains('text-large')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ccd_text_large')).toBe('1');

    btn.click();
    expect(document.documentElement.classList.contains('text-large')).toBe(false);
    expect(localStorage.getItem('ccd_text_large')).toBe('0');
  });

  it('re-applies the saved size on a fresh render (reload survival)', () => {
    document.getElementById('nav-text-size').click();
    // simulate reload: fresh header, saved preference intact
    const saved = localStorage.getItem('ccd_text_large');
    document.body.innerHTML = '<header id="site-header"></header>';
    initSiteNav();
    expect(saved).toBe('1');
    expect(document.getElementById('nav-text-size').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('welcome panel', () => {
  it('shows on first visit and never after dismissal', () => {
    freshInit({ welcomeSeen: false });
    const card = document.querySelector('.welcome-card');
    expect(card).not.toBeNull();

    document.querySelector('.welcome-dismiss').click();
    expect(document.querySelector('.welcome-card')).toBeNull();
    expect(localStorage.getItem('ccd_welcome_seen')).toBe('1');

    // "reload"
    document.body.innerHTML = '<header id="site-header"></header>';
    initSiteNav();
    expect(document.querySelector('.welcome-card')).toBeNull();
  });

  it('stays away for returning visitors', () => {
    freshInit({ welcomeSeen: true });
    expect(document.querySelector('.welcome-card')).toBeNull();
  });
});
