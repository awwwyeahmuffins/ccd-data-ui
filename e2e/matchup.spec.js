// matchup.spec.js — the Matchup Projector (campaign persona's second tab):
// a projected 2026 general between the two primaries' winners over a chosen
// baseline election, with turnout/persuasion scenarios, a restyle-only map,
// and shareable URL state. The nav-tab persona wiring lives in persona.spec.js.
import { test, expect } from '@playwright/test';

test.setTimeout(90000); // the Python http.server is slow under load

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

async function loaded(page) {
  await expect(page.locator('#mp-headline .mp-winner')).toBeVisible({ timeout: 30000 });
}

test('loads with a default matchup: paired offices only, leaders pre-selected, honest methodology copy', async ({ page }) => {
  await page.goto('/matchup.html');
  await loaded(page);

  // Office list pairs the two 2026 primaries — party-internal contests never appear.
  const offices = await page.locator('#mp-office option').allTextContents();
  expect(offices.length).toBeGreaterThan(20);
  expect(offices).toContain('Governor');
  expect(offices.some((o) => /Proposition|Precinct Chair|County Chair/.test(o))).toBe(false);

  // Each party's March primary leader is pre-selected and labeled as such.
  await expect(page.locator('#mp-dem option:checked')).toContainText('March leader');
  await expect(page.locator('#mp-rep option:checked')).toContainText('March leader');

  // Headline: a projected winner with real vote totals and a margin.
  const winner = await page.locator('#mp-headline .mp-winner').textContent();
  expect(winner).toMatch(/Projected winner:[\s\S]*by [\d.]+ points/);

  // The projection-not-prediction and runoff disclosures are always visible.
  const method = await page.locator('.mp-method').textContent();
  expect(method).toContain('projection, not a prediction');
  expect(method).toContain('runoff');
});

test('renders the precinct map with a legend', async ({ page }) => {
  await page.goto('/matchup.html');
  await loaded(page);
  await expect.poll(
    async () => page.locator('#mp-map path.leaflet-interactive').count(),
    { timeout: 30000 }
  ).toBeGreaterThan(200);
  await expect(page.locator('#mp-legend .cc-legend-row')).toHaveCount(4);
  await expect(page.locator('#mp-legend')).toContainText('Projected Democratic precinct');
});

test('moving the Dem turnout slider changes the projection and stamps the hash', async ({ page }) => {
  await page.goto('/matchup.html');
  await loaded(page);
  const before = await page.locator('#mp-headline').textContent();

  await page.locator('#mp-sliders input[data-party="Dem"]').evaluate((el) => {
    el.value = '150';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => page.locator('#mp-headline').textContent(), { timeout: 15000 })
    .not.toBe(before);
  expect(page.url()).toContain('td=150');

  // Hand-tuning a slider drops the preset into custom.
  await expect(page.locator('.preset-btn.active')).toContainText('Custom');
});

test('a preset button updates the sliders and the projection', async ({ page }) => {
  await page.goto('/matchup.html');
  await loaded(page);
  await page.locator('.preset-btn[data-preset="rep-surge"]').click();
  await expect(page.locator('#mp-sliders input[data-party="Rep"]')).toHaveValue('125');
  await expect.poll(() => page.url(), { timeout: 15000 }).toContain('tr=125');
});

test('overriding a nominee updates the headline and stamps the hash', async ({ page }) => {
  await page.goto('/matchup.html');
  await loaded(page);

  // Pick the Dem primary's runner-up (runoffs are real — the leader may lose).
  const second = await page.locator('#mp-dem option').nth(1).getAttribute('value');
  test.skip(!second, 'default office has an unopposed Dem primary');
  await page.selectOption('#mp-dem', second);
  await expect(page.locator('#mp-headline')).toContainText(second, { timeout: 15000 });
  expect(decodeURIComponent(page.url())).toContain(`dem=${second}`);
});

test('changing the baseline election changes the projected totals', async ({ page }) => {
  await page.goto('/matchup.html');
  await loaded(page);
  const before = await page.locator('#mp-headline').textContent();
  await page.selectOption('#mp-baseline', 'governor-2022');
  await expect.poll(async () => page.locator('#mp-headline').textContent(), { timeout: 30000 })
    .not.toBe(before);
  await expect(page.locator('#mp-baseline-name')).toContainText('Governor');
  expect(page.url()).toContain('baseline=governor-2022');
});

test('a deep link restores office, baseline, and scenario', async ({ page }) => {
  await page.goto('/matchup.html#office=US%20Senator&baseline=governor-2022&td=125');
  await loaded(page);
  await expect(page.locator('#mp-office')).toHaveValue('US Senator');
  await expect(page.locator('#mp-baseline')).toHaveValue('governor-2022');
  await expect(page.locator('#mp-sliders input[data-party="Dem"]')).toHaveValue('125');
  await expect(page.locator('.preset-btn.active')).toContainText('Custom');
});

test('a district office marks out-of-district precincts as not on this ballot', async ({ page }) => {
  await page.goto('/matchup.html#office=US%20Representative%20District%203');
  await loaded(page);
  // The headline reports the participating-precinct universe, well under the county's ~273.
  const note = await page.locator('#mp-headline .mp-note').textContent();
  const m = /(\d+) precincts are on this office's ballot/.exec(note);
  expect(m).not.toBeNull();
  expect(+m[1]).toBeGreaterThan(10);
  expect(+m[1]).toBeLessThan(220);
});
