// county-switching.spec.js
// Statewide county selector: live counties load real precinct data, the other
// 252 render an explicit placeholder, and Collin-only chrome hides elsewhere.

import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('County Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/classic.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await page.locator('#welcome-close-btn').click({ timeout: 3000 }).catch(() => {});
  });

  test('all 254 counties plus district views are selectable', async ({ page }) => {
    // counties sit outside optgroups; district views inside optgroups
    await expect(page.locator('#county-select > option')).toHaveCount(254, { timeout: 15000 });
    const districts = await page.locator('#county-select optgroup option').count();
    expect(districts).toBeGreaterThanOrEqual(1); // CD/SD/HD groups when built
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

    // selecting one renders results; the forecast simulator lives in the Forecast tab
    await page.locator('.election-item:visible').first().click();
    await page.locator('.panel-tab[data-panel-tab="forecast"]').click();
    await expect(page.locator('.turnout-slider').first()).toBeVisible({ timeout: 20000 });
  });

  test('VEST-sourced county (Kinney) is live with statewide races', async ({ page }) => {
    await page.selectOption('#county-select', 'kinney');
    // single-set county: boundary selector hides; no placeholder banner
    await expect(page.locator('#boundary-select')).toBeHidden({ timeout: 20000 });
    await expect(page.locator('#county-placeholder-banner')).toBeHidden();
    await page.locator('[data-action="browse"], #open-panel-btn').first().click();
    await page.locator('#panel-search-input').fill('president');
    await page.waitForTimeout(600);
    await expect(page.locator('.election-item:visible').first()).toContainText('President');
  });

  test('switching back to Collin restores boundary selector', async ({ page }) => {
    await page.selectOption('#county-select', 'kinney');
    await expect(page.locator('#boundary-select')).toBeHidden({ timeout: 20000 });
    await page.selectOption('#county-select', 'collin');
    await expect(page.locator('#boundary-select')).toBeVisible({ timeout: 20000 });
  });

  test('deep link #county= works on fresh load', async ({ page }) => {
    // query param forces a real navigation (hash-only goto would not reload
    // the page beforeEach already opened)
    await page.goto('/classic.html?deeplink#county=bastrop');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await expect(page.locator('#county-select')).toHaveValue('bastrop', { timeout: 20000 });
    await expect(page.locator('#county-placeholder-banner')).toBeHidden();
  });

  test('no placeholder county entries remain', async ({ page }) => {
    await expect(page.locator('#county-select optgroup[label*="placeholder"] option'))
      .toHaveCount(0, { timeout: 15000 });
  });

  test('selecting a federal district race jumps to the full cross-county district view', async ({ page }) => {
    // From the default Collin view, pick the CD-3 race: the app must switch to
    // the cd-3 district view (all member counties' precincts), not stay in
    // Collin with part of the district missing.
    await page.locator('[data-action="browse"], #open-panel-btn').first().click();
    await page.locator('#panel-search-input').fill('United States Representative District 3');
    await page.waitForTimeout(600);
    // the search also surfaces District 32 — click exactly District 3
    await page.locator('.election-item:visible', { hasText: /District 3 \(2024\)/ }).first().click();
    await expect(page.locator('#county-select')).toHaveValue('cd-3', { timeout: 30000 });
    // the contest itself is selected in the district view — the result topline
    // renders (panel-state-independent, unlike the Forecast tab's simulator)
    await expect(page.locator('#result-topline')).toBeVisible({ timeout: 20000 });
  });

  test('full Texas statewide view loads all 254 counties with statewide races', async ({ page }) => {
    await page.goto('/classic.html?tx#county=texas');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await expect(page.locator('#county-select')).toHaveValue('texas', { timeout: 20000 });
    await expect(page.locator('#county-placeholder-banner')).toBeHidden();
    // statewide races are browsable
    await page.locator('[data-action="browse"], #open-panel-btn').first().click();
    await page.locator('#panel-search-input').fill('governor');
    await page.waitForTimeout(600);
    await expect(page.locator('.election-item:visible').first()).toContainText('Governor');
    // clicking a county polygon drills into that county's precinct view — the
    // canvas renderer has no path elements, so click into the map. Texas's
    // bounding-box centre can fall in the west-Texas gap between polygons, so
    // try a few interior points until the statewide selection flips.
    await page.keyboard.press('Escape'); // close panel
    const box = await page.locator('#map').boundingBox();
    for (const [fx, fy] of [[0.45, 0.55], [0.5, 0.5], [0.55, 0.45], [0.4, 0.6], [0.6, 0.5]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(1000);
      if ((await page.locator('#county-select').inputValue()) !== 'texas') break;
    }
    await expect(page.locator('#county-select')).not.toHaveValue('texas', { timeout: 20000 });
  });

  test('cross-county district view loads (CD-3 spans multiple counties)', async ({ page }) => {
    await page.goto('/classic.html?dl#county=cd-3');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await expect(page.locator('#county-select')).toHaveValue('cd-3', { timeout: 20000 });
    await expect(page.locator('#county-placeholder-banner')).toBeHidden();
    await page.locator('[data-action="browse"], #open-panel-btn').first().click();
    await page.locator('#panel-search-input').fill('governor');
    await page.waitForTimeout(600);
    await expect(page.locator('.election-item:visible').first()).toContainText('Governor');
  });
});
