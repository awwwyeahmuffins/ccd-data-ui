// Probe the election panel search behavior
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
// dismiss onboarding
const dismissBtn = page.locator('.onboarding-backdrop button').first();
if (await dismissBtn.count()) await dismissBtn.click().catch(() => {});
await page.locator('#fab').click({ force: true });
await page.waitForTimeout(800);

for (const term of ['president', 'governor', 'sheriff', '']) {
  await page.locator('#panel-search-input').fill(term);
  await page.waitForTimeout(700);
  const itemCount = await page.locator('.election-item-name').count();
  const visible = await page.locator('.election-item-name:visible').count();
  const groups = await page.locator('.race-family-group, .category-group').count();
  const emptyMsg = await page.locator('text=/no.*found/i').count();
  console.log(`search="${term}": items=${itemCount} visible=${visible} groups=${groups} emptyMsg=${emptyMsg}`);
}

// what does the panel actually contain after searching president?
await page.locator('#panel-search-input').fill('president');
await page.waitForTimeout(700);
const html = await page.evaluate(() => {
  const panel = document.querySelector('#election-panel, .election-panel, [class*=panel-body]');
  return panel ? panel.innerHTML.slice(0, 1500) : 'PANEL NOT FOUND';
});
console.log('--- panel html snippet ---');
console.log(html);
await browser.close();
