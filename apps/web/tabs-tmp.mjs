import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const dir = '/private/tmp/claude-501/-Users-apple-Projects-peoplecore/6738d76a-e71b-49e2-83d7-ecea80bdf028/scratchpad/kredily-new';
const [url, prefix, ...tabs] = process.argv.slice(2);
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = await b.contexts()[0].newPage();
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(5000);
for (const t of tabs) {
  const el = t.startsWith("re:") ? p.getByText(new RegExp(t.slice(3))).first() : p.getByText(t, { exact: true }).first();
  if (!(await el.count())) { console.log(`### ${t}: NOT FOUND`); continue; }
  await el.click(); await p.waitForTimeout(3500);
  const text = (await p.evaluate(() => (document.querySelector('main') ?? document.body).innerText)).replace(/\n{2,}/g, '\n');
  const body = text.includes('⌘K') ? text.slice(text.indexOf('⌘K')) : text;
  writeFileSync(`${dir}/${prefix}__${t.replace(/\W+/g, '_')}.txt`, p.url() + '\n' + body);
  await p.screenshot({ path: `${dir}/${prefix}__${t.replace(/\W+/g, '_')}.png`, fullPage: true });
  console.log(`### ${t} (${p.url()})\n${body.slice(0, 3500)}`);
}
await p.close(); process.exit(0);
