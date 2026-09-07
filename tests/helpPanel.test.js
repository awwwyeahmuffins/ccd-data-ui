// helpPanel.test.js — Help is reachable from every page's header, so its copy
// must describe the page the user is actually on. The bug this guards against:
// PAGE_HELP covered 6 of 10 pages and the lookup fell back to index.html, so
// trends/campaign/chair/matchup all opened Help titled "The Map", describing a
// race picker and an address search that are not on those pages.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openHelpPanel, closeHelpPanel } from '../js/helpPanel.js';

const PAGES = [
  'index.html', 'precinct.html', 'forecast.html', 'targets.html', 'explore.html',
  'methodology.html', 'trends.html', 'campaign.html', 'chair.html', 'matchup.html',
];

function visit(page) {
  // jsdom: navigate by replacing the location for the module's pathname read.
  window.history.replaceState({}, '', `/${page}`);
}

describe('help panel copy', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => closeHelpPanel());

  it.each(PAGES)('%s gets its own title, never another page\'s', (page) => {
    visit(page);
    openHelpPanel();
    const title = document.getElementById('help-title').textContent;
    expect(title.length).toBeGreaterThan(0);
    if (page !== 'index.html') expect(title).not.toBe('The Map');
  });

  it('an unknown page falls back to generic copy, not the map\'s', () => {
    visit('some-future-page.html');
    openHelpPanel();
    const title = document.getElementById('help-title').textContent;
    expect(title).toBe('About this site');
    // The map's copy talks about a race picker and an address search; the
    // generic fallback must not. Scope to the body — the shared glossary below
    // it legitimately mentions addresses.
    expect(document.getElementById('help-body').textContent).not.toContain('address');
  });

  it('describes the page it is on (trends is about movement, not the map)', () => {
    visit('trends.html');
    openHelpPanel();
    const body = document.getElementById('help-body').textContent;
    expect(body).toMatch(/moved|MOVED/);
  });
});
