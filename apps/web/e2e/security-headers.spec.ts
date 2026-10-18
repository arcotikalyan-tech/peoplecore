import { expect } from '@playwright/test';
import { open, signIn, test } from './helpers';

/**
 * The Content-Security-Policy (src/proxy.ts) is sent on every page and nothing the app renders breaks it:
 * signing in, the dashboard, a form page and Insights load without a single CSP violation in the console.
 */
test('every page sends a nonce-based CSP and none of them violates it', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to (load|execute|apply)/i.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', (e) => { if (/Content Security Policy/i.test(e.message)) violations.push(e.message); });

  const res = await page.goto('/login');
  const csp = res!.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");

  await signIn(page, 'demo.hr');
  for (const path of ['/app/demo', '/app/demo/employees', '/app/demo/leave', '/app/demo/insights', '/app/demo/separations']) {
    await open(page, path);
  }
  expect(violations).toEqual([]);
});
