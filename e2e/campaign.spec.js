// campaign.spec.js — the Campaign ("Detailed View") dashboard: compound range
// filters synced between the map and the table, district roll-ups (including
// County Commissioner precincts), multi-sort, the VAN CSV export, and
// shareable URL state. The nav-tab persona wiring lives in persona.spec.js.
import { test, expect } from '@playwright/test';

test.setTimeout(90000); // the Python http.server is slow under load

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

async function loaded(page) {
  await expect(page.locator('#cp-body .pcell-precinct').first()).toBeVisible({ timeout: 30000 });
}

function shownCount(page) {
  return page.locator('#cp-count').textContent().then((t) => {
    const m = /Showing (\d+) of (\d+)/.exec(t || '');
    return m ? { shown: +m[1], total: +m[2] } : null;
  });
}

test('loads the table, the map polygons, and the win-number column', async ({ page }) => {
  await page.goto('/campaign.html');
  await loaded(page);

  // Full county, no filters: every precinct is a row and a polygon.
  const counts = await shownCount(page);
  expect(counts.total).toBeGreaterThan(200);
  expect(counts.shown).toBe(counts.total);
  await expect.poll(
    async () => page.locator('#cp-map path.leaflet-interactive').count(),
    { timeout: 30000 }
  ).toBeGreaterThan(200);

  // Win number is the default (descending) sort and renders real numbers.
  await expect(page.locator('#cp-head th[data-col="winNumber"]')).toHaveAttribute('aria-sort', 'descending');
  const firstWin = await page.locator('#cp-body tr').first().locator('td').nth(1).textContent();
  expect(firstWin.replace(/,/g, '')).toMatch(/^\d+$/);
});

test('narrowing the margin filter shrinks the table, dims map polygons, and stamps the hash', async ({ page }) => {
  await page.goto('/campaign.html');
  await loaded(page);
  const before = await shownCount(page);

  // Competitive precincts only: margin ≤ 20 points. (Set + dispatch — range
  // inputs don't take keyboard fill.)
  await page.locator('#cp-margin-max').evaluate((el) => {
    el.value = '0.2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await shownCount(page)).shown, { timeout: 15000 }).toBeLessThan(before.shown);
  const after = await shownCount(page);
  expect(after.total).toBe(before.total);
  expect(page.url()).toMatch(/margin=/);

  // The filtered-out precincts dim on the map (opacity drops), nothing rebuilds.
  const dimmed = await page.locator('#cp-map path.leaflet-interactive[fill-opacity="0.35"]').count();
  expect(dimmed).toBe(before.total - after.shown);
});

test('county-commissioner roll-up shows exactly the four commissioner precincts', async ({ page }) => {
  await page.goto('/campaign.html#rollup=comm');
  await loaded(page);
  const rows = page.locator('#cp-body tr');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('#cp-count')).toContainText('Showing 4 of 4 districts');
  // District rows aggregate their members and carry the compact key.
  await expect(rows.first().locator('td').first()).toContainText(/COMM-\d/);
});

test('scoping to a congressional district shrinks the table, dims the rest, and stamps the hash', async ({ page }) => {
  await page.goto('/campaign.html');
  await loaded(page);
  const before = await shownCount(page);

  await page.locator('#cp-district').selectOption('cd-3');
  await expect.poll(async () => (await shownCount(page)).total, { timeout: 15000 }).toBeLessThan(before.total);

  const after = await shownCount(page);
  expect(after.total).toBeGreaterThan(0);
  expect(after.shown).toBe(after.total); // no range filters active, all in-scope precincts show
  await expect(page.locator('#cp-count')).toContainText('Congressional District 3');
  expect(page.url()).toMatch(/district=cd-3/);

  // Out-of-scope precincts stay on the map, dimmed as "filtered out".
  const dimmed = await page.locator('#cp-map path.leaflet-interactive[fill-opacity="0.35"]').count();
  expect(dimmed).toBe(before.total - after.total);

  // Clearing scope restores the full county.
  await page.locator('#cp-district').selectOption('');
  await expect.poll(async () => (await shownCount(page)).total, { timeout: 15000 }).toBe(before.total);
});

test('a deep link opens already scoped to a congressional district', async ({ page }) => {
  await page.goto('/campaign.html#district=cd-4');
  await loaded(page);
  await expect(page.locator('#cp-district')).toHaveValue('cd-4');
  await expect(page.locator('#cp-count')).toContainText('Congressional District 4');
  const counts = await shownCount(page);
  expect(counts.total).toBeGreaterThan(0);
});

test('shift-click adds a secondary sort key', async ({ page }) => {
  await page.goto('/campaign.html');
  await loaded(page);
  await page.locator('#cp-head th[data-col="classification"]').click();
  await expect(page.locator('#cp-head th[data-col="classification"]')).toHaveAttribute('aria-sort', 'descending');
  await page.locator('#cp-head th[data-col="registered"]').click({ modifiers: ['Shift'] });
  const secondary = page.locator('#cp-head th[data-col="registered"]');
  await expect(secondary).toHaveClass(/sorted-secondary/);
  await expect(secondary).toContainText('↓²');
  expect(page.url()).toMatch(/sort=classification%3Adesc%2Cregistered%3Adesc|sort=classification:desc,registered:desc/);
});

test('Download Target List exports the filtered rows as a VAN-ready CSV', async ({ page }) => {
  await page.goto('/campaign.html#margin=0:0.2');
  await loaded(page);
  const counts = await shownCount(page);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#cp-export');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^collin-target-list-\d{4}-\d{2}-\d{2}\.csv$/);

  const path = await download.path();
  const fs = await import('fs');
  const text = fs.readFileSync(path, 'utf8');
  const lines = text.trim().split('\r\n');
  expect(lines[0]).toBe(
    'Precinct_ID,Total_Registered,Expected_Ballots,Target_Win_Number,Modeled_Party_Votes,Vote_Gap,Partisan_Margin,Classification,Turnout_Dropoff,Pct_NonWhite,Canvass_Share,Canvassed_Dem_Voters,District'
  );
  expect(lines.length - 1).toBe(counts.shown); // exactly the filtered rows
  // Raw payload: no % signs, no thousands separators in the numeric cells.
  expect(lines[1]).not.toMatch(/%/);
  expect(lines[1].split(',')[1]).toMatch(/^\d*$/);
});

test('a deep link restores party, roll-up, sort, and filter state', async ({ page }) => {
  await page.goto('/campaign.html#party=Rep&base=2024&rollup=hd&sort=voteGap:asc&margin=0:0.3');
  await loaded(page);
  await expect(page.locator('#cp-party')).toHaveValue('Rep');
  await expect(page.locator('#cp-base')).toHaveValue('2024');
  await expect(page.locator('#cp-rollup')).toHaveValue('hd');
  await expect(page.locator('#cp-head th[data-col="voteGap"]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('#cp-count')).toContainText('districts');
  // The margin range survived into the slider readout (not "any").
  await expect(page.locator('#cp-fval-margin')).not.toHaveText('any');
});
