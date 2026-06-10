// One-off UI/UX walkthrough: screenshots + console error capture.
// Run: node scripts/ui_walkthrough.js
import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'screenshots/walkthrough';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push(`[console] ${msg.text().slice(0, 300)}`);
  });
  page.on('requestfailed', (req) => {
    issues.push(`[reqfail] ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400 && resp.url().startsWith('http://localhost:3000')) {
      issues.push(`[http ${resp.status()}] ${resp.url()}`);
    }
  });

  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

  // --- index.html: map view ---
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-legend-leaflet', { timeout: 30000 }).catch(() => issues.push('[ui] map legend never appeared'));
  await page.waitForTimeout(2000);
  await shot('01-index-initial');

  // dismiss onboarding if present
  const onboarding = page.locator('.onboarding-backdrop');
  if (await onboarding.count()) {
    await shot('02-onboarding');
    const dismissBtn = page.locator('.onboarding-backdrop button').first();
    if (await dismissBtn.count()) await dismissBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // open election panel via FAB
  const fab = page.locator('#fab');
  if (await fab.count()) {
    await fab.click({ force: true }).catch(() => issues.push('[ui] FAB click failed'));
    await page.waitForTimeout(1000);
    await shot('03-election-panel');
    // search elections
    const search = page.locator('#panel-search-input');
    if (await search.count()) {
      await search.fill('president');
      await page.waitForTimeout(600);
      await shot('04-election-search');
    }
    // select first election
    const item = page.locator('.election-item-name').first();
    if (await item.count()) {
      await item.click().catch(() => issues.push('[ui] election item click failed'));
      await page.waitForTimeout(2500);
      await shot('05-election-selected');
    }
  } else {
    issues.push('[ui] #fab not found');
  }

  // click a precinct on the map to open info card
  await page.mouse.click(720, 450);
  await page.waitForTimeout(1500);
  await shot('06-precinct-info-card');

  // --- precinct.html: lookup page ---
  await page.goto('http://localhost:3000/precinct.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot('07-precinct-initial');

  const lookupInput = page.locator('#precinct-search-input, input[type="text"]').first();
  if (await lookupInput.count()) {
    await lookupInput.fill('25');
    await page.waitForTimeout(800);
    await shot('08-precinct-dropdown');
    const dd = page.locator('.dropdown-item').first();
    if (await dd.count()) {
      await dd.click().catch(() => issues.push('[ui] dropdown item click failed'));
      await page.waitForTimeout(3500);
      await shot('09-precinct-report-top');
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(800);
      await shot('10-precinct-report-mid');
      await page.evaluate(() => window.scrollBy(0, 2400));
      await page.waitForTimeout(800);
      await shot('11-precinct-report-lower');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
      await shot('12-precinct-report-bottom');
    } else {
      issues.push('[ui] no dropdown items for precinct search "25"');
    }
  } else {
    issues.push('[ui] precinct search input not found');
  }

  // mobile viewport sanity check on index
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('console', (msg) => {
    if (msg.type() === 'error') issues.push(`[mobile console] ${msg.text().slice(0, 200)}`);
  });
  await mobile.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' });
  await mobile.waitForTimeout(4000);
  await mobile.screenshot({ path: `${OUT}/13-mobile-index.png` });

  await browser.close();
  fs.writeFileSync(`${OUT}/issues.txt`, issues.join('\n') || 'none');
  console.log(`Done. ${issues.length} issues logged.`);
  issues.slice(0, 40).forEach((i) => console.log(i));
})();
