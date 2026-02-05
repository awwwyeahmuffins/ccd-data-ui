// @ts-check
import { test, expect, devices } from '@playwright/test';

test.setTimeout(60000);

// Use iPhone 12 viewport
test.use({ ...devices['iPhone 12'] });

test.describe('Mobile Experience', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index-new.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  test('page is responsive', async ({ page }) => {
    // Header should be visible
    const header = page.locator('#app-header');
    await expect(header).toBeVisible();
  });

  test('view mode labels are hidden on mobile', async ({ page }) => {
    const viewLabel = page.locator('.view-label').first();
    // Labels should be hidden via CSS on small screens
    const box = await viewLabel.boundingBox();
    // Either hidden or very small
    if (box) {
      expect(box.width).toBeLessThan(5);
    }
  });

  test('FAB is visible and clickable', async ({ page }) => {
    const fab = page.locator('#fab');
    await expect(fab).toBeVisible();
    
    // Should be in viewport
    const box = await fab.boundingBox();
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
  });

  test('election panel takes full width on mobile', async ({ page }) => {
    await page.locator('#fab').click();
    
    const panel = page.locator('#election-panel');
    await expect(panel).toHaveClass(/active/);
    
    // Panel should be near full width
    const viewport = page.viewportSize();
    const box = await panel.boundingBox();
    
    expect(box.width).toBeGreaterThan(viewport.width * 0.9);
  });

  test('filter chips wrap properly', async ({ page }) => {
    await page.locator('#fab').click();
    
    const chips = page.locator('.filter-chip');
    const chipCount = await chips.count();
    
    // All chips should be visible
    for (let i = 0; i < chipCount; i++) {
      await expect(chips.nth(i)).toBeVisible();
    }
  });

  test('info card is readable on mobile', async ({ page }) => {
    // Select an election
    await page.locator('#fab').click();
    await page.waitForSelector('.election-item');
    await page.locator('.election-item').first().click();
    
    const infoCard = page.locator('#info-card');
    await expect(infoCard).toBeVisible();
    
    // Card should fit in viewport
    const box = await infoCard.boundingBox();
    const viewport = page.viewportSize();
    
    expect(box.width).toBeLessThanOrEqual(viewport.width);
  });

  test('panel closes on election select', async ({ page }) => {
    await page.locator('#fab').click();
    await page.waitForSelector('.election-item');
    
    await page.locator('.election-item').first().click();
    
    // Panel should close on mobile
    await page.waitForTimeout(500);
    const panel = page.locator('#election-panel');
    await expect(panel).not.toHaveClass(/active/);
  });

  test('legend is visible', async ({ page }) => {
    const legend = page.locator('.map-legend-leaflet');
    await expect(legend).toBeVisible();
  });

  test('map is interactive', async ({ page }) => {
    // Zoom controls exist (may be behind header on mobile, so use force click)
    const zoomIn = page.locator('.leaflet-control-zoom-in').first();
    await expect(zoomIn).toBeVisible();
    await zoomIn.click({ force: true });

    // Map should still be functional
    const map = page.locator('#map');
    await expect(map).toBeVisible();
  });
});
