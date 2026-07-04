// chair.spec.js — the precinct chair dashboard (chair.html): precinct
// selection + persistence, the universe matrix (modeled estimates, never
// color-alone), honest N/A states, the suspense quick-share, and the two-page
// print packet whose handout page must stay apolitical.
//
// Both-worlds rule: profile/field_ops.csv is generated from the local voter
// file and may or may not be committed — the suspense assertions accept a
// count OR N/A, never assume one.
import { test, expect } from '@playwright/test';

test.setTimeout(90000); // the Python http.server is slow under load

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

async function dashboardLoaded(page) {
  await expect(page.locator('#chair-content')).toBeVisible({ timeout: 30000 });
}

test.describe('precinct selection & persistence', () => {
  test('loads with the empty state and a populated dropdown', async ({ page }) => {
    await page.goto('/chair.html');
    await expect(page.locator('#chair-empty')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#chair-content')).toBeHidden();
    // 273 precincts + the "Choose…" placeholder
    await expect
      .poll(async () => page.locator('#chair-precinct-select option').count(), { timeout: 30000 })
      .toBeGreaterThan(200);
  });

  test('choosing a precinct renders the dashboard, updates the URL, and writes the MRU', async ({ page }) => {
    await page.goto('/chair.html');
    await expect
      .poll(async () => page.locator('#chair-precinct-select option').count(), { timeout: 30000 })
      .toBeGreaterThan(200);
    await page.selectOption('#chair-precinct-select', '3');
    await dashboardLoaded(page);
    await expect(page.locator('#chair-precinct-title')).toHaveText('Precinct 3');
    expect(page.url()).toContain('precinct=3');
    // Shared MRU with My Precinct (ccd_my_precincts) — continuity by design.
    const mru = await page.evaluate(() => JSON.parse(localStorage.getItem('ccd_my_precincts') || '[]'));
    expect(mru[0]).toBe('3');
  });

  test('a #precinct= deep link renders that precinct directly', async ({ page }) => {
    await page.goto('/chair.html#precinct=25');
    await dashboardLoaded(page);
    await expect(page.locator('#chair-precinct-title')).toHaveText('Precinct 25');
    await expect(page.locator('#chair-precinct-select')).toHaveValue('25');
  });

  test('a remembered precinct is restored on a hash-less visit', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ccd_my_precincts', '["42"]'));
    await page.goto('/chair.html');
    await dashboardLoaded(page);
    await expect(page.locator('#chair-precinct-title')).toHaveText('Precinct 42');
  });
});

test.describe('dashboard widgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chair.html#precinct=3');
    await dashboardLoaded(page);
  });

  test('shows a strategy focus badge with a plain-language rationale', async ({ page }) => {
    await expect(page.locator('#chair-focus-badge')).toBeVisible();
    await expect(page.locator('#chair-focus-badge')).toHaveText(/Turnout Focus|Persuasion Focus|Build & Register/);
    await expect(page.locator('#chair-focus-why')).not.toBeEmpty();
  });

  test('renders the 3x3 universe matrix with numeric modeled estimates and role labels', async ({ page }) => {
    const cells = page.locator('.chair-matrix tbody td');
    await expect(cells).toHaveCount(9);
    // Cells are numeric estimates (or an honest N/A) — never blank.
    const texts = await page.locator('.chair-cell-count').allTextContents();
    for (const t of texts) expect(t).toMatch(/^[\d,]+$|^N\/A$/);
    // Roles are TEXT chips (never color-alone) and "modeled estimate" is disclosed.
    await expect(page.locator('.chair-cell-role', { hasText: 'Base' }).first()).toBeVisible();
    await expect(page.locator('.chair-cell-role', { hasText: 'GOTV' }).first()).toBeVisible();
    await expect(page.locator('#chair-matrix-sub')).toContainText('modeled estimate');
  });

  test('target counts card shows strong Democratic voters and the labeled volunteer proxy', async ({ page }) => {
    const card = page.locator('#chair-targets');
    await expect(card).toContainText('strong Democratic voters');
    await expect(card).toContainText('likely volunteers');
    // The volunteer number is a proxy — the tag must be visible whenever a number is.
    if (!(await card.textContent()).includes('N/A')) {
      await expect(card.locator('.chair-tag')).toHaveText('modeled estimate');
    }
  });

  test('suspense tracker shows a count or honest N/A, plus the SOS quick-share', async ({ page }) => {
    const card = page.locator('#chair-suspense');
    await expect(card).toContainText(/voters in suspense/);
    await expect(card.locator('.chair-stat-val')).toHaveText(/^[\d,]+$|^N\/A$/);
    // The door snippet always carries the Texas SOS address-change portal.
    await expect(page.locator('#chair-snippet')).toContainText('txapps.texas.gov/tolapp/sos/SOSACManager');
    await expect(page.locator('#chair-copy-btn')).toBeVisible();
  });

  test('the suspense glossary term opens a tap popover', async ({ page }) => {
    await page.click('button.term[data-term="suspense"]');
    await expect(page.locator('.glossary-pop')).toBeVisible();
    await expect(page.locator('.glossary-pop')).toContainText(/address/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('.glossary-pop')).toBeHidden();
  });

  test('voting info card shows dates from voting_info.json and the vote411 directive', async ({ page }) => {
    const card = page.locator('#chair-voting');
    await expect(card).toContainText('vote411.org');
    // Dates come from the hand-maintained file (or an honest fallback) —
    // either way the card renders without fabricated content.
    await expect(card).not.toBeEmpty();
  });
});

test.describe('print packet', () => {
  test('opens a two-page packet; the handout page is strictly apolitical', async ({ page }) => {
    await page.goto('/chair.html#precinct=3');
    await dashboardLoaded(page);
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.click('#chair-print-btn'),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    const html = await popup.content();
    expect(html).toContain('packet-page-1');
    expect(html).toContain('packet-page-2');
    // Page 2 goes to voters' doors: no partisan or field-jargon language.
    const handout = html.slice(html.indexOf('packet-page-2'));
    expect(handout).not.toMatch(
      /democrat|republican|\bdem\b|\brep\b|partisan|persuasion|persuade|gotv|turnout focus|liberal|conservative|campaign/i
    );
    expect(handout).toContain('vote411');
  });
});
