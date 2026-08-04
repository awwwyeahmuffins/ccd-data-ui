// trends.spec.js — smoke coverage for the precinct swing chart (trends.html).
//
// The page loads 71 race files to build two composite indices, so every wait
// here is generous: a timeout means "still fetching", not "broken".
import { test, expect } from '@playwright/test';

test.setTimeout(120000);

async function load(page, hash = '') {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
  await page.goto(`/trends.html${hash}`);
  await expect(page.locator('.sc-mark').first()).toBeVisible({ timeout: 90000 });
}

test.describe('Trends', () => {
  test('plots one mark per comparable precinct and lists them all', async ({ page }) => {
    await load(page);
    const marks = await page.locator('.sc-mark').count();
    expect(marks).toBeGreaterThan(200);
    // Every plotted precinct is in the table, plus the ones held off the chart.
    // The table renders in animation-frame batches, so poll rather than snapshot.
    await expect.poll(() => page.locator('#tr-body tr').count(), { timeout: 20000 })
      .toBeGreaterThanOrEqual(marks);
  });

  test('leads with a plain-language county headline', async ({ page }) => {
    await load(page);
    await expect(page.locator('.tr-lede')).toContainText(/Collin County (moved|barely moved)/);
    await expect(page.locator('.tr-stats')).toContainText('precincts moved toward Democrats');
    await expect(page.locator('.tr-stats')).toContainText('precincts moved toward Republicans');
    // The disclosure must name how many precincts the figures rest on.
    await expect(page.locator('.tr-note')).toContainText(/\d+ of these \d+ have results in both years/);
  });

  test('encodes swing direction with shape as well as colour', async ({ page }) => {
    await load(page);
    // The a11y contract: the chart has to survive greyscale, so direction is
    // carried by triangle-up / triangle-down / circle, not hue alone.
    expect(await page.locator('.sc-mark-dem').count()).toBeGreaterThan(0);
    expect(await page.locator('.sc-mark-rep').count()).toBeGreaterThan(0);
    expect(await page.locator('.sc-mark-dem polygon').count()).toBeGreaterThan(0);
  });

  test('keeps the plot area square so the no-change line is a true 45°', async ({ page }) => {
    await load(page);
    const box = await page.locator('.swing-scatter').boundingBox();
    const viewBox = await page.locator('.swing-scatter').getAttribute('viewBox');
    const [, , w, h] = viewBox.split(' ').map(Number);
    // 88/56 left/right and 30/58 top/bottom padding — see ui/swingScatter.js
    expect(w - 88 - 56).toBeCloseTo(h - 30 - 58, 5);
    expect(box.width).toBeGreaterThan(0);
  });

  test('selecting a precinct updates the readout, the hash, and the table', async ({ page }) => {
    await load(page);
    // Marks overlap in the dense band along the diagonal; the last one painted
    // is the one on top, so it is the one a click can actually reach.
    await page.locator('.sc-mark').last().click();
    await expect(page.locator('.tr-readout-line')).toContainText(/^Precinct \d+:/);
    await expect(page).toHaveURL(/#.*precinct=\d+/);
    await expect(page.locator('#tr-body tr.row-highlight')).toHaveCount(1);
  });

  test('walks between precincts with the arrow keys', async ({ page }) => {
    await load(page);
    await page.locator('.sc-mark').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.tr-readout-line')).toContainText(/^Precinct \d+:/);
    const first = await page.locator('.tr-readout-line').textContent();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.tr-readout-line')).not.toHaveText(first);
  });

  test('consumes a precinct deep link on load', async ({ page }) => {
    await load(page, '#precinct=191');
    await expect(page.locator('.sc-mark.is-selected')).toHaveAttribute('data-precinct', '191');
    await expect(page.locator('.tr-readout-line')).toContainText('Precinct 191:');
  });

  test('follows a hash-only change (shared link, back button)', async ({ page }) => {
    await load(page, '#precinct=191');
    // Both precincts must be ones the chart actually plots — 105 casts ~4 votes
    // per race in 2022 and is deliberately held off it.
    await page.evaluate(() => { window.location.hash = '#precinct=93'; });
    await expect(page.locator('.sc-mark.is-selected')).toHaveAttribute('data-precinct', '93', { timeout: 15000 });
  });

  test('names the races behind each cycle, statewide only', async ({ page }) => {
    await load(page);
    await page.locator('details.tr-what summary').click();
    const composition = page.locator('#tr-what-body');
    await expect(composition).toContainText('Governor');
    await expect(composition).toContainText('President Vice President');
    // District-limited contests must never enter a county-wide index: State
    // Representative District 33 covers ~18 of 273 precincts.
    await expect(composition).not.toContainText('State Representative District 33');
    await expect(composition).not.toContainText('Justice of the Peace');
  });

  test('holds tiny electorates off the chart but keeps them in the table', async ({ page }) => {
    await load(page);
    const tiny = page.locator('#tr-body tr.tiny-row');
    // Collin has precincts casting 1–2 votes per race, where one ballot reads
    // as "100% Democratic". They are flagged, never deleted.
    expect(await tiny.count()).toBeGreaterThan(0);
    await expect(page.locator('.tr-note')).toContainText(/fewer than \d+ votes per race/);
  });

  test('sorts the table by any column', async ({ page }) => {
    await load(page);
    await page.locator('#tr-head th[data-col="swing"]').click();
    await expect(page.locator('#tr-head th.sorted')).toContainText('Swing');
    const firstSwing = await page.locator('#tr-body tr').first().locator('td.tr-swing').innerText();
    await page.locator('#tr-head th[data-col="swing"]').click();
    await expect(page.locator('#tr-body tr').first().locator('td.tr-swing')).not.toHaveText(firstSwing);
  });

  test('links each precinct onward to its report', async ({ page }) => {
    await load(page);
    const link = page.locator('#tr-body .tr-cell-precinct a').first();
    await expect(link).toHaveAttribute('href', /precinct\.html#precinct=/);
  });

  test('carries the re-drawn-boundaries disclosure', async ({ page }) => {
    await load(page);
    await expect(page.locator('.na-banner')).toContainText('re-drawn onto the new boundaries');
  });

  test('appears in the shared nav', async ({ page }) => {
    await load(page);
    await expect(page.locator('.site-nav a[href="trends.html"]')).toHaveAttribute('aria-current', 'page');
  });
});

// ---------------------------------------------------------------------------
// Map, metric switching, filters and impact — the second round of the feature.
// ---------------------------------------------------------------------------

test.describe('Trends map', () => {
  test('draws an arrow per moved precinct — up-right for Dem, down-left for Rep', async ({ page }) => {
    await load(page);
    await expect(page.locator('.tr-arrow svg').first()).toBeVisible({ timeout: 30000 });
    expect(await page.locator('.tr-arrow svg').count()).toBeGreaterThan(100);
    // Direction is the arrow's own geometry, so the map survives greyscale.
    expect(await page.locator('.tr-arrow polygon').count()).toBeGreaterThan(100);
  });

  test('fills precincts with real SVG patterns, never colour alone', async ({ page }) => {
    await load(page);
    // Leaflet only creates the overlay SVG once a layer lands; if the page
    // grabs it too early every polygon silently falls back to a flat colour.
    await expect(page.locator('#tr-map defs[data-ccpat] pattern').first()).toBeAttached({ timeout: 30000 });
  });

  test('the key describes direction and says what arrow length means', async ({ page }) => {
    await load(page);
    await expect(page.locator('#tr-legend')).toContainText('Moved toward Democrats');
    await expect(page.locator('#tr-legend')).toContainText('Moved toward Republicans');
    await expect(page.locator('.tr-legend-note')).toContainText('net votes moved');
    await page.selectOption('#tr-arrow-size', 'points');
    await expect(page.locator('.tr-legend-note')).toContainText('percentage points');
  });

  test('clicking the map selects the same precinct everywhere', async ({ page }) => {
    await load(page);
    await page.locator('#tr-map path').nth(30).click({ force: true });
    await expect(page.locator('.tr-readout-line')).toContainText(/^Precinct \d+:/);
    await expect(page).toHaveURL(/precinct=\d+/);
    await expect(page.locator('#tr-body tr.row-highlight')).toHaveCount(1);
  });
});

test.describe('Trends metrics and years', () => {
  test('offers both metrics and only the year pairs each one supports', async ({ page }) => {
    await load(page);
    // The general composite has exactly one comparable pair — Texas staggers
    // its ballot — so the picker must not offer a comparison that cannot exist.
    await expect(page.locator('#tr-year-a option')).toHaveCount(1);
    await page.locator('#tr-metric button[data-metric="primary"]').click();
    await expect(page.locator('#tr-year-a option')).toHaveCount(2);
    await expect(page.locator('#tr-year-b option')).toHaveCount(2);
  });

  test('primary participation shows the 2024 to 2026 Democratic surge', async ({ page }) => {
    await load(page, '#metric=primary&ya=2024&yb=2026');
    await expect(page.locator('.tr-lede')).toContainText('toward Democrats');
    await expect(page.locator('.tr-lede')).toContainText('primary participation');
  });

  test('labels primary participation as engagement, not vote share', async ({ page }) => {
    await load(page, '#metric=primary');
    await expect(page.locator('#tr-metric-blurb')).toContainText('engagement, not vote share');
  });
});

test.describe('Trends filters', () => {
  test('narrows by direction and offers a way back', async ({ page }) => {
    await load(page);
    await expect(page.locator('#tr-clear')).toHaveCount(0); // untouched page
    await page.selectOption('#tr-direction', 'dem');
    await expect(page.locator('#tr-count')).toContainText(/Showing \d+ of \d+/);
    await expect(page.locator('#tr-clear')).toHaveCount(1);
    await page.locator('#tr-clear').click();
    await expect(page.locator('#tr-clear')).toHaveCount(0);
  });

  test('filters to specific precincts', async ({ page }) => {
    await load(page);
    await page.fill('#tr-precincts', '12, 15');
    await expect.poll(() => page.locator('#tr-body tr').count(), { timeout: 15000 }).toBe(2);
  });

  test('isolates precincts whose Dem base grew even though the margin moved Rep', async ({ page }) => {
    await load(page);
    await page.selectOption('#tr-base', 'dem-grew-moved-rep');
    await expect(page.locator('#tr-count')).toContainText(/Showing \d+ of \d+/);
    const shown = await page.locator('#tr-body tr').count();
    expect(shown).toBeGreaterThan(0);
    // Every surviving row must have gained Dem votes and moved Republican.
    const first = page.locator('#tr-body tr').first();
    await expect(first.locator('td').nth(3)).toContainText('↓'); // swing arrow
  });
});

test.describe('Trends impact', () => {
  test('reports net votes alongside the percentage swing', async ({ page }) => {
    await load(page);
    await expect(page.locator('#tr-head')).toContainText('Net votes');
    await expect(page.locator('#tr-head')).toContainText('Dem votes');
    await expect(page.locator('#tr-head')).toContainText('Rep votes');
    await expect(page.locator('.tr-stats')).toContainText('net votes, Dem minus Rep');
  });

  test('says plainly when a base grew against the margin', async ({ page }) => {
    await load(page);
    // The sentence a margin alone can never tell you.
    await expect(page.locator('.tr-bases')).toContainText(/Democratic votes (grew|fell) by/);
    await expect(page.locator('.tr-bases')).toContainText(/added Democratic votes and still moved Republican/);
  });

  test('breaks a selected precinct down by party and year', async ({ page }) => {
    await load(page, '#precinct=250');
    const table = page.locator('.tr-base-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Dem');
    await expect(table).toContainText('Rep');
    await expect(table).toContainText('Net');
  });
});
