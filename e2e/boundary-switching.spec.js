// boundary-switching.spec.js
// The app is pinned to the CURRENT (2026, 273-precinct) Collin boundary set
// for demographic views; district subjects carry their own single boundary
// set. Switching subject must rebuild the precinct layer on the right vintage,
// and a Collin round-trip must land back on 2026. Landed in Phase 1 to guard
// Phase 3 (the per-boundary data service must keep this behavior while making
// switch-back instant).
import { test, expect } from '@playwright/test';

test.setTimeout(90000); // the Python http.server is slow under load

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

async function mapLoaded(page) {
  await expect(page.locator('.cc-app')).toBeVisible();
  await expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 });
}

const paths = (page) => page.locator('#cc-map svg path.leaflet-interactive');

test.describe('Map boundary vintages', () => {
  test('Collin opens on the 2026 set (273 precincts)', async ({ page }) => {
    await page.goto('/index.html');
    await mapLoaded(page);
    await expect(paths(page)).toHaveCount(273, { timeout: 30000 });
  });

  test('district scope filters the 2026 set; clearing it restores every precinct', async ({ page }) => {
    // Districts are a SCOPE on the Collin map (REDESIGN §5.2), not a separate
    // boundary set — the vintage never changes on a scope round-trip.
    await page.goto('/index.html');
    await mapLoaded(page);
    await page.selectOption('#cc-district', 'cd-3');
    await expect(paths(page)).toHaveCount(164, { timeout: 30000 });
    await page.selectOption('#cc-district', '');
    await expect(paths(page)).toHaveCount(273, { timeout: 30000 });
  });

  test('leaving a race returns the map to the current-precinct set', async ({ page }) => {
    await page.goto('/index.html');
    await mapLoaded(page);
    await page.click('#cc-race-btn');
    await page.fill('#cc-race-search', 'president');
    await page.locator('#cc-race-list [data-race]:not([data-race=""])').first().click();
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Race Results', { timeout: 30000 });
    // Exiting the race (clear-race lives in the dock; on tablets the dock is a
    // slide-over) returns the map to the 2026 precincts.
    const dockToggle = page.locator('#cc-dock-toggle');
    if (await dockToggle.isVisible()) await dockToggle.click();
    await page.click('#cc-clear-race');
    await expect(page.locator('#cc-race-name')).toHaveText('Choose a race');
    await expect(paths(page)).toHaveCount(273, { timeout: 30000 });
  });
});

test.describe('Other pages sit on the current set', () => {
  test('the precinct report badges the 2026 boundary vintage', async ({ page }) => {
    await page.goto('/precinct.html#county=collin&precinct=3');
    await page.waitForSelector('#report-container:not(.hidden)', { timeout: 30000 });
    await expect(page.locator('.boundary-label').first()).toContainText('2026');
  });

  test('the data table counts all 273 current precincts', async ({ page }) => {
    await page.goto('/explore.html');
    await expect(page.locator('#ex-body tr').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#ex-count')).toContainText('of 273 precincts');
  });
});
