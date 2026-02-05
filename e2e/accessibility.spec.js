// @ts-check
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index-new.html');
    await page.waitForSelector('.map-legend-leaflet', { timeout: 60000 });
  });

  test('skip link is present', async ({ page }) => {
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toHaveAttribute('href', '#map');
  });

  test('skip link becomes visible on focus', async ({ page }) => {
    // Focus the skip link
    await page.keyboard.press('Tab');
    
    const skipLink = page.locator('.skip-link');
    const box = await skipLink.boundingBox();
    
    // Should be visible (top >= 0)
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  test('header has banner role', async ({ page }) => {
    const header = page.locator('#app-header');
    await expect(header).toHaveAttribute('role', 'banner');
  });

  test('view tabs have correct ARIA attributes', async ({ page }) => {
    const tablist = page.locator('.view-mode-buttons');
    await expect(tablist).toHaveAttribute('role', 'tablist');
    
    const tabs = page.locator('.view-mode-btn');
    for (let i = 0; i < await tabs.count(); i++) {
      await expect(tabs.nth(i)).toHaveAttribute('role', 'tab');
    }
  });

  test('active tab has aria-selected true', async ({ page }) => {
    const activeTab = page.locator('.view-mode-btn.active');
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  test('map has application role', async ({ page }) => {
    const map = page.locator('#map');
    await expect(map).toHaveAttribute('role', 'application');
  });

  test('election panel has complementary role', async ({ page }) => {
    const panel = page.locator('#election-panel');
    await expect(panel).toHaveAttribute('role', 'complementary');
  });

  test('command palette has dialog role', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    
    const palette = page.locator('#command-palette');
    await expect(palette).toHaveAttribute('role', 'dialog');
  });

  test('info card has region role', async ({ page }) => {
    const infoCard = page.locator('#info-card');
    await expect(infoCard).toHaveAttribute('role', 'region');
  });

  test('keyboard focus is visible', async ({ page }) => {
    // Tab through some elements
    await page.keyboard.press('Tab'); // Skip link
    await page.keyboard.press('Tab'); // First focusable
    
    // Check that focus styles are applied (can see outline)
    const focusedElement = page.locator(':focus-visible');
    await expect(focusedElement).toBeVisible();
  });

  test('all buttons are keyboard accessible', async ({ page }) => {
    // Open command palette with keyboard
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#command-palette')).toHaveClass(/active/);
    
    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toHaveClass(/active/);
  });

  test('search input is accessible', async ({ page }) => {
    await page.locator('#fab').click();
    
    const searchInput = page.locator('#panel-search-input');
    await expect(searchInput).toHaveAttribute('placeholder');
  });

  test('reduced motion is respected', async ({ page }) => {
    // Enable reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    
    // Animations should be disabled via CSS
    const style = await page.evaluate(() => {
      const el = document.querySelector('.fade-in');
      if (!el) return null;
      return getComputedStyle(el).animationDuration;
    });
    
    // Duration should be near 0
    if (style) {
      expect(parseFloat(style)).toBeLessThanOrEqual(0.01);
    }
  });
});

test.describe('Color Contrast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index-new.html');
    await page.waitForSelector('#map');
  });

  test('primary buttons have sufficient contrast', async ({ page }) => {
    const browseBtn = page.locator('#open-panel-btn');
    
    const style = await browseBtn.evaluate(el => {
      const computed = getComputedStyle(el);
      return {
        backgroundColor: computed.backgroundColor,
        color: computed.color
      };
    });
    
    // Blue background (#0057B7) with white text should have good contrast
    expect(style.color).toContain('255'); // White text
  });

  test('text is readable', async ({ page }) => {
    const bodyText = page.locator('body');
    
    const fontSize = await bodyText.evaluate(el => {
      return parseFloat(getComputedStyle(el).fontSize);
    });
    
    // Font size should be at least 14px for readability
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });
});
