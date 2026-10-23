import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { todayIn } from '@peoplecore/shared';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Guessing limits on the website's sign-in, and the audit log's CSV download (filtered by period, recorded in the log
 * itself, HR and owners only). The sign-in test uses an address with no account, so no real account is held up.
 */
const admin = adminClient();

async function tryPassword(page: Page, address: string) {
  await page.getByLabel('Work email').fill(address);
  await page.locator('input[name="password"]').fill('not-the-password-1');
  // Each attempt finishes before the next (the button waits while one is under way).
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/login'),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
}

test('after five wrong passwords for an account, the website makes them wait', async ({ page }) => {
  const address = `nobody-${Date.now()}@example.test`;
  await page.goto('/login');
  for (let i = 0; i < 5; i++) {
    await tryPassword(page, address);
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  }
  await tryPassword(page, address);
  await expect(page.getByText('Too many sign-in attempts. Try again in 15 minutes, or choose a new password with “Forgot password?”.')).toBeVisible();
  // Another account from the same place isn't held up.
  await tryPassword(page, `someone-else-${Date.now()}@example.test`);
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
});

test('HR downloads the audit log for a period; the download is recorded in the log', async ({ page }) => {
  const orgId = (await admin.from('organizations').select('id, timezone').eq('slug', 'demo').eq('is_demo', true).single()).data!;
  const today = todayIn(orgId.timezone);
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/audit');
  await page.getByLabel('From', { exact: true }).fill(today);
  await page.getByLabel('To', { exact: true }).fill(today);
  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForURL(new RegExp(`/audit\\?from=${today}&to=${today}$`));
  await expect(page.getByRole('link', { name: 'All dates' })).toBeVisible();

  const since = new Date(Date.now() - 5000).toISOString();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toBe(`audit-log-demo-${today}-to-${today}.csv`);
  const lines = (await readFile(await download.path())).toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
  expect(lines[0]).toBe(`When (${orgId.timezone}),Who,User id,Action,Record type,Record id,Changes`);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.slice(1).every((l) => l.startsWith(today))).toBe(true);

  const { data: events } = await admin.from('audit_events').select('metadata')
    .eq('organization_id', orgId.id).eq('action', 'export').eq('entity_type', 'audit_events').gte('occurred_at', since);
  expect(events).toEqual([{ metadata: { format: 'csv', row_count: lines.length - 1, from: today, to: today } }]);
});

test('employees and managers can’t download the audit log, not even by URL', async ({ browser }) => {
  for (const user of ['demo.employee', 'demo.manager']) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, user);
    const res = await page.request.get('/app/demo/audit/export');
    expect(res.status()).toBe(404);
    await page.close();
  }
});
