// precinct-tabs.spec.js — precinct.html's report as 5 flat tabs.
// Field Guide (the "so what": talking points + printable one-pager) is the
// default; hero and print/export stay visible above the tabs; deep links
// carry the open tab; printing includes the whole report.
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function openPrecinct(page, code = '3') {
  await page.goto(`/precinct.html#county=collin&precinct=${code}`);
  await page.waitForSelector('#report-container:not(.hidden)', { timeout: 30000 });
  await expect(page.locator('#section-talking-points')).not.toBeEmpty({ timeout: 30000 });
}

test.describe('Precinct report tabs', () => {
  test('opens on the Field Guide with talking points, no scroll hunting', async ({ page }) => {
    await openPrecinct(page);
    // 5 flat tabs, Field Guide pressed
    expect(await page.locator('.section-nav-pill:visible').count()).toBe(5);
    await expect(page.locator('.section-nav-pill[data-tab-btn="guide"]')).toHaveAttribute('aria-pressed', 'true');
    // the "so what" is on screen; the raw tables are not
    await expect(page.locator('#section-talking-points')).toBeVisible();
    await expect(page.locator('#section-party')).toBeHidden();
    await expect(page.locator('#section-census')).toBeHidden();
    // hero + print/export stay above the tabs on every tab
    await expect(page.locator('#hero-section')).toBeVisible();
    await expect(page.locator('#export-one-pager')).toBeVisible();
  });

  test('switching tabs swaps the visible part and updates the hash', async ({ page }) => {
    await openPrecinct(page);
    await page.click('.section-nav-pill[data-tab-btn="history"]');
    await expect(page.locator('#section-elections')).toBeVisible();
    await expect(page.locator('#section-talking-points')).toBeHidden();
    expect(page.url()).toContain('tab=history');
    await page.click('.section-nav-pill[data-tab-btn="people"]');
    await expect(page.locator('#section-racial')).toBeVisible();
    await expect(page.locator('#section-elections')).toBeHidden();
  });

  test('a #tab= deep link opens that part directly', async ({ page }) => {
    await page.goto('/precinct.html#precinct=3&tab=districts');
    await page.waitForSelector('#report-container:not(.hidden)', { timeout: 30000 });
    await expect(page.locator('.section-nav-pill[data-tab-btn="districts"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#section-officials')).toBeVisible();
  });

  test('tabs are keyboard operable', async ({ page }) => {
    await openPrecinct(page);
    await page.locator('.section-nav-pill[data-tab-btn="overview"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#section-party')).toBeVisible();
    await expect(page.locator('.section-nav-pill[data-tab-btn="overview"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('print styles reveal every tab (the printout is the full report)', async ({ page }) => {
    await openPrecinct(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#section-party')).toBeVisible();
    await expect(page.locator('#section-elections')).toBeVisible();
    await expect(page.locator('#section-talking-points')).toBeVisible();
  });

  test('the Field One-Pager renders inline, then prints from its own button', async ({ page }) => {
    await openPrecinct(page);
    await page.click('#export-one-pager');
    await expect(page.locator('.field-one-pager')).toBeVisible({ timeout: 15000 });
    const popupPromise = page.waitForEvent('popup');
    // dispatchEvent instead of a raw click: on mobile emulation the pinned
    // system Chromium reports fractional-DPR positions as perpetually
    // "unstable" (harness skew, not a product issue — the desktop click path
    // covers real pointer behavior).
    await page.locator('#one-pager-print-btn').dispatchEvent('click');
    const popup = await popupPromise;
    expect(await popup.title()).toContain('Field Brief');
  });
});
