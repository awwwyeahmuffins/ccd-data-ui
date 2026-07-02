// targets.spec.js — smoke coverage for the precinct-targeting view (targets.html).
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function load(page) {
  await page.goto('/targets.html');
  // results-first IA: the ranked list renders immediately (default strategy)
  await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
}

// The 15-strategy catalogue sits behind one "Change strategy" disclosure.
async function openCatalog(page) {
  if (await page.locator('#tg-catalog-wrap').isHidden()) {
    await page.click('#tg-strategy-btn');
  }
  await expect(page.locator('.strat-card').first()).toBeVisible();
}

test.describe('Targets view', () => {
  test('leads with a ranked list, catalogue behind one disclosure', async ({ page }) => {
    await load(page);
    // start-here default: closest races are already ranked, no choice required
    await expect(page.locator('#tg-results-title')).toHaveText('Closest Races');
    expect(await page.locator('.tg-precinct').count()).toBeGreaterThan(0);
    // the catalogue is one labelled disclosure away, never a wall of 15 cards
    await expect(page.locator('#tg-strategy-btn')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#tg-strategy-btn')).toContainText('Closest Races');
    await openCatalog(page);
    expect(await page.locator('.strat-card').count()).toBeGreaterThanOrEqual(12);
    expect(await page.locator('.strat-cat').count()).toBe(4);
  });

  test('selecting a strategy re-ranks the list', async ({ page }) => {
    await load(page);
    await openCatalog(page);
    await page.click('.strat-card[data-strat="flip-rep-dem"]');
    await expect(page.locator('#tg-results-title')).toHaveText('Flippable to Democrats');
    await expect(page.locator('.strat-card[data-strat="flip-rep-dem"]')).toHaveClass(/active/);
    await expect(page.locator('.tg-precinct').first()).toBeVisible();
  });

  test('precinct rows deep-link straight to the report', async ({ page }) => {
    await load(page);
    const href = await page.locator('.tg-link-report').first().getAttribute('href');
    expect(href).toMatch(/precinct\.html#precinct=/);
  });

  test('turnout strategies are available where turnout data exists (Collin)', async ({ page }) => {
    await load(page);
    await openCatalog(page);
    await expect(page.locator('.strat-card[data-strat="turnout-gap"]')).not.toBeDisabled();
    await page.click('.strat-card[data-strat="turnout-gap"]');
    await expect(page.locator('#tg-results-title')).toHaveText('Turnout Opportunity');
    await expect(page.locator('.tg-precinct').first()).toBeVisible();
  });

  test('the district scope limits the ranking to its Collin precincts', async ({ page }) => {
    await load(page);
    await page.selectOption('#tg-district', 'cd-32');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    // CD-32 touches only 8 Collin precincts — the ranking can't exceed that.
    expect(await page.locator('.tg-precinct').count()).toBeLessThanOrEqual(8);
    // the scope is named in the results header and carried in the hash
    await expect(page.locator('#tg-results-title')).toContainText('Congressional District 32');
    expect(page.url()).toMatch(/district=cd-32/);
    expect(page.url()).not.toMatch(/county=/);
    // the Map link carries the scope forward
    await expect(page.locator('.tg-link-map').first()).toHaveAttribute('href', /district=cd-32/);
  });

  test('scoring on a specific election filters to that ballot and re-ranks', async ({ page }) => {
    // deep-link straight to a sub-county race (HD-89) — only its precincts should rank
    await page.goto('/targets.html#county=collin&race=state-representative-district-89-2024&strategy=tossups&top=100');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#tg-election')).toHaveValue('state-representative-district-89-2024');
    await expect(page.locator('#tg-results-sub')).toContainText('Scored on State Representative District 89');
    const onBallot = await page.locator('.tg-precinct').count();
    // sub-county race: far fewer than the full county's ~250 scored precincts
    expect(onBallot).toBeGreaterThan(0);
    expect(onBallot).toBeLessThan(120);
    // clearing the election restores the full-county ranking
    await page.selectOption('#tg-election', '');
    await expect(page.locator('.tg-precinct').first()).toBeVisible();
    expect(await page.locator('.tg-precinct').count()).toBeGreaterThan(onBallot);
  });
});
