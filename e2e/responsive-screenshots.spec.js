// responsive-screenshots.spec.js
// Takes screenshots at top 5 screen sizes for responsive testing
import { test } from '@playwright/test';

const SCREEN_SIZES = [
  { name: '1920x1080-desktop', width: 1920, height: 1080 },
  { name: '1366x768-laptop', width: 1366, height: 768 },
  { name: '768x1024-ipad', width: 768, height: 1024 },
  { name: '375x812-iphoneX', width: 375, height: 812 },
  { name: '360x800-android', width: 360, height: 800 },
];

for (const size of SCREEN_SIZES) {
  test(`screenshot-${size.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
    });
    const page = await context.newPage();

    // Go to index.html (not index-new.html)
    await page.goto('/classic.html', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait a moment for any JS rendering
    await page.waitForTimeout(3000);

    // Check if auth overlay is blocking - if so, try to bypass or screenshot anyway
    const authOverlay = await page.$('#auth-overlay');
    const isAuthVisible = authOverlay ? await authOverlay.isVisible() : false;

    if (isAuthVisible) {
      // Hide auth overlay for testing responsive layout
      await page.evaluate(() => {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) overlay.style.display = 'none';
        // Try to init the app
        if (typeof window.init === 'function') window.init();
      });
      await page.waitForTimeout(3000);
    }

    // Take full page screenshot
    await page.screenshot({
      path: `test-results/responsive-${size.name}.png`,
      fullPage: false,
    });

    // For mobile sizes, also open sidebar and screenshot
    if (size.width <= 800) {
      const toggle = await page.$('.mobile-toggle');
      if (toggle && await toggle.isVisible()) {
        await toggle.click();
        await page.waitForTimeout(1000);
        await page.screenshot({
          path: `test-results/responsive-${size.name}-sidebar-open.png`,
          fullPage: false,
        });
      }
    }

    await context.close();
  });
}
