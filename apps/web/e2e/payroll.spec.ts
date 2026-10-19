import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { parseCsv } from '@peoplecore/shared';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Payroll on the live demo tenant for April 2026, through the payroll workspace: the payroll admin assigns Dev Nair a
 * salary from the default structure, starts the cycle, adds arrears and calculates; they can't approve their own run;
 * the owner approves, locks and marks the payout paid; Dev sees the payslip in My Pay. The next month shows what
 * changed. Dev declares under the old regime and payroll approves; a salary revision needs another person's sign-off
 * and pays arrears for April. Everything is removed afterwards (purge_demo_payroll_run: demo tenants only).
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
const startedAt = new Date().toISOString();
const MONTH = '2026-04';
const NEXT = '2026-05';
let orgId = '';
let devId = '';
let devCode = '';

async function cleanup() {
  const { data: runs } = await admin.from('payroll_runs').select('id').eq('organization_id', orgId).in('period_month', [`${MONTH}-01`, `${NEXT}-01`]);
  for (const r of runs ?? []) await admin.rpc('purge_demo_payroll_run', { p_run: r.id });
  await admin.from('salary_revisions').delete().eq('employee_id', devId);
  await admin.from('tax_declarations').delete().eq('employee_id', devId);
  await admin.from('payroll_adjustments').delete().eq('employee_id', devId).is('applied_run_id', null);
  await admin.from('compensation_records').delete().eq('employee_id', devId);
}

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const dev = (await admin.from('employees').select('id, employee_code').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!;
  devId = dev.id;
  devCode = dev.employee_code;
  await cleanup(); // a previous interrupted run may have left April behind
});

test.afterAll(async () => {
  await cleanup();
  await admin.from('payroll_adjustments').delete().eq('employee_id', devId).gte('created_at', startedAt);
  await admin.from('notifications').delete().eq('organization_id', orgId).in('kind', ['payroll.payslip', 'payroll.revision', 'payroll.declaration']).gte('created_at', startedAt);
});

test('payroll assigns the salary, starts the cycle, adds arrears and calculates; the preparer can’t approve', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, `/app/demo/payroll?tab=people&month=${MONTH}&view=salaries&employee=${devId}`);
  const form = page.getByRole('form', { name: 'Assign salary' });
  await form.getByLabel('Salary structure').selectOption({ label: 'General Salary Structure' });
  await form.getByLabel('Annual CTC (₹)').fill('600000');
  await form.getByLabel('Effective from').fill(`${MONTH}-01`);
  await form.getByRole('button', { name: 'Save salary' }).click();
  await expect(page.getByText('Salary assigned.')).toBeVisible();
  // 50,000 a month: basic 40% (20,000), HRA 40% of basic (8,000), special the balance (22,000).
  await expect(page.getByRole('row').filter({ hasText: 'Dev Nair' }).getByText('₹50,000')).toBeVisible();

  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=precheck`);
  await page.getByRole('button', { name: 'Start payroll for April 2026' }).click();
  await expect(page.getByText('Payroll cycle started.', { exact: false })).toBeVisible();

  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=inputs&input=variable`);
  const adj = page.getByRole('form', { name: 'Record an adjustment' });
  await adj.getByLabel('Employee').selectOption({ label: `Dev Nair · ${devCode}` });
  await adj.getByLabel('Amount (₹)').fill('6000');
  await adj.getByLabel('Reason').fill('Arrears for March, paid late');
  await adj.getByRole('button', { name: 'Record adjustment' }).click();
  await expect(page.getByText('Adjustment recorded.', { exact: false })).toBeVisible();

  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=calculate`);
  await page.getByRole('button', { name: 'Calculate payroll' }).click();
  await expect(page.getByText(/^Computed \d+ payslips\./)).toBeVisible();
  await expect(page.getByText(/are not professionally validated/)).toBeVisible();

  await open(page, `/app/demo/payroll?tab=register&month=${MONTH}&q=Dev`);
  // 50,000 + 6,000 arrears − PF 1,800 − Karnataka PT 200 (PT on the month's wages; income below the rebate limit: no TDS).
  await expect(page.getByRole('row').filter({ hasText: 'Dev Nair' }).getByText('₹54,000')).toBeVisible();

  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=approve`);
  await expect(page.getByText('You calculated this run, so someone else with payroll approval must approve it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify and approve' })).toHaveCount(0);
});

test('the owner approves and locks; the payout is marked paid; bank advice and journal download', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=approve`);
  await page.getByRole('button', { name: 'Verify and approve' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Approved. Lock the run to release payslips.' })).toBeVisible();
  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=disburse`);
  await page.getByRole('button', { name: 'Lock & generate payslips' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Locked. Payslips are released' })).toBeVisible();

  const run = (await admin.from('payroll_runs').select('id, status, prepared_by, approved_by').eq('organization_id', orgId).eq('period_month', `${MONTH}-01`).single()).data!;
  expect(run.status).toBe('locked');
  expect(run.approved_by).not.toBe(run.prepared_by);

  await open(page, `/app/demo/payroll?tab=payout&month=${MONTH}`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Bank advice/ }).click()]);
  const csv = (await readFile(await download.path())).toString('utf8');
  expect(csv).toContain(`${devCode},Dev Nair,`);
  expect(csv).toContain(',54000.00,');

  const board = page.getByRole('form', { name: 'Payouts' });
  await board.getByRole('checkbox', { name: 'Select Dev Nair' }).check();
  await board.getByLabel('UTR / reference').fill('UTR0001');
  await board.getByRole('button', { name: /Update 1 selected/ }).click();
  await expect(page.getByText('Updated 1 payout.')).toBeVisible();
  expect((await admin.from('payroll_payouts').select('status, reference').eq('run_id', run.id).eq('employee_id', devId).single()).data).toEqual({ status: 'paid', reference: 'UTR0001' });

  // The accounting journal: one line per component and side, debits equal to credits.
  await open(page, `/app/demo/payroll?tab=run&month=${MONTH}&step=disburse`);
  const [journalDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '⬇ Journal voucher' }).click()]);
  const [header, ...rows] = parseCsv((await readFile(await journalDownload.path())).toString('utf8'));
  expect(header).toEqual(['Account', 'Component code', 'Description', 'Debit', 'Credit']);
  const total = rows.at(-1)!;
  const paise = (cell: string | undefined) => Math.round(Number(cell || 0) * 100);
  expect(total[0]).toBe('Total');
  expect(paise(total[3])).toBe(paise(total[4]));
  expect(rows.find((r) => r[1] === 'ARREAR')?.slice(0, 1)).toEqual(['Salaries – arrears']);
});

