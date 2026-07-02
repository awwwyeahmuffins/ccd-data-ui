// command-center.spec.js
// Smoke coverage for the Map front door (index.html). Auth is bypassed on
// localhost.
import { test, expect } from '@playwright/test';

test.setTimeout(60000); // the Python http.server is slow under load

// The first-visit welcome panel would eat the first click — mark it seen.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

// Wait until the dock has briefed the county (data fully loaded).
async function waitForLoaded(page) {
  await page.goto('/index.html');
  await expect(page.locator('.cc-app')).toBeVisible();
  await expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 });
}

test.describe('Command Center', () => {
  test('loads the dashboard with a county briefing', async ({ page }) => {
    await waitForLoaded(page);
    // SVG renderer: every precinct is a real, labelled, focusable path
    await expect(page.locator('#cc-map svg path.leaflet-interactive').first()).toBeVisible();
    await expect(page.locator('#cc-dock-title')).toContainText('County');
    // brand to the active county in the tab title
    await expect(page).toHaveTitle(/Map — Collin County Elections/);
  });

  test('the district scope limits the Collin map, and clears back to the whole county', async ({ page }) => {
    await waitForLoaded(page);
    await expect(page.locator('#cc-county-name')).toHaveText('Collin County');
    // The scope select offers the whole county plus the 12 Collin-touching districts.
    await expect(page.locator('#cc-district option')).toHaveCount(13);
    // Scoping to CD-3 filters the map to that district's Collin precincts.
    await page.selectOption('#cc-district', 'cd-3');
    await expect(page.locator('#cc-map svg path.leaflet-interactive')).toHaveCount(164, { timeout: 15000 });
    await expect(page.locator('#cc-dock-title')).toContainText('Congressional District 3', { timeout: 15000 });
    // The scope is a deep-linkable param, and county= is never written (§3.5).
    expect(page.url()).toMatch(/district=cd-3/);
    expect(page.url()).not.toMatch(/county=/);
    // Back to the whole county.
    await page.selectOption('#cc-district', '');
    await expect(page.locator('#cc-map svg path.leaflet-interactive')).toHaveCount(273, { timeout: 15000 });
  });

  test('the three analytic modes switch', async ({ page }) => {
    await waitForLoaded(page);
    for (const mode of ['margin', 'diversity', 'lean']) {
      await page.click(`.cc-mode-btn[data-mode="${mode}"]`);
      await expect(page.locator(`.cc-mode-btn[data-mode="${mode}"]`)).toHaveClass(/active/);
    }
  });

  test('clicking a precinct opens its detail in the dock', async ({ page }) => {
    await waitForLoaded(page);
    const map = page.locator('#cc-map');
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct', { timeout: 10000 });
    await expect(page.locator('#cc-dock-title')).toContainText('Precinct');
  });

  test('the shared header links out to every page with plain-language labels', async ({ page }) => {
    await waitForLoaded(page);
    // The five-tab nav (REDESIGN §3.3) — Forecast lives outside it, linked in context.
    for (const dest of ['precinct.html', 'targets.html', 'explore.html', 'methodology.html']) {
      await expect(page.locator(`.site-nav a[href="${dest}"]`)).toHaveCount(1);
    }
    await expect(page.locator('.site-nav a')).toHaveCount(5);
    // the map is the current page
    await expect(page.locator('.site-nav a[href="index.html"]')).toHaveAttribute('aria-current', 'page');
    // labels are visible text, not hover tooltips — plain-language renames
    await expect(page.locator('.site-nav a[href="precinct.html"]')).toContainText('My Precinct');
    await expect(page.locator('.site-nav a[href="explore.html"]')).toContainText('Data Table');
  });

  test('the header text-size toggle enlarges the page and persists', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#nav-text-size');
    await expect(page.locator('html')).toHaveClass(/text-large/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/text-large/, { timeout: 15000 });
    // reset for other runs
    await page.click('#nav-text-size');
  });

  test('renders a race deep-link and isolates only its participating precincts', async ({ page }) => {
    // CD-3 is a multi-county district (Collin + Hunt) and must NOT light up all
    // of Collin — only Collin's CD-3 precincts participate.
    await page.goto('/index.html#county=collin&race=u-s-representative-district-3-2022');
    await expect(page.locator('.cc-app')).toBeVisible();
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Full District', { timeout: 30000 });
    await expect(page.locator('#cc-race-name')).toContainText('District 3');
    await expect(page.locator('#cc-dock-sub')).toContainText('Hunt');
    // participation filter: Collin's on-ballot precincts are a subset of 252
    const sub = await page.locator('#cc-dock-sub').textContent();
    const m = sub.match(/Collin: (\d+) precincts/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(0);
    expect(Number(m[1])).toBeLessThan(252);
    // Hunt is now drawn precinct-by-precinct (official Clarity data joined to TLC
    // VTD geometry) — the legend gains the precinct-level key for other counties.
    await expect(page.locator('#cc-legend')).toContainText('precinct-level', { timeout: 10000 });
    // clear race returns to demographics (on tablets the dock is a slide-over)
    const dockToggle = page.locator('#cc-dock-toggle');
    if (await dockToggle.isVisible()) await dockToggle.click();
    await page.click('#cc-clear-race');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('County Briefing');
    await expect(page.locator('#cc-race-name')).toHaveText('Choose a race');
  });

  test('folds non-Collin counties into a multi-county district race', async ({ page }) => {
    // CD-32 is mostly Dallas — the full-district result must include it.
    await page.goto('/index.html#county=collin&race=u-s-representative-district-32-2022');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Full District', { timeout: 30000 });
    await expect(page.locator('#cc-dock-sub')).toContainText('Dallas');
    await expect(page.locator('.cc-demo-row .name').filter({ hasText: 'Dallas' })).toBeVisible();
    await expect(page.locator('.cc-demo-row .name').filter({ hasText: 'Collin' })).toBeVisible();
  });

  test('typing a street address finds and selects its precinct', async ({ page }) => {
    // Mock Nominatim with a point in downtown McKinney (inside Collin).
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ lat: '33.1972', lon: '-96.6398', display_name: '111 N Tennessee St, McKinney, TX' }]),
      })
    );
    await waitForLoaded(page);
    await page.fill('#cc-precinct-search', '111 N Tennessee St, McKinney');
    await page.press('#cc-precinct-search', 'Enter');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct', { timeout: 15000 });
  });

  test('the county briefing leads with a headline and at most 5 stats before disclosure', async ({ page }) => {
    await waitForLoaded(page);
    // on phones/tablets the dock is a slide-over — open it before clicking inside
    const dockToggle = page.locator('#cc-dock-toggle');
    if (await dockToggle.isVisible()) await dockToggle.click();
    // "so what" first: one plain-language sentence
    await expect(page.locator('#cc-dock-body .cc-headline')).toContainText(/leans|closely divided|no precinct party data/);
    // at most 5 stat blocks visible before the disclosure (4 tiles + lean bar)
    expect(await page.locator('#cc-dock-body .cc-stat').count()).toBeLessThanOrEqual(5);
    // one single-level disclosure holds the rest
    const btn = page.locator('#cc-more-county');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#cc-more-county-body')).toBeHidden();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cc-more-county-body .cc-deeplink').first()).toBeVisible();
    // lean bar values are text, not paint inside segments
    await expect(page.locator('.cc-leanbar-vals').first()).toContainText('Republican');
  });

  test('the legend names its bins with numeric ranges on a solid backplate', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('.cc-mode-btn[data-mode="margin"]');
    // discrete named bins with explicit ranges — never a gradient to interpolate
    await expect(page.locator('#cc-legend')).toContainText('under 5 points');
    await expect(page.locator('#cc-legend')).toContainText('5–15 points');
    await expect(page.locator('#cc-legend')).toContainText('over 50 points');
    // pattern-bearing swatches, and no translucent glass behind the text
    expect(await page.locator('#cc-legend svg rect').count()).toBeGreaterThanOrEqual(5);
    const bg = await page.locator('.cc-legend').evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(bg === 'none' || bg === '').toBeTruthy();
  });

  test('precinct polygons are keyboard operable with spoken labels', async ({ page }) => {
    await waitForLoaded(page);
    // one roving tab stop enters the map
    const entry = page.locator('#cc-map svg path[tabindex="0"]');
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute('aria-label', /Precinct \d/);
    await entry.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct');
    // the tap/keyboard readout card is showing the same plain-language sentence
    await expect(page.locator('#cc-readout')).toBeVisible();
    await expect(page.locator('#cc-readout-text')).toContainText('Precinct');
  });

  test('tapping a precinct pins a readout card (no hover needed)', async ({ page }) => {
    await waitForLoaded(page);
    const map = page.locator('#cc-map');
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#cc-readout')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#cc-readout-more')).toBeVisible();
  });

  test('off-ballot precincts read "not on this ballot" to assistive tech', async ({ page }) => {
    await page.goto('/index.html#county=collin&race=u-s-representative-district-3-2022');
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Full District', { timeout: 30000 });
    // CD-3 covers a subset of Collin: some precinct paths must be off-ballot
    await expect(page.locator('#cc-map path[aria-label*="not on this ballot"]').first())
      .toBeAttached({ timeout: 10000 });
    // and the legend explains the texture
    await expect(page.locator('#cc-legend')).toContainText('Not on this ballot');
  });

  test('the race picker switches the map to a county-wide race', async ({ page }) => {
    await waitForLoaded(page);
    await page.click('#cc-race-btn');
    await page.fill('#cc-race-search', 'president');
    await page.click('.cc-race-list, #cc-race-list >> text=President', { timeout: 5000 }).catch(async () => {
      await page.locator('#cc-race-list .cc-county-opt[data-race]').first().click();
    });
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Race Results', { timeout: 30000 });
  });
});
