// precinct-lookup.spec.js — smoke coverage for the Find a Precinct page,
// focused on the senior-friendly workflow guarantees: non-destructive error
// banners and a working search → report path.
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function openReport(page) {
  await page.goto('/precinct.html');
  await expect(page.locator('#precinct-search')).toBeVisible();
  // the precinct list loads async — retype until the dropdown has data
  await expect(async () => {
    await page.fill('#precinct-search', '');
    await page.fill('#precinct-search', '25');
    await expect(page.locator('.dropdown-item[data-code]').first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45000 });
  await page.locator('.dropdown-item[data-code]').first().click();
  await expect(page.locator('#report-container')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#hero-section .hero-stat-card').first()).toBeVisible({ timeout: 30000 });
}

test.describe('Find a Precinct', () => {
  test('searching a precinct number opens the report with print buttons under the summary', async ({ page }) => {
    await openReport(page);
    await expect(page.locator('#export-bar')).toBeVisible();
    await expect(page.locator('#export-pdf')).toHaveText('Print / Save as PDF');
    // the visible label for the search field exists (no placeholder-as-label)
    await expect(page.locator('label[for="precinct-search"]')).toBeVisible();
  });

  test('an error shows a dismissible banner and never wipes the open report', async ({ page }) => {
    await openReport(page);
    // Geolocation is not granted in this context → the location button fails
    await page.click('#use-location-btn');
    const banner = page.locator('.lookup-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });
    // the report is still on screen behind the banner
    await expect(page.locator('#report-container')).toBeVisible();
    await expect(page.locator('#hero-section .hero-stat-card').first()).toBeVisible();
    // and the banner can be dismissed
    await page.click('.lookup-banner-close');
    await expect(banner).toHaveCount(0);
  });

});

test.describe('Glossary popovers', () => {
  test('tapping a metric label opens a plain-language definition (targets page)', async ({ page }) => {
    await page.goto('/targets.html');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    // default "Closest Races" strategy labels its metric "Margin" — a glossary term
    const term = page.locator('.tg-metric-label button.term').first();
    await expect(term).toBeVisible();
    await term.click();
    const pop = page.locator('.glossary-pop');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('margin', { ignoreCase: true });
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });
});
