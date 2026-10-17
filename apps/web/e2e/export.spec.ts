import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { adminClient, open, signIn } from './helpers';

/** Audited CSV export of the employee directory, on the live demo tenant (read-only: creates no data). */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});

test('HR exports the filtered directory; the file is recorded in the audit log', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees?status=active');
  const since = new Date(Date.now() - 5000).toISOString();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^employees-demo-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await readFile(await download.path())).toString('utf8');
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  expect(lines[0]).toBe('Employee code,Name,Work email,Work phone,Status,Employment type,Date of joining,Probation ends,Date of exit,Department,Designation,Location,Manager code');

  const { count } = await admin.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active');
  expect(lines.length - 1).toBe(count);
  expect(lines.slice(1).every((l) => l.split(',')[4] === 'active')).toBe(true);
  // Work fields only: the header above is the complete column list.
  const { data: events } = await admin.from('audit_events').select('metadata')
    .eq('organization_id', orgId).eq('action', 'export').gte('occurred_at', since);
  expect(events).toEqual([{ metadata: { format: 'csv', row_count: count, filters: { status: 'active' } } }]);
});

test('managers and employees get no export, not even by URL', async ({ browser }) => {
  for (const user of ['demo.manager', 'demo.employee']) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, user);
    await open(page, '/app/demo/employees');
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
    const res = await page.request.get('/app/demo/employees/export');
    expect(res.status()).toBe(404);
  }
});
