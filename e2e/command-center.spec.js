// command-center.spec.js
// Smoke coverage for the Command Center front door (index.html) — the
// "peanut butter & chocolate" dashboard. Auth is bypassed on localhost.
import { test, expect } from '@playwright/test';

test.setTimeout(60000); // the Python http.server is slow under load

// Wait until the dock has briefed the county (data fully loaded).
async function waitForLoaded(page) {
  await page.goto('/index.html');
  await expect(page.locator('.cc-app')).toBeVisible();
  await expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 });
}

test.describe('Command Center', () => {
  test('loads the dashboard with a county briefing', async ({ page }) => {
    await waitForLoaded(page);
    await expect(page.locator('#cc-map canvas')).toBeVisible();
    await expect(page.locator('#cc-dock-title')).toContainText('County');
    // brand to the active county in the tab title
    await expect(page).toHaveTitle(/County — Precinct Command/);
  });

  test('is focused on Collin County only', async ({ page }) => {
    await waitForLoaded(page);
    await expect(page.locator('#cc-county-name')).toHaveText('Collin County');
    await page.click('#cc-county-btn');
    // Collin-focus: the county menu offers only Collin.
    await expect(page.locator('.cc-county-opt[data-slug]')).toHaveCount(1);
    await expect(page.locator('.cc-county-opt[data-slug="collin"]')).toHaveCount(1);
  });

  test('the three analytic modes switch', async ({ page }) => {
    await waitForLoaded(page);
    for (const mode of ['margin', 'diversity', 'lean']) {
      await page.click(`.cc-mode-btn[data-mode="${mode}"]`);
      await expect(page.locator(`.cc-mode-btn[data-mode="${mode}"]`)).toHaveClass(/active/);
    }
  });

  test('clicking a precinct opens its detail in the dock', async ({ page }) => {
    await waitForLoaded(page);
    const map = page.locator('#cc-map');
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct', { timeout: 10000 });
    await expect(page.locator('#cc-dock-title')).toContainText('Precinct');
  });

  test('theme toggle flips and persists across reload', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-theme-btn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // reset for other runs
    await page.click('#cc-theme-btn');
  });

  test('rail and dock link out to the standalone tools', async ({ page }) => {
    await waitForLoaded(page);
    await expect(page.locator('.cc-rail a[href="elections.html"]')).toHaveCount(1);
    await expect(page.locator('.cc-rail a[href="forecast.html"]')).toHaveCount(1);
    await expect(page.locator('.cc-rail a[href="targets.html"]')).toHaveCount(1);
    await expect(page.locator('.cc-rail a[href="precinct.html"]')).toHaveCount(1);
  });
});
