// Regenerate README screenshots from the isolated preview server.
// Run the preview server first (npm run preview), then: node scripts/screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8790';
const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url));
await mkdir(OUT, { recursive: true });
const path = name => fileURLToPath(new URL(name, new URL('../docs/images/', import.meta.url)));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(BASE);
await page.locator('#rows tr[data-row]').first().waitFor();

// 1. Workbench (full page)
await page.screenshot({ path: path('workbench.png'), fullPage: true });

// 2. Expanded timeline: open the first company's history
const historyBtn = page.locator('.history-button').first();
await historyBtn.click();
await page.waitForTimeout(600);
await page.screenshot({ path: path('timeline.png'), fullPage: false });

// 3. Reviews page (full page)
await page.locator('[data-page="reviews"]').click();
await page.waitForTimeout(600);
await page.screenshot({ path: path('reviews.png'), fullPage: true });

await browser.close();
console.log('Screenshots written to docs/images/ (workbench.png, timeline.png, reviews.png)');