test('the employee sees their payslip in My Pay', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/payslips?tab=payslips&fy=2026-27');
  await page.getByRole('link', { name: 'April 2026' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Payslip · April 2026' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Earnings' }).getByText('₹20,000')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Earnings' }).getByText('Salary arrears')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Deductions' }).getByText('Provident fund')).toBeVisible();
  await expect(page.getByText('₹54,000').first()).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^payslip-2026-04-.+\.pdf$/);
  const pdf = (await readFile(await download.path())).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf).toContain('(54,000.00)');
});

test('the next month’s run shows what changed since the last locked run', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, `/app/demo/payroll?tab=run&month=${NEXT}&step=precheck`);
  await page.getByRole('button', { name: 'Start payroll for May 2026' }).click();
  await expect(page.getByText('Payroll cycle started.', { exact: false })).toBeVisible();
  await open(page, `/app/demo/payroll?tab=run&month=${NEXT}&step=calculate`);
  await page.getByRole('button', { name: 'Calculate payroll' }).click();
  await expect(page.getByText(/^Computed \d+ payslips\./)).toBeVisible();
  await page.getByRole('link', { name: 'Changes since last month' }).click();

  // April paid ₹6,000 of arrears once; May doesn't: −₹6,000 (−11.1%), explained by the inputs.
  const changes = page.getByRole('table', { name: 'Changes since the last run' });
  await expect(page.getByRole('heading', { name: 'Changes since April 2026' })).toBeVisible();
  const dev = changes.getByRole('row').filter({ hasText: 'Dev Nair' });
  await expect(dev).toContainText('₹54,000');
  await expect(dev).toContainText('₹48,000');
  await expect(dev).toContainText('-₹6,000 (-11.1%)');
  await expect(dev).toContainText('No one-off adjustments (was ₹6,000)');

});

test('the employee declares under the old regime; payroll approves the declaration', async ({ page, browser }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/payslips?tab=tax&view=declarations&fy=2026-27');
  const form = page.getByRole('form', { name: 'Tax declaration' });
  await form.getByRole('radio', { name: /Old regime/ }).check();
  await form.getByLabel(/80C — PPF/).fill('150000');
  await form.getByRole('button', { name: 'Submit to payroll' }).click();
  await expect(page.getByText('Submitted to payroll for review.')).toBeVisible();

  const ctx = await browser.newContext();
  const payroll = await ctx.newPage();
  await signIn(payroll, 'demo.payroll');
  await open(payroll, '/app/demo/payroll?tab=declarations&fy=2026-27');
  await payroll.getByRole('row').filter({ hasText: 'Dev Nair' }).getByRole('link', { name: 'Review' }).click();
  await payroll.getByRole('form', { name: 'Review declaration' }).getByRole('button', { name: 'Approve' }).click();
  await expect(payroll.getByText('Declaration approved.', { exact: false }).first()).toBeVisible();
  expect((await admin.from('tax_declarations').select('status, regime').eq('employee_id', devId).single()).data).toEqual({ status: 'approved', regime: 'old' });
  await ctx.close();
});

test('a salary revision waits for another approver’s sign-off and adds arrears for the locked month', async ({ page, browser }) => {
  await signIn(page, 'demo.payroll');
  await open(page, `/app/demo/payroll?tab=people&month=${NEXT}&view=salaries&employee=${devId}`);
  const form = page.getByRole('form', { name: 'Revise salary' });
  await form.getByLabel('Annual CTC (₹)').fill('720000');
  await form.getByLabel('Effective from').fill(`${MONTH}-15`);
  await form.getByLabel('Reason').fill('Annual appraisal');
  await form.getByRole('button', { name: 'Send for sign-off' }).click();
  await expect(page.getByText('Revision sent for sign-off.', { exact: false })).toBeVisible();
  await open(page, `/app/demo/payroll?tab=people&month=${NEXT}&view=revisions`);
  await expect(page.getByRole('row').filter({ hasText: 'Dev Nair' }).getByRole('button', { name: 'Sign off' })).toHaveCount(0); // not the proposer

  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await signIn(owner, 'demo.owner');
  await open(owner, `/app/demo/payroll?tab=people&month=${NEXT}&view=revisions`);
  await owner.getByRole('row').filter({ hasText: 'Dev Nair' }).getByRole('button', { name: 'Sign off' }).click();
  await expect(owner.getByText('Approved. The new salary is saved', { exact: false })).toBeVisible();
  // April (locked) was paid at 50,000; the new 60,000 a month applies to all of it: 10,000 of arrears.
  const arrear = (await admin.from('payroll_adjustments').select('amount').eq('employee_id', devId).eq('code', 'ARREAR').is('applied_run_id', null).single()).data!;
  expect(Number(arrear.amount)).toBe(10000);
  await ctx.close();
});
