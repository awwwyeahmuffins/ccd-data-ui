// a11y.spec.js — axe accessibility scan of all 8 pages.
//
// The audience is 60+ precinct chairs on iPads: any *critical* or *serious*
// axe violation fails the build. Also asserts the civic-plain invariants that
// axe can't see: the text-size toggle on every page, no viewport zoom lock.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.setTimeout(90000);

// The first-visit welcome panel would sit over every scan — mark it seen.
// (onboarding.spec.js covers the panel itself, including its own axe pass.)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

// Per-page ready conditions (scan only after real content has rendered).
const PAGES = [
  { url: '/index.html', ready: (page) => expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 }) },
  { url: '/forecast.html', ready: (page) => page.waitForFunction(() => document.querySelector('#fc-outcome .outcome-grid'), null, { timeout: 30000 }) },
  { url: '/targets.html', ready: (page) => expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 }) },
  { url: '/explore.html', ready: (page) => expect(page.locator('#ex-body .pcell-precinct').first()).toBeVisible({ timeout: 30000 }) },
  { url: '/campaign.html', ready: (page) => expect(page.locator('#cp-body .pcell-precinct').first()).toBeVisible({ timeout: 30000 }) },
  { url: '/precinct.html', ready: (page) => expect(page.locator('#precinct-search')).toBeVisible({ timeout: 30000 }) },
  { url: '/methodology.html', ready: (page) => expect(page.locator('h1.page-title')).toBeVisible({ timeout: 30000 }) },
  { url: '/chair.html', ready: (page) => expect(page.locator('#chair-precinct-select')).toBeVisible({ timeout: 30000 }) },
];

for (const { url, ready } of PAGES) {
  test.describe(`${url}`, () => {
    test('has no critical or serious axe violations', async ({ page }) => {
      await page.goto(url);
      await ready(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact)
      );
      const summary = blocking
        .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} nodes; e.g. ${v.nodes[0]?.target})`)
        .join('\n');
      expect(blocking, `Axe violations on ${url}:\n${summary}`).toEqual([]);
    });

    test('exposes the text-size toggle and never locks pinch-zoom', async ({ page }) => {
      await page.goto(url);
      await ready(page);
      await expect(page.locator('#nav-text-size')).toBeVisible();
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
      expect(viewport || '').not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/i);
    });
  });
}

// ---------------------------------------------------------------------------
// Stateful views: axe again with the deeper UI open (the states a first scan
// never reaches), plus keyboard smoke for the skip link and glossary.
// ---------------------------------------------------------------------------
test.describe('stateful views', () => {
  async function expectNoBlocking(page, label) {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
    const summary = blocking.map((v) => `${v.impact}: ${v.id} (${v.nodes[0]?.target})`).join('\n');
    expect(blocking, `Axe violations in ${label}:\n${summary}`).toEqual([]);
  }

  test('map List view', async ({ page }) => {
    await page.goto('/index.html#county=collin&view=list');
    await expect.poll(async () => page.locator('.cc-card').count(), { timeout: 30000 }).toBeGreaterThan(100);
    await expectNoBlocking(page, 'list view');
  });

  test('map race overlay with binned legend', async ({ page }) => {
    await page.goto('/index.html#county=collin&race=u-s-representative-district-3-2022');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Full District', { timeout: 30000 });
    await expectNoBlocking(page, 'race overlay');
  });

  test('precinct Field Guide tab', async ({ page }) => {
    await page.goto('/precinct.html#county=collin&precinct=3');
    await page.waitForSelector('#report-container:not(.hidden)', { timeout: 30000 });
    await expect(page.locator('#section-talking-points')).not.toBeEmpty({ timeout: 30000 });
    await expectNoBlocking(page, 'precinct field guide');
  });

  test('chair dashboard with a precinct selected', async ({ page }) => {
    await page.goto('/chair.html#precinct=3');
    await expect(page.locator('#chair-content')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.chair-matrix')).toBeVisible({ timeout: 30000 });
    await expectNoBlocking(page, 'chair dashboard');
  });

  test('targets with the strategy catalogue open', async ({ page }) => {
    await page.goto('/targets.html');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    await page.click('#tg-strategy-btn');
    await expect(page.locator('.strat-card').first()).toBeVisible();
    await expectNoBlocking(page, 'targets catalogue open');
  });

  test('keyboard smoke: skip link reaches the list; glossary returns focus', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 });
    // skip link -> list view
    await page.locator('#cc-skip-map').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cc-list')).toBeVisible();
    // glossary: open a term on targets, Escape returns focus to the term
    await page.goto('/targets.html');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    const term = page.locator('.term[data-term]').first();
    if (await term.count()) {
      await term.click();
      await expect(page.locator('.glossary-pop')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.glossary-pop')).toBeHidden();
      await expect(term).toBeFocused();
    }
  });
});
