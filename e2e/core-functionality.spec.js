// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Core Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index-new.html');
    // Wait for app to initialize
    await page.waitForSelector('#map');
    await page.waitForTimeout(1000); // Wait for map tiles to load
  });

  test('page loads successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/Collin County Elections/);
  });

  test('map renders with precincts', async ({ page }) => {
    const mapContainer = page.locator('#map-container');
    await expect(mapContainer).toBeVisible();
    
    // Check for Leaflet controls
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    await expect(zoomIn).toBeVisible();
  });

  test('header displays correctly', async ({ page }) => {
    const header = page.locator('#app-header');
    await expect(header).toBeVisible();
    
    // Check brand
    const brand = page.locator('.header-brand');
    await expect(brand).toContainText('Collin County Elections');
  });

  test('view mode buttons are present', async ({ page }) => {
    const demographicsBtn = page.locator('[data-view="demographics"]');
    const electionsBtn = page.locator('[data-view="election"]');
    const turnoutBtn = page.locator('[data-view="turnout"]');
    
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
    
    // Wait for elections to load
    await page.waitForSelector('.election-item');
    
    // Check election groups exist (using .group-header class)
    const groups = page.locator('.group-header');
    await expect(groups).toHaveCount(await groups.count());
    expect(await groups.count()).toBeGreaterThan(0);
  });
});

test.describe('Election Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index-new.html');
    await page.waitForSelector('#map');
    await page.waitForTimeout(1000);
  });

  test('selecting election updates info card', async ({ page }) => {
    // Open panel
    await page.locator('#fab').click();
    await page.waitForSelector('.election-item');
    
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
    await page.waitForSelector('.election-item');
    
    // Click an election
    await page.locator('.election-item').first().click();
    
    // Check URL contains race parameter
    await expect(page).toHaveURL(/#race=/);
  });

  test('deep linking to election works', async ({ page }) => {
    // Navigate directly with election in URL
    await page.goto('/index-new.html#race=Governor_2022.csv');
    await page.waitForSelector('#map');
    await page.waitForTimeout(2000);
    
    // Check info card shows Governor election
    const title = page.locator('.info-card-title');
    await expect(title).toContainText('Governor');
  });
});

test.describe('Search & Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index-new.html');
    await page.waitForSelector('#map');
    await page.locator('#fab').click();
    await page.waitForSelector('.election-item');
  });

  test('search filters elections', async ({ page }) => {
    const searchInput = page.locator('#election-search');
    await searchInput.fill('President');
    
    // Wait for filter
    await page.waitForTimeout(300);
    
    // Check visible elections
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
    
    // Should show 211 elections
    const allChip = page.locator('.filter-chip:has-text("All")');
    await expect(allChip).toContainText('211');
  });
});
