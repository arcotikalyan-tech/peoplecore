// node kr-text.mjs <url> <name> [waitMs]  — read-only: open a page, save main text and a screenshot (scratchpad only)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/Users/apple/Projects/peoplecore/apps/web/package.json');
const { chromium } = require('@playwright/test');
const dir = '/private/tmp/claude-501/-Users-apple-Projects-peoplecore/6738d76a-e71b-49e2-83d7-ecea80bdf028/scratchpad/kredily-new';
const [url, name, wait = '6000'] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = await browser.contexts()[0].newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
const text = (await page.evaluate(() => (document.querySelector('main') ?? document.body).innerText)).replace(/\n{2,}/g, '\n');
writeFileSync(`${dir}/${name}.txt`, page.url() + '\n' + text);
console.log(page.url()); console.log(text);
await page.close(); await browser.close().catch(() => {});
