// deep-links.spec.js
// REDESIGN.md §3.5 rule 3: deep links are first-class — every param a page
// WRITES to the hash, it must CONSUME on load. Each test drives the UI to make
// the page write its params, then re-opens the resulting URL cold and asserts
// the page restored that state. Landed in Phase 1 (ahead of the urlState
// adoption it protects, per the migration plan's "specs land in the phase
// before the code they protect changes").
import { test, expect } from '@playwright/test';

test.setTimeout(90000); // the Python http.server is slow under load

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

async function mapLoaded(page) {
  await expect(page.locator('.cc-app')).toBeVisible();
  await expect(page.locator('#cc-dock-sub')).toContainText('precincts', { timeout: 30000 });
}

test.describe('Map (index.html) deep links', () => {
  test('race + precinct written to the hash are consumed on a cold load', async ({ page }) => {
    await page.goto('/index.html');
    await mapLoaded(page);
    // Write: pick a race, then tap a precinct.
    await page.click('#cc-race-btn');
    await page.fill('#cc-race-search', 'president');
    await page.locator('#cc-race-list [data-race]:not([data-race=""])').first().click();
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Race Results', { timeout: 30000 });
    const box = await page.locator('#cc-map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct', { timeout: 10000 });
    const url = page.url();
    expect(url).toMatch(/#.*race=/);
    expect(url).toMatch(/precinct=/);
    // Consume: open the exact same URL cold.
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#cc-dock-eyebrow')).toContainText('Precinct', { timeout: 30000 });
    await expect(page.locator('#cc-race-name')).not.toHaveText('Choose a race');
  });

  test('#district= scopes the map on a cold load; legacy #county=cd-3 still works', async ({ page }) => {
    await page.goto('/index.html#district=cd-3');
    await expect(page.locator('#cc-district')).toHaveValue('cd-3', { timeout: 30000 });
    await expect(page.locator('#cc-map svg path.leaflet-interactive')).toHaveCount(164, { timeout: 30000 });
    // Old bookmarks that treated the district as a county keep working —
    // read-tolerated, never written back (§3.5 rule 4).
    await page.goto('about:blank');
    await page.goto('/index.html#county=cd-3');
    await expect(page.locator('#cc-district')).toHaveValue('cd-3', { timeout: 30000 });
    await expect(page).not.toHaveURL(/county=/, { timeout: 15000 });
  });

  test('#view=list opens the linear List view directly', async ({ page }) => {
    await page.goto('/index.html#county=collin&view=list');
    await expect(page.locator('#cc-list')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#cc-list-count')).toContainText('precincts', { timeout: 30000 });
  });
});

test.describe('My Precinct (precinct.html) deep links', () => {
  test('the open report tab is written to the hash and restored cold', async ({ page }) => {
    await page.goto('/precinct.html#county=collin&precinct=3');
    await page.waitForSelector('#report-container:not(.hidden)', { timeout: 30000 });
    // Write: switch to the People tab.
    await page.click('.section-nav-pill[data-tab-btn="people"]');
    expect(page.url()).toMatch(/tab=people/);
    const url = page.url();
    // Consume.
    await page.goto('about:blank');
    await page.goto(url);
    await page.waitForSelector('#report-container:not(.hidden)', { timeout: 30000 });
    await expect(page.locator('.section-nav-pill[data-tab-btn="people"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#section-racial')).toBeVisible();
  });
});

test.describe('Priority Precincts (targets.html) deep links', () => {
  test('strategy and list length round-trip through the hash', async ({ page }) => {
    await page.goto('/targets.html');
    await expect(page.locator('.tg-precinct').first()).toBeVisible({ timeout: 30000 });
    // Write: change strategy (catalog is behind the single disclosure) + limit.
    if (await page.locator('#tg-catalog-wrap').isHidden()) {
      await page.click('#tg-strategy-btn');
    }
    await page.click('.strat-card[data-strat="flip-rep-dem"]');
    await expect(page.locator('#tg-results-title')).toHaveText('Flippable to Democrats');
    await page.selectOption('#tg-limit', '25');
    const url = page.url();
    expect(url).toMatch(/strategy=flip-rep-dem/);
    expect(url).toMatch(/top=25/);
    // Consume.
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#tg-results-title')).toHaveText('Flippable to Democrats', { timeout: 30000 });
    await expect(page.locator('#tg-limit')).toHaveValue('25');
    await expect(page.locator('.tg-precinct').first()).toBeVisible();
  });
});

test.describe('Browse All Data (explore.html) deep links', () => {
  test('view, sort, and direction round-trip through the hash', async ({ page }) => {
    await page.goto('/explore.html');
    await expect(page.locator('#ex-body tr').first()).toBeVisible({ timeout: 30000 });
    // Write: pick a column set, a sort key, and flip the direction.
    await page.click('#ex-views button[data-view="housing"]');
    await page.selectOption('#ex-sort', 'medianIncome');
    await page.click('#ex-dir');
    const url = page.url();
    expect(url).toMatch(/view=housing/);
    expect(url).toMatch(/sort=medianIncome/);
    expect(url).toMatch(/dir=asc/);
    // Consume.
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#ex-body tr').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#ex-views button[data-view="housing"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ex-sort')).toHaveValue('medianIncome');
  });
});

test.describe('Forecast (forecast.html) deep links', () => {
  test('the chosen race round-trips through the hash', async ({ page }) => {
    await page.goto('/forecast.html');
    // The default race writes its own race= hash once its CSV loads — wait for
    // that first so the next wait can detect the CHANGED hash, not the old one.
    await expect(page).toHaveURL(/race=/, { timeout: 30000 });
    const before = new URL(page.url()).hash;
    // Write: pick a different race via the shared race picker (search narrows
    // to a race the default never is — the picker's list uses [data-race]).
    await page.click('#fc-race-btn');
    await page.fill('#fc-race-search', 'attorney general');
    await page.locator('#fc-race-list [data-race]').first().click();
    await page.waitForURL((u) => new URL(u).hash !== before && /race=/.test(new URL(u).hash), { timeout: 30000 });
    const picked = await page.locator('#fc-race-name').textContent();
    const url = page.url();
    // Consume.
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#fc-race-name')).toHaveText(picked, { timeout: 30000 });
  });
});

test.describe('Elections redirect stub deep links (Phase 5)', () => {
  test('legacy elections links land on the Map with their state intact', async ({ page }) => {
    // The catalog folded into the shared race picker; the stub forwards any
    // hash. A legacy #county=cd-3 becomes the Map's district scope.
    await page.goto('/elections.html#county=cd-3');
    await expect(page).toHaveURL(/index\.html/, { timeout: 15000 });
    await expect(page.locator('#cc-district')).toHaveValue('cd-3', { timeout: 30000 });
    await page.goto('/elections.html');
    await expect(page).toHaveURL(/index\.html/, { timeout: 15000 });
    await expect(page.locator('.cc-app')).toBeVisible();
  });
});
