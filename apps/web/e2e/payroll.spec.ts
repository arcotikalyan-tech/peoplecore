import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { adminClient, open, signIn } from './helpers';

/**
 * Payroll on the live demo tenant for April 2026: the payroll admin sets Dev Nair's salary, records arrears and prepares the run;
 * they can't approve their own run; the owner verifies and approves it; the run is locked; Dev sees the payslip;
 * the owner downloads the bank file. Everything is removed afterwards (purge_demo_payroll_run: demo tenants only).
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
const startedAt = new Date().toISOString();
const MONTH = '2026-04';
let orgId = '';
let devId = '';
let devCode = '';
let runUrl = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const dev = (await admin.from('employees').select('id, employee_code').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!;
  devId = dev.id;
  devCode = dev.employee_code;
  // A previous interrupted run may have left April behind.
  const { data: old } = await admin.from('payroll_runs').select('id').eq('organization_id', orgId).eq('period_month', `${MONTH}-01`);
  for (const r of old ?? []) await admin.rpc('purge_demo_payroll_run', { p_run: r.id });
  await admin.from('compensation_records').delete().eq('employee_id', devId);
});

test.afterAll(async () => {
  const { data: runs } = await admin.from('payroll_runs').select('id').eq('organization_id', orgId).eq('period_month', `${MONTH}-01`);
  for (const r of runs ?? []) await admin.rpc('purge_demo_payroll_run', { p_run: r.id });
  await admin.from('payroll_adjustments').delete().eq('employee_id', devId).gte('created_at', startedAt);
  await admin.from('compensation_records').delete().eq('employee_id', devId);
  await admin.from('notifications').delete().eq('organization_id', orgId).eq('kind', 'payroll.payslip').gte('created_at', startedAt);
});

test('payroll sets the salary and prepares the run; the preparer can’t approve it', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, `/app/demo/employees/${devId}`);
  const form = page.getByRole('form', { name: 'Change compensation' });
  await form.getByLabel('Basic salary (monthly ₹)').fill('25000');
  await form.getByLabel('House rent allowance (monthly ₹)').fill('12500');
  await form.getByLabel('Special allowance (monthly ₹)').fill('12500');
  await form.getByLabel('Effective from').fill(`${MONTH}-01`);
  await form.getByRole('button', { name: 'Save compensation' }).click();
  await expect(page.getByText(/^₹6,00,000 a year since/)).toBeVisible();

  await open(page, '/app/demo/payroll');
  const adj = page.getByRole('form', { name: 'Record an adjustment' });
  await adj.getByLabel('Employee').selectOption({ label: `Dev Nair (${devCode})` });
  await adj.getByLabel('Amount (₹)').fill('6000');
  await adj.getByLabel('Reason').fill('Arrears for March, paid late');
  await adj.getByRole('button', { name: 'Record adjustment' }).click();
  await expect(page.getByText('Adjustment recorded.', { exact: false })).toBeVisible();

  const create = page.getByRole('form', { name: 'New payroll run' });
  await create.locator('input[name="month"]').fill(MONTH);
  await create.getByRole('button', { name: 'Create run' }).click();
  await page.waitForURL(/\/app\/demo\/payroll\/[0-9a-f-]{36}$/);
  runUrl = new URL(page.url()).pathname;
  await expect(page.getByText(/are not professionally validated/)).toBeVisible();

  await page.getByRole('button', { name: 'Compute payslips' }).click();
  await expect(page.getByText(/^Computed \d+ payslips\./)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Dev Nair' });
  // 50,000 + 6,000 arrears − PF 1,800 − Karnataka PT 200 (PT on the month's wages; income below the rebate limit: no TDS).
  await expect(row.getByRole('cell', { name: '₹54,000' })).toBeVisible();
  await expect(page.getByText('You prepared this run, so someone else with payroll approval must approve it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify and approve' })).toHaveCount(0);
});

test('the owner verifies and approves; the run is locked and payslips are released', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, runUrl);
  await page.getByRole('button', { name: 'Verify and approve' }).click();
  // The next step replaces the approval form.
  await page.getByRole('button', { name: 'Lock and release payslips' }).click();
  await expect(page.getByRole('link', { name: 'Download bank file' })).toBeVisible();

  const run = (await admin.from('payroll_runs').select('status, prepared_by, approved_by').eq('organization_id', orgId).eq('period_month', `${MONTH}-01`).single()).data!;
  expect(run.status).toBe('locked');
  expect(run.approved_by).not.toBe(run.prepared_by);

  await open(page, runUrl);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download bank file' }).click()]);
  const csv = (await readFile(await download.path())).toString('utf8');
  expect(csv).toContain(`${devCode},Dev Nair,`);
  expect(csv).toContain(',54000.00');
});

test('the employee sees their payslip', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/payslips');
  await page.getByRole('link', { name: 'April 2026' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Payslip · April 2026' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Earnings' }).getByText('₹25,000')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Earnings' }).getByText('Salary arrears')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Deductions' }).getByText('Provident fund')).toBeVisible();
  await expect(page.getByText('₹54,000').first()).toBeVisible();
});
