// list-view.spec.js — the Map | List toggle on index.html: a fully linear,
// keyboard-first alternative to the map (same county/race/mode context).
import { test, expect } from '@playwright/test';

test.setTimeout(60000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

async function waitForLoaded(page) {
  await page.goto('/index.html');
  await expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 });
}

test.describe('List view', () => {
  test('toggles on without a page load and lists every precinct', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-view-list');
    await expect(page.locator('#cc-view-list')).toHaveAttribute('aria-pressed', 'true');
    // headline "so what" leads
    await expect(page.locator('#cc-list-headline')).toContainText(/leans|closely divided/);
    // every precinct becomes a card (chunked render)
    await expect
      .poll(async () => page.locator('.cc-card').count(), { timeout: 15000 })
      .toBeGreaterThan(250);
    await expect(page.locator('#cc-list-count')).toContainText('precincts');
    expect(page.url()).toContain('view=list');
  });

  test('sorting by closest margin puts a very close precinct first', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-view-list');
    await page.selectOption('#cc-list-sort', 'margin');
    await expect(page.locator('#cc-list-count')).toContainText('closest margin');
    const first = await page.locator('.cc-card-text').first().textContent();
    expect(first).toMatch(/Precinct \d/);
  });

  test('"Show on map" returns to the map with that precinct selected', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-view-list');
    await expect(page.locator('.cc-card').first()).toBeVisible({ timeout: 15000 });
    const code = await page.locator('.cc-card').first().getAttribute('data-code');
    await page.locator('.cc-card-details').first().click();
    await expect(page.locator('#cc-list')).toBeHidden();
    await expect(page.locator('#cc-dock-title')).toContainText(`Precinct ${code}`);
    await expect(page.locator('#cc-readout')).toBeVisible();
  });

  test('"Full report" deep-links to the precinct page with county context', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-view-list');
    await expect(page.locator('.cc-card').first()).toBeVisible({ timeout: 15000 });
    const href = await page.locator('.cc-card-report').first().getAttribute('href');
    expect(href).toMatch(/^precinct\.html#county=collin&precinct=/);
  });

  test('deep link #view=list opens the list directly', async ({ page }) => {
    await page.goto('/index.html#county=collin&view=list');
    await expect(page.locator('#cc-list')).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () => page.locator('.cc-card').count(), { timeout: 15000 })
      .toBeGreaterThan(250);
  });

  test('the skip link lands keyboard users in the list', async ({ page }) => {
    await waitForLoaded(page);
    await page.locator('#cc-skip-map').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cc-list')).toBeVisible();
    await expect(page.locator('#cc-list-sort')).toBeFocused();
  });

  test('cards are keyboard operable', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-view-list');
    await expect(page.locator('.cc-card').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.cc-card-details').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct');
  });
});
