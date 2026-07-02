// new-pages.spec.js
// elections.html (race catalog) and forecast.html (scenario builder):
// standalone pages that reuse the root js/ libraries, no js/app/* imports.

import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('Elections redirect stub (Phase 5)', () => {
  test('elections.html forwards to the Map, carrying a race deep link', async ({ page }) => {
    // The race catalog folded into the shared race picker; old bookmarks land
    // on the Map with their #race= intact (stub removed entirely in Phase 6).
    await page.goto('/elections.html#race=governor-2022');
    await expect(page).toHaveURL(/index\.html#race=governor-2022/, { timeout: 15000 });
    await expect(page.locator('.cc-app')).toBeVisible();
  });
});

test.describe('Forecast scenario page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/forecast.html');
    await page.waitForFunction(
      () => document.querySelector('#fc-outcome .outcome-grid'), null, { timeout: 30000 });
  });

  test('defaults to a federal race with actual results shown', async ({ page }) => {
    await expect(page.locator('#fc-outcome')).toContainText('Actual result');
    await expect(page.locator('#fc-outcome')).toContainText('Your scenario');
  });

  test('preset changes the simulated outcome', async ({ page }) => {
    await page.locator('[data-preset="dem-surge"]').click();
    await page.waitForTimeout(800);
    // Dem surge over the actual result must change the scenario column or flips
    await expect(page.locator('.flip-callout')).not.toContainText('actual recorded outcome');
  });

  test('moving a slider switches to the custom preset', async ({ page }) => {
    await page.locator('input[data-party="Rep"]').fill('70');
    await page.waitForTimeout(600);
    await expect(page.locator('[data-preset="custom"]')).toHaveClass(/active/);
  });

  test('a legacy county deep link still resolves its race', async ({ page }) => {
    // Old bookmarks carried #county= — read-tolerated, never written (§3.5).
    await page.goto('/forecast.html?dl#county=cd-3&race=governor-2022');
    await page.waitForFunction(
      () => document.querySelector('#fc-outcome .outcome-grid'), null, { timeout: 30000 });
    await expect(page.locator('#fc-race-name')).toContainText(/[Gg]overnor/);
  });
});

test.describe('Methodology page', () => {
  test('loads with title and active nav tab', async ({ page }) => {
    await page.goto('/methodology.html');
    await expect(page.locator('h1.page-title')).toBeVisible();
    await expect(page.locator('h1.page-title')).toHaveText('How It Works');
    // Methodology nav link is the active one on this page
    await expect(page.locator('.site-nav a[href="methodology.html"]')).toHaveAttribute('aria-current', 'page');
    // Key sections are present
    await expect(page.locator('#limits')).toBeVisible();
    await expect(page.locator('#privacy')).toBeVisible();
  });

  test('nav links out to a sibling page', async ({ page }) => {
    await page.goto('/methodology.html');
    await page.locator('.site-nav a[href="explore.html"]').click();
    await page.waitForSelector('#ex-body tr', { timeout: 30000 });
    await expect(page).toHaveURL(/explore\.html/);
  });

  test('sibling pages expose the Methodology tab', async ({ page }) => {
    await page.goto('/targets.html');
    await expect(page.locator('.site-nav a[href="methodology.html"]')).toBeVisible();
  });

  test('the Forecast stays reachable in context (outside the nav)', async ({ page }) => {
    // §3.5 rule 2 — no leaf pages, and no orphaned tools: Priority Precincts
    // and How It Works are the Forecast's inbound doors.
    await page.goto('/methodology.html');
    await expect(page.locator('main a[href="forecast.html"]')).toBeVisible();
    await page.goto('/targets.html');
    await expect(page.locator('main a[href="forecast.html"]')).toBeVisible();
  });
});
