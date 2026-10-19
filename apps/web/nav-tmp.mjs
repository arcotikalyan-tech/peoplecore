import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = b.contexts()[0].pages().find((x) => x.url().includes('dronevex'));
const links = await p.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.textContent.trim().slice(0, 30) + ' -> ' + a.getAttribute('href')));
console.log(links.filter((l) => /compl|statut|timesheet|referr|hiring|learn|peoplexp|company/i.test(l)).join('\n'));
process.exit(0);
