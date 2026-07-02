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
    await page.click('#ex-head th[data-col="population"]');
    await expect(page.locator('#ex-head th[data-col="population"]')).toHaveClass(/sorted/);
  });

  test('opens on the Summary view with a scannable column set', async ({ page }) => {
    await load(page);
    await expect(page.locator('#ex-views button[data-view="summary"]')).toHaveAttribute('aria-pressed', 'true');
    // summary: precinct + ~8 headline columns, no 60-column wall
    const headers = await page.locator('#ex-head th').count();
    expect(headers).toBeGreaterThan(5);
    expect(headers).toBeLessThan(12);
    // the spreadsheet's column picker is hidden until asked for
    await expect(page.locator('details.cols')).toBeHidden();
  });

  test('topic tabs show just that topic\'s columns', async ({ page }) => {
    await load(page);
    await page.click('#ex-views button[data-view="housing"]');
    await expect(page.locator('#ex-views button[data-view="housing"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ex-head th[data-col="medianHomeValue"]')).toBeVisible();
    expect(await page.locator('#ex-head th').count()).toBeLessThan(12);
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

  test('the full spreadsheet is an explicit toggle, with the column picker', async ({ page }) => {
    await load(page);
    await page.click('#ex-views button[data-view="all"]');
    await expect(page.locator('details.cols')).toBeVisible();
    const before = await page.locator('#ex-head th').count();
    await page.click('details.cols summary');
    await page.check('input[data-col="pctVeterans"]'); // a non-default metric
    expect(await page.locator('#ex-head th').count()).toBe(before + 1);
  });

  test('precinct cells deep-link to the report', async ({ page }) => {
    await load(page);
    const href = await page.locator('#ex-body .pcell-precinct a').first().getAttribute('href');
    expect(href).toMatch(/precinct\.html#precinct=/);
  });
});
