// new-pages.spec.js
// elections.html (race catalog) and forecast.html (scenario builder):
// standalone pages that reuse the root js/ libraries, no js/app/* imports.

import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('Elections catalog page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/elections.html');
    await page.waitForSelector('.family-group', { timeout: 30000 });
  });

  test('lists races grouped by category', async ({ page }) => {
    const headers = await page.locator('.family-header span:first-child').allTextContents();
    expect(headers).toContain('Federal');
    expect(headers).toContain('State');
  });

  test('search narrows the list', async ({ page }) => {
    await page.locator('#el-search').fill('governor');
    await page.waitForTimeout(500);
    await expect(page.locator('#el-count')).toContainText('of');
    await expect(page.locator('.race-row').first()).toContainText(/Governor/);
  });

  test('map link deep-links to the map page with the race', async ({ page }) => {
    await page.locator('#el-search').fill('president');
    await page.waitForTimeout(500);
    const href = await page.locator('.race-row .act-map').first().getAttribute('href');
    expect(href).toMatch(/^index\.html#county=collin&race=/);
  });

  test('county switch reloads the catalog', async ({ page }) => {
    await page.selectOption('#el-county', 'bastrop');
    await page.waitForSelector('.family-group', { timeout: 30000 });
    const count = await page.locator('#el-count').textContent();
    expect(count).toMatch(/^\d+ races?/);
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

  test('deep link selects county and race', async ({ page }) => {
    await page.goto('/forecast.html?dl#county=bastrop&race=governor-2022');
    await page.waitForFunction(
      () => document.querySelector('#fc-outcome .outcome-grid'), null, { timeout: 30000 });
    await expect(page.locator('#fc-county')).toHaveValue('bastrop');
    await expect(page.locator('#fc-race')).toHaveValue(/[Gg]overnor/);
  });
});
