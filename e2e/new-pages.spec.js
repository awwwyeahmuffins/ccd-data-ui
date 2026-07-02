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
    await page.selectOption('#el-county', 'cd-3');
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
    await page.goto('/forecast.html?dl#county=cd-3&race=governor-2022');
    await page.waitForFunction(
      () => document.querySelector('#fc-outcome .outcome-grid'), null, { timeout: 30000 });
    await expect(page.locator('#fc-county')).toHaveValue('cd-3');
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
    await page.locator('.site-nav a[href="elections.html"]').click();
    await page.waitForSelector('.family-group', { timeout: 30000 });
    await expect(page).toHaveURL(/elections\.html/);
  });

  test('sibling pages expose the Methodology tab', async ({ page }) => {
    await page.goto('/elections.html');
    await page.waitForSelector('.family-group', { timeout: 30000 });
    await expect(page.locator('.site-nav a[href="methodology.html"]')).toBeVisible();
  });
});
