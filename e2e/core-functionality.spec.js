// @ts-check
import { test, expect } from '@playwright/test';

// Increase test timeout to account for single-threaded Python http.server
// under parallel load (map initialization requires fetching GeoJSON + CDN scripts)
test.setTimeout(60000);

test.describe('Core Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Wait for map legend which appears after initializeMap() completes
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  test('page loads successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/Texas Elections/);
  });

  test('map renders with precincts', async ({ page }) => {
    const mapContainer = page.locator('#map-container');
    await expect(mapContainer).toBeVisible();

    // Wait for Leaflet to fully initialize (depends on CDN + data loading)
    // Use .first() since mapInitializer adds a second zoom control
    const zoomIn = page.locator('.leaflet-control-zoom-in').first();
    await expect(zoomIn).toBeVisible({ timeout: 60000 });
  });

  test('header displays correctly', async ({ page }) => {
    const header = page.locator('#app-header');
    await expect(header).toBeVisible();
    
    // Check brand
    const brand = page.locator('.header-brand');
    await expect(brand).toContainText('Texas Elections');
  });

  test('view mode buttons are present', async ({ page }) => {
    // Scope to the header tablist — data-view also appears on the mobile
    // tab bar and welcome feature cards
    const demographicsBtn = page.locator('.view-mode-buttons [data-view="demographics"]');
    const electionsBtn = page.locator('.view-mode-buttons [data-view="election"]');
    const turnoutBtn = page.locator('.view-mode-buttons [data-view="turnout"]');

    await expect(demographicsBtn).toBeVisible();
    await expect(electionsBtn).toBeVisible();
    await expect(turnoutBtn).toBeVisible();
  });

  test('FAB button opens election panel', async ({ page }) => {
    const fab = page.locator('#fab');
    await expect(fab).toBeVisible();
    
    // Click FAB
    await fab.click();
    
    // Check panel is open
    const panel = page.locator('#election-panel');
    await expect(panel).toHaveClass(/active/);
  });

  test('election panel shows elections', async ({ page }) => {
    // Open panel
    await page.locator('#fab').click();

    // Wait for election groups to render (items stay hidden until expanded)
    await page.waitForSelector('.group-header');
    expect(await page.locator('.group-header').count()).toBeGreaterThan(0);
  });
});

test.describe('Welcome Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  test('shows on first visit and dismisses with close button', async ({ page }) => {
    const overlay = page.locator('#welcome-overlay');
    await expect(overlay).toBeVisible();

    await page.locator('#welcome-close-btn').click();
    await expect(overlay).toBeHidden();
  });

  test('dismisses with Escape key', async ({ page }) => {
    await expect(page.locator('#welcome-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#welcome-overlay')).toBeHidden();
  });

  test('stays dismissed after reload', async ({ page }) => {
    await page.locator('#welcome-close-btn').click();
    await page.reload();
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await expect(page.locator('#welcome-overlay')).toBeHidden();
  });
});

test.describe('Election Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Wait for map legend which appears after initializeMap() completes
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  test('selecting election updates info card', async ({ page }) => {
    // Open panel
    await page.locator('#fab').click();
    // Groups are collapsed by default (B5); expand the first one
    await page.locator('.group-header').first().click();

    // Click first election
    const firstElection = page.locator('.election-item').first();
    await firstElection.click();

    // Check info card is visible and updated
    const infoCard = page.locator('#info-card');
    await expect(infoCard).toBeVisible();

    const title = page.locator('.info-card-title');
    await expect(title).not.toBeEmpty();
  });

  test('selecting election updates URL hash', async ({ page }) => {
    // Open panel
    await page.locator('#fab').click();
    // Groups are collapsed by default (B5); expand the first one
    await page.locator('.group-header').first().click();

    // Click an election
    await page.locator('.election-item').first().click();

    // Check URL contains race parameter
    await expect(page).toHaveURL(/#race=/);
  });

  test('deep linking to election works', async ({ page }) => {
    // Navigate directly with election in URL
    await page.goto('/index.html#race=Governor_2022.csv');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    
    // Check info card shows Governor election
    const title = page.locator('.info-card-title');
    await expect(title).toContainText('Governor');
  });
});

test.describe('Search & Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Wait for map legend which appears after initializeMap() completes
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
    await page.locator('#fab').click();
    // Groups are collapsed by default; wait for group headers instead of items
    await page.waitForSelector('.group-header');
  });

  test('search filters elections', async ({ page }) => {
    const searchInput = page.locator('#panel-search-input');
    await searchInput.fill('President');

    // Wait for debounced filter and panel re-render
    await page.waitForTimeout(500);

    // Check visible elections contain President
    const visibleElections = page.locator('.election-item:visible');
    const count = await visibleElections.count();

    // Should have at least one President election
    expect(count).toBeGreaterThan(0);
  });

  test('filter chips work', async ({ page }) => {
    // Click 2024 filter
    const chip2024 = page.locator('.filter-chip:has-text("2024")');
    await chip2024.click();
    
    // Check chip is active
    await expect(chip2024).toHaveClass(/active/);
  });

  test('All filter shows all elections', async ({ page }) => {
    // First filter by 2024
    await page.locator('.filter-chip:has-text("2024")').click();

    // Then click All
    await page.locator('.filter-chip:has-text("All")').click();

    // Chip label shows the total election count, e.g. "All (199)"
    const allChip = page.locator('.filter-chip:has-text("All")');
    await expect(allChip).toHaveText(/All \(\d+\)/);
    await expect(allChip).toHaveClass(/active/);
  });
});
