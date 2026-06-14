// explore.spec.js — smoke coverage for the precinct Explorer (explore.html).
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function load(page) {
  await page.goto('/explore.html');
  await expect(page.locator('#ex-body tr').first()).toBeVisible({ timeout: 30000 });
  // wait until real rows (not the "Loading…" placeholder) are present
  await expect(page.locator('#ex-body .pcell-precinct').first()).toBeVisible({ timeout: 30000 });
}

test.describe('Explore view', () => {
  test('renders a sortable table with many metrics', async ({ page }) => {
    await load(page);
    expect(await page.locator('#ex-sort option').count()).toBeGreaterThanOrEqual(30);
    expect(await page.locator('#ex-head th').count()).toBeGreaterThan(5);
    expect(await page.locator('#ex-body tr').count()).toBeGreaterThan(50);
    await expect(page.locator('#ex-count')).toContainText(/Showing \d+ of \d+ precincts/);
  });

  test('sorts by highest income by default and re-sorts on change', async ({ page }) => {
    await load(page);
    await expect(page.locator('#ex-sort')).toHaveValue('medianIncome');
    // switch to most families
    await page.selectOption('#ex-sort', 'familyHouseholds');
    await expect(page.locator('#ex-head th.sorted')).toContainText('Family households');
    await expect(page.locator('#ex-body tr').first()).toBeVisible();
  });

  test('clicking a column header sorts by it', async ({ page }) => {
    await load(page);
    await page.click('#ex-head th[data-col="medianAge"]');
    await expect(page.locator('#ex-head th[data-col="medianAge"]')).toHaveClass(/sorted/);
  });

  test('numeric + party filters narrow the rows', async ({ page }) => {
    await load(page);
    const total = await page.locator('#ex-body tr').count();
    await page.selectOption('#ex-fmetric', 'medianIncome');
    await page.fill('#ex-fval', '150000');
    await page.click('#ex-addfilter');
    await expect(page.locator('.fchip')).toHaveCount(1);
    const filtered = await page.locator('#ex-body tr').count();
    expect(filtered).toBeLessThan(total);
    await page.selectOption('#ex-party', 'Dem');
    await expect(page.locator('#ex-count')).toContainText('of');
  });

  test('column picker adds a column', async ({ page }) => {
    await load(page);
    const before = await page.locator('#ex-head th').count();
    await page.click('details.cols summary');
    await page.check('input[data-col="medianHomeValue"]');
    expect(await page.locator('#ex-head th').count()).toBe(before + 1);
  });

  test('precinct cells deep-link to the report', async ({ page }) => {
    await load(page);
    const href = await page.locator('#ex-body .pcell-precinct a').first().getAttribute('href');
    expect(href).toMatch(/precinct\.html#county=[^&]+&precinct=/);
  });
});
