// persona.spec.js — the persona (view mode) chrome: html[data-persona], the
// ccd_persona carrier, the #persona= entry param, and the always-visible View
// switcher (#nav-persona) that lets anyone move between Public, Simple (chair),
// and Detailed (campaign). Public keeps the five-tab chrome; chair prepends My
// Dashboard; campaign appends the Campaign Dashboard tab.
// The badge only shows for a non-public persona, so this spec runs its own axe
// pass with the badge visible (onboarding.spec.js is the precedent for
// state-owning specs).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.setTimeout(90000); // the Python http.server is slow under load

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ccd_welcome_seen', '1'));
});

// methodology.html is the fastest page (static prose) and also the trickiest
// for persona state: it never rewrites the hash, so a stale #persona= would
// survive there if the toggle didn't strip it.
async function methodologyLoaded(page) {
  await expect(page.locator('h1.page-title')).toBeVisible({ timeout: 30000 });
}

test.describe('public default', () => {
  test('loads as public with no badge, the View switcher at Public, and five tabs', async ({ page }) => {
    await page.goto('/methodology.html');
    await methodologyLoaded(page);
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'public');
    await expect(page.locator('.site-persona-badge')).toHaveCount(0);
    await expect(page.locator('#nav-persona')).toBeVisible();
    await expect(page.locator('#nav-persona')).toHaveValue('public');
    await expect(page.locator('.site-nav a')).toHaveCount(5);
  });

  test('an invalid #persona= falls back to public', async ({ page }) => {
    await page.goto('/methodology.html#persona=bogus');
    await methodologyLoaded(page);
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'public');
    await expect(page.locator('.site-persona-badge')).toHaveCount(0);
  });
});

test.describe('View switcher', () => {
  test('is visible for real visitors on every page, no dev flag needed', async ({ page }) => {
    await page.goto('/methodology.html');
    await methodologyLoaded(page);
    await expect(page.locator('#nav-persona')).toBeVisible();
    await expect(page.locator('#nav-persona option')).toHaveCount(3);
    // Persists across a plain nav (localStorage carries it, hash is dropped).
    await page.goto('/targets.html');
    await expect(page.locator('#nav-persona')).toBeVisible({ timeout: 30000 });
  });

  test('switching persona reloads with the badge and survives cross-page nav', async ({ page }) => {
    await page.goto('/methodology.html');
    await methodologyLoaded(page);
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'public');

    // Switch to Precinct Chair; the handler persists ccd_persona and reloads.
    await page.selectOption('#nav-persona', 'chair');
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'chair', { timeout: 30000 });
    await expect(page.locator('.site-persona-badge')).toHaveText('Simple View');
    await expect(page.locator('#nav-persona')).toHaveValue('chair');
    // The chair persona's one nav divergence: My Dashboard leads the tabs —
    // and the campaign dashboard is not among them.
    await expect(page.locator('.site-nav a')).toHaveCount(6);
    await expect(page.locator('.site-nav a[href="chair.html"]')).toHaveText('My Dashboard');
    await expect(page.locator('.site-nav a[href="campaign.html"]')).toHaveCount(0);

    // A real nav click drops the hash — localStorage carries the persona.
    await page.click('.site-nav a[href="targets.html"]');
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'chair', { timeout: 30000 });
    await expect(page.locator('.site-persona-badge')).toHaveText('Simple View');
  });

  test('switching strips a lingering #persona= so the new choice wins', async ({ page }) => {
    // methodology.html never rewrites its hash — the worst case for staleness.
    await page.goto('/methodology.html#persona=chair');
    await methodologyLoaded(page);
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'chair');

    await page.selectOption('#nav-persona', 'public');
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'public', { timeout: 30000 });
    expect(page.url()).not.toMatch(/persona=/);
    await expect(page.locator('.site-persona-badge')).toHaveCount(0);
    // Back to public means back to the five tabs — no dashboard entry.
    await expect(page.locator('.site-nav a')).toHaveCount(5);
    await expect(page.locator('.site-nav a[href="chair.html"]')).toHaveCount(0);
  });
});

test.describe('campaign persona nav', () => {
  test('campaign gets the Campaign Dashboard tab; switching back to public removes it', async ({ page }) => {
    await page.goto('/methodology.html#persona=campaign');
    await methodologyLoaded(page);
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'campaign');
    await expect(page.locator('.site-nav a')).toHaveCount(6);
    const tab = page.locator('.site-nav a[href="campaign.html"]');
    await expect(tab).toHaveText('Campaign Dashboard');

    // The tab is a real link into the dashboard.
    await tab.click();
    await expect(page.locator('h1.page-title')).toHaveText('Campaign dashboard', { timeout: 30000 });
    await expect(page.locator('.site-nav a[href="campaign.html"]')).toHaveAttribute('aria-current', 'page', { timeout: 30000 });

    // Back to public: the extra tab disappears with the persona.
    await page.selectOption('#nav-persona', 'public');
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'public', { timeout: 30000 });
    await expect(page.locator('.site-nav a')).toHaveCount(5, { timeout: 30000 });
    await expect(page.locator('.site-nav a[href="campaign.html"]')).toHaveCount(0);
  });
});

test.describe('#persona= entry param', () => {
  test('overrides a stored persona and persists for the next page', async ({ page }) => {
    // Seed once, not per-navigation — an unconditional addInitScript would
    // re-impose "chair" on every page load and mask the persisted override.
    await page.addInitScript(() => {
      if (!localStorage.getItem('ccd_seed_done')) {
        localStorage.setItem('ccd_persona', 'chair');
        localStorage.setItem('ccd_seed_done', '1');
      }
    });
    await page.goto('/methodology.html#persona=campaign');
    await methodologyLoaded(page);
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'campaign');
    await expect(page.locator('.site-persona-badge')).toHaveText('Detailed View');

    // The override was persisted — it survives a hash-less nav click.
    await page.click('.site-nav a[href="explore.html"]');
    await expect(page.locator('html')).toHaveAttribute('data-persona', 'campaign', { timeout: 30000 });
    await expect(page.locator('.site-persona-badge')).toHaveText('Detailed View');
  });
});

test.describe('accessibility', () => {
  test('badge + View switcher pass axe (critical/serious)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ccd_persona', 'campaign');
    });
    await page.goto('/methodology.html');
    await methodologyLoaded(page);
    await expect(page.locator('.site-persona-badge')).toBeVisible();
    await expect(page.locator('#nav-persona')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter((v) =>
      ['critical', 'serious'].includes(v.impact)
    );
    const summary = blocking
      .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes[0]?.target})`)
      .join('\n');
    expect(blocking, `Axe violations with persona chrome visible:\n${summary}`).toEqual([]);
  });
});
