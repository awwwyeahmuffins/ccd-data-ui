// @ts-check
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

// Coordinates inside Collin County (downtown McKinney) used by the mocks
const MOCK_GEOCODE = [{ lat: '33.1972', lon: '-96.6398', display_name: '123 Main St, McKinney, TX' }];

test.describe('Address Lookup', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({ json: MOCK_GEOCODE })
    );
    await page.goto('/precinct.html');
    await page.waitForSelector('#precinct-search:not([disabled])', { timeout: 60000 });
  });

  test('typing an address offers an address search action', async ({ page }) => {
    await page.fill('#precinct-search', '123 Main St McKinney');
    const action = page.locator('[data-action="address"]');
    await expect(action).toBeVisible();
    await expect(action).toContainText('123 Main St McKinney');
  });

  test('address search resolves to a precinct report', async ({ page }) => {
    await page.fill('#precinct-search', '123 Main St McKinney');
    await page.locator('[data-action="address"]').click();

    const hero = page.locator('.hero-precinct-code');
    await expect(hero).toContainText('Precinct', { timeout: 15000 });
  });

  test('numeric input still searches precinct codes, not addresses', async ({ page }) => {
    await page.fill('#precinct-search', '10');
    await expect(page.locator('.dropdown-item').first()).toContainText('Precinct 10');
    await expect(page.locator('[data-action="address"]')).toHaveCount(0);
  });

  test('unmatched address shows a friendly notice', async ({ page }) => {
    await page.unroute('**/nominatim.openstreetmap.org/**');
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({ json: [] })
    );
    await page.fill('#precinct-search', 'nowhere imaginary lane');
    await page.locator('[data-action="address"]').click();
    await expect(page.locator('body')).toContainText(/Couldn't find/i, { timeout: 10000 });
  });

  test('use-my-location button finds the precinct', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 33.1972, longitude: -96.6398 });
    await page.click('#use-location-btn');
    await expect(page.locator('.hero-precinct-code')).toContainText('Precinct', { timeout: 15000 });
  });
});

test.describe('Map page locate control', () => {
  test('locate button selects the precinct on the map', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 33.1972, longitude: -96.6398 });
    await page.goto('/classic.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await page.keyboard.press('Escape'); // dismiss welcome

    const locate = page.locator('.leaflet-control-locate a');
    await expect(locate).toBeVisible();
    await locate.click();

    const infoCard = page.locator('#info-card');
    await expect(infoCard).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator('.info-card-title')).toContainText('Precinct');
  });
});
