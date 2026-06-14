// @ts-check
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/classic.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  test('opens with Cmd+K', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    
    const palette = page.locator('#command-palette');
    await expect(palette).toHaveClass(/active/);
  });

  test('opens with Ctrl+K on non-Mac', async ({ page }) => {
    await page.keyboard.press('Control+k');
    
    const palette = page.locator('#command-palette');
    await expect(palette).toHaveClass(/active/);
  });

  test('closes with Escape', async ({ page }) => {
    // Open
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#command-palette')).toHaveClass(/active/);
    
    // Close
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toHaveClass(/active/);
  });

  test('shows default commands', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    
    // Check for default commands
    const demographicsItem = page.locator('.command-item:has-text("Demographics View")');
    await expect(demographicsItem).toBeVisible();
    
    const resetMapItem = page.locator('.command-item:has-text("Reset Map")');
    await expect(resetMapItem).toBeVisible();
  });

  test('search filters commands', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    
    const input = page.locator('#command-input');
    await input.fill('president');
    
    // Wait for filter
    await page.waitForTimeout(200);
    
    // Should show President election
    const presidentItem = page.locator('.command-item:has-text("President")');
    await expect(presidentItem).toBeVisible();
  });

  test('keyboard navigation works', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    
    // Press down arrow
    await page.keyboard.press('ArrowDown');
    
    // Second item should be selected
    const items = page.locator('.command-item');
    await expect(items.nth(1)).toHaveClass(/selected/);
  });

  test('Enter selects command', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.locator('#command-input').fill('president');
    await page.waitForTimeout(200);
    
    await page.keyboard.press('Enter');
    
    // Palette should close
    await expect(page.locator('#command-palette')).not.toHaveClass(/active/);
    
    // Info card should show President election
    const title = page.locator('.info-card-title');
    await expect(title).toContainText('President');
  });

  test('clicking command executes action', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    
    const toggleHeaderItem = page.locator('.command-item:has-text("Toggle Header")');
    await toggleHeaderItem.click();
    
    // Header should be collapsed
    const header = page.locator('#app-header');
    await expect(header).toHaveClass(/collapsed/);
  });
});

test.describe('Recently Viewed', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage
    await page.goto('/classic.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  // Open the browse panel if it isn't already open. The FAB is hidden ≤1024px
  // (mobile/tablet use the tab bar's browse button), and on mobile selecting an
  // election auto-closes the panel — so callers reopen before reaching a tab.
  async function ensureBrowsePanelOpen(page) {
    const panel = page.locator('#election-panel');
    if (((await panel.getAttribute('class')) || '').includes('active')) return;
    const fab = page.locator('#fab');
    if (await fab.isVisible()) await fab.click();
    else await page.locator('[data-action="browse"]').first().click();
    await expect(panel).toHaveClass(/active/);
  }

  test('recently viewed starts empty', async ({ page }) => {
    await ensureBrowsePanelOpen(page);

    // Recently viewed section should show empty state or not exist
    const recentSection = page.locator('.recently-viewed-section');
    const hasRecent = await recentSection.isVisible();
    
    if (hasRecent) {
      const items = page.locator('.recent-item');
      expect(await items.count()).toBe(0);
    }
  });

  test('selecting election adds to recently viewed', async ({ page }, testInfo) => {
    // Desktop panel-tab flow: on mobile, selecting a race auto-closes the panel
    // by design, so this select→Saved-tab sequence is desktop-only.
    test.skip(testInfo.project.name.includes('Mobile'), 'mobile auto-closes the panel on selection');
    await ensureBrowsePanelOpen(page);
    // Groups are collapsed by default (B5); expand the first one
    await page.locator('.group-header').first().click();

    // Select an election (panel stays on Browse so results show on the map)
    await page.locator('.election-item').first().click();

    // On mobile the panel auto-closed when the election was selected; reopen
    // it to reach the Saved tab. No-op on desktop (panel still open).
    await ensureBrowsePanelOpen(page);
    await page.locator('.panel-tab[data-panel-tab="saved"]').click();
    await page.waitForSelector('.recent-item', { timeout: 5000 });

    // Check recently viewed has item
    const recentItems = page.locator('.recent-item');
    expect(await recentItems.count()).toBeGreaterThan(0);
  });

  test('clear button clears recently viewed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('Mobile'), 'mobile auto-closes the panel on selection');
    // Add an election to recently viewed
    await ensureBrowsePanelOpen(page);
    // Groups are collapsed by default (B5); expand the first one
    await page.locator('.group-header').first().click();
    await page.locator('.election-item').first().click();

    // On mobile the panel auto-closed when the election was selected; reopen
    // it to reach the Saved tab. No-op on desktop (panel still open).
    await ensureBrowsePanelOpen(page);
    await page.locator('.panel-tab[data-panel-tab="saved"]').click();
    await page.waitForSelector('.recent-item', { timeout: 5000 });

    // Click clear
    const clearBtn = page.locator('#clear-recent');
    await clearBtn.click();

    // Recently viewed should be empty after re-render
    await page.waitForTimeout(500);
    const recentItems = page.locator('.recent-item');
    expect(await recentItems.count()).toBe(0);
  });

  test('clicking recent item loads election', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('Mobile'), 'mobile auto-closes the panel on selection');
    // Add election to recently viewed
    await ensureBrowsePanelOpen(page);
    // Groups are collapsed by default (B5); expand the first one
    await page.locator('.group-header').first().click();

    const firstElection = page.locator('.election-item').first();
    const electionName = await firstElection.locator('.election-item-name').textContent();
    await firstElection.click();

    // On mobile the panel auto-closed when the election was selected; reopen
    // it to reach the Saved tab. No-op on desktop (panel still open).
    await ensureBrowsePanelOpen(page);
    await page.locator('.panel-tab[data-panel-tab="saved"]').click();
    await page.waitForSelector('.recent-item', { timeout: 5000 });

    // Click the recent item
    await page.locator('.recent-item').first().click();

    // Info card should show same election
    const title = page.locator('.info-card-title');
    await expect(title).toHaveText(electionName);
  });
});
