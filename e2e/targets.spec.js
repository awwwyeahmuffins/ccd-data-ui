// targets.spec.js — smoke coverage for the precinct-targeting view (targets.html).
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function load(page) {
  await page.goto('/targets.html');
  await expect(page.locator('.strat-card').first()).toBeVisible({ timeout: 30000 });
  // wait until the ranked list has populated
  await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
}

test.describe('Targets view', () => {
  test('renders the full strategy catalogue and a ranked list', async ({ page }) => {
    await load(page);
    expect(await page.locator('.strat-card').count()).toBeGreaterThanOrEqual(12);
    expect(await page.locator('.strat-cat').count()).toBe(4);
    await expect(page.locator('#tg-results-title')).toHaveText('Pure Tossups');
    expect(await page.locator('.tg-precinct').count()).toBeGreaterThan(0);
  });

  test('selecting a strategy re-ranks the list', async ({ page }) => {
    await load(page);
    await page.click('.strat-card[data-strat="flip-rep-dem"]');
    await expect(page.locator('#tg-results-title')).toHaveText('Flip Rep → Dem');
    await expect(page.locator('.strat-card[data-strat="flip-rep-dem"]')).toHaveClass(/active/);
    await expect(page.locator('.tg-precinct').first()).toBeVisible();
  });

  test('precinct rows deep-link to the report with county + precinct', async ({ page }) => {
    await load(page);
    const href = await page.locator('.tg-link-report').first().getAttribute('href');
    expect(href).toMatch(/precinct\.html#county=[^&]+&precinct=/);
  });

  test('turnout strategies are available where turnout data exists (Collin)', async ({ page }) => {
    await load(page);
    await expect(page.locator('.strat-card[data-strat="turnout-gap"]')).not.toBeDisabled();
    await page.click('.strat-card[data-strat="turnout-gap"]');
    await expect(page.locator('#tg-results-title')).toHaveText('Turnout Opportunity');
    await expect(page.locator('.tg-precinct').first()).toBeVisible();
  });

  test('switching county reloads the ranking', async ({ page }) => {
    await load(page);
    await page.selectOption('#tg-county', 'cd-32');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    // report links now point at the new county
    await expect(page.locator('.tg-link-report').first()).toHaveAttribute('href', /county=cd-32/);
  });
});
