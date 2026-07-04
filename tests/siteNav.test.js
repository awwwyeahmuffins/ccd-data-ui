// siteNav.test.js — the shared civic header: flat nav, aria-current,
// text-size toggle persistence, idempotency, welcome panel.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { initSiteNav } from './siteNav.js';

// The five-tab nav (REDESIGN §3.3) — forecast.html lives outside the nav
// (linked in context from Priority Precincts and How It Works) and
// elections.html is a redirect stub.
const ALL_PAGES = [
  'index.html',
  'precinct.html',
  'targets.html',
  'explore.html',
  'methodology.html',
];

function freshInit({ welcomeSeen = true, seed = {} } = {}) {
  localStorage.clear();
  if (welcomeSeen) localStorage.setItem('ccd_welcome_seen', '1');
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  window.location.hash = '';
  document.body.innerHTML = '<header id="site-header"></header>';
  document.documentElement.classList.remove('text-large');
  delete document.documentElement.dataset.persona;
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

describe('persona plumbing', () => {
  it('stamps html[data-persona="public"] by default — no badge, no toggle', () => {
    freshInit();
    expect(document.documentElement.dataset.persona).toBe('public');
    expect(document.querySelector('.site-persona-badge')).toBeNull();
    expect(document.querySelector('#nav-persona')).toBeNull();
  });

  it('honors a stored persona and shows its plain-language badge', () => {
    freshInit({ seed: { ccd_persona: 'chair' } });
    expect(document.documentElement.dataset.persona).toBe('chair');
    expect(document.querySelector('.site-persona-badge').textContent).toBe('Simple View');
  });

  it('public and campaign keep the five-tab public nav', () => {
    for (const persona of ['public', 'campaign']) {
      freshInit({ seed: { ccd_persona: persona } });
      expect(document.querySelectorAll('.site-nav a').length).toBe(ALL_PAGES.length);
      expect(document.querySelector('.site-nav a[href="chair.html"]')).toBeNull();
    }
  });

  it('the chair persona gets My Dashboard first, then the five public tabs', () => {
    freshInit({ seed: { ccd_persona: 'chair' } });
    const links = document.querySelectorAll('.site-nav a');
    expect(links.length).toBe(ALL_PAGES.length + 1);
    expect(links[0].getAttribute('href')).toBe('chair.html');
    expect(links[0].textContent.trim()).toBe('My Dashboard');
    for (const href of ALL_PAGES) {
      expect(document.querySelectorAll(`.site-nav a[href="${href}"]`).length).toBe(1);
    }
  });

  it('an invalid stored persona falls back to public', () => {
    freshInit({ seed: { ccd_persona: 'admin' } });
    expect(document.documentElement.dataset.persona).toBe('public');
    expect(document.querySelector('.site-persona-badge')).toBeNull();
  });

  it('renders the dev toggle only when dev tools are armed', () => {
    freshInit({ seed: { ccd_dev_tools: '1' } });
    const select = document.querySelector('#nav-persona');
    expect(select).not.toBeNull();
    expect(select.value).toBe('public');
    expect(select.querySelectorAll('option').length).toBe(3);
  });

  it('changing the toggle persists the persona (reload picks it up)', () => {
    freshInit({ seed: { ccd_dev_tools: '1' } });
    const select = document.querySelector('#nav-persona');
    select.value = 'campaign';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('ccd_persona')).toBe('campaign');
    // simulate the reload: fresh header, persisted choice intact
    document.body.innerHTML = '<header id="site-header"></header>';
    initSiteNav();
    expect(document.documentElement.dataset.persona).toBe('campaign');
    expect(document.querySelector('.site-persona-badge').textContent).toBe('Detailed View');
    expect(document.querySelector('#nav-persona').value).toBe('campaign');
  });

  it('a second init never duplicates badge or toggle', () => {
    freshInit({ seed: { ccd_persona: 'chair', ccd_dev_tools: '1' } });
    initSiteNav();
    initSiteNav();
    expect(document.querySelectorAll('.site-persona-badge').length).toBe(1);
    expect(document.querySelectorAll('#nav-persona').length).toBe(1);
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
