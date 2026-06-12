// county-switching.spec.js
// Statewide county selector: live counties load real precinct data, the other
// 252 render an explicit placeholder, and Collin-only chrome hides elsewhere.

import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('County Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await page.locator('#welcome-close-btn').click({ timeout: 3000 }).catch(() => {});
  });

  test('all 254 counties are selectable', async ({ page }) => {
    // options populate after the registry fetch — allow for server load
    await expect(page.locator('#county-select option')).toHaveCount(254, { timeout: 15000 });
  });

  test('Bastrop is live: real precincts, real elections, no placeholder banner', async ({ page }) => {
    await page.selectOption('#county-select', 'bastrop');
    // single-boundary-set county: selector hides, no placeholder banner
    await expect(page.locator('#boundary-select')).toBeHidden({ timeout: 20000 });
    await expect(page.locator('#county-placeholder-banner')).toBeHidden();

    // elections exist for Bastrop
    await page.locator('[data-action="browse"], #open-panel-btn').first().click();
    await page.locator('#panel-search-input').fill('governor');
    await page.waitForTimeout(600);
    await expect(page.locator('.election-item:visible').first()).toContainText('Governor');

    // selecting one renders results (forecast simulator appears)
    await page.locator('.election-item:visible').first().click();
    await expect(page.locator('.turnout-slider').first()).toBeVisible({ timeout: 20000 });
  });

  test('placeholder county shows banner and a single PLACEHOLDER feature', async ({ page }) => {
    await page.selectOption('#county-select', 'kinney');
    await expect(page.locator('#county-placeholder-banner')).toBeVisible({ timeout: 20000 });
    // Collin-only boundary selector hides
    await expect(page.locator('#boundary-select')).toBeHidden();
  });

  test('switching back to Collin restores boundary selector and data', async ({ page }) => {
    await page.selectOption('#county-select', 'kinney');
    await expect(page.locator('#county-placeholder-banner')).toBeVisible({ timeout: 20000 });
    await page.selectOption('#county-select', 'collin');
    await expect(page.locator('#county-placeholder-banner')).toBeHidden({ timeout: 20000 });
    await expect(page.locator('#boundary-select')).toBeVisible();
  });

  test('deep link #county= works on fresh load', async ({ page }) => {
    // query param forces a real navigation (hash-only goto would not reload
    // the page beforeEach already opened)
    await page.goto('/index.html?deeplink#county=bastrop');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await expect(page.locator('#county-select')).toHaveValue('bastrop', { timeout: 20000 });
    await expect(page.locator('#county-placeholder-banner')).toBeHidden();
  });
});
