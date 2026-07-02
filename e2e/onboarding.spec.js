// onboarding.spec.js — the one-time welcome panel (js/siteNav.js).
//
// First visit: a single plain-language card with one big dismiss button.
// Once dismissed (ccd_welcome_seen) it never returns. Referenced by the iPad
// project in playwright.config.js.

import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.describe('First-visit welcome', () => {
  test('shows once on the front door, reads large, and dismisses for good', async ({ page }) => {
    await page.goto('/index.html'); // the welcome greets first visits to the front door only
    const card = page.locator('.welcome-card');
    await expect(card).toBeVisible();

    // Large-print floor: welcome text must render at 18px or more.
    const size = await card.locator('p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(18);

    // One big obvious way out.
    const dismiss = page.locator('.welcome-dismiss');
    await expect(dismiss).toBeVisible();
    await dismiss.click();
    await expect(card).toHaveCount(0);

    // Never shows again.
    await page.reload();
    await expect(page.locator('.site-nav')).toBeVisible();
    await expect(page.locator('.welcome-card')).toHaveCount(0);
  });

  test('Escape also dismisses it', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.welcome-card')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.welcome-card')).toHaveCount(0);
  });

  test('returning visitors are never interrupted', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
    await page.goto('/index.html');
    await expect(page.locator('.site-nav')).toBeVisible();
    await expect(page.locator('.welcome-card')).toHaveCount(0);
  });

  test('deep links to other pages are never interrupted, even on first visit', async ({ page }) => {
    await page.goto('/methodology.html'); // no ccd_welcome_seen set
    await expect(page.locator('.site-nav')).toBeVisible();
    await expect(page.locator('.welcome-card')).toHaveCount(0);
  });
});

test.describe('Help panel', () => {
  test('the header Help button explains the current page and defines the jargon', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
    await page.goto('/forecast.html');
    await expect(page.locator('#nav-help')).toBeVisible();
    await page.click('#nav-help');
    const panel = page.locator('#help-panel .help-card');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('what if');
    await expect(panel).toContainText('What the words mean');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('Help is reachable on the front door too, after the welcome', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
    await page.goto('/index.html');
    await page.click('#nav-help');
    await expect(page.locator('#help-panel .help-card')).toContainText('The Map');
    await page.click('#help-panel .welcome-dismiss');
    await expect(page.locator('#help-panel')).toHaveCount(0);
  });
});
