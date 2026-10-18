import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Separation on the live demo tenant: Dev Nair resigns; his manager (Rohan Iyer) and then HR approve it in the
 * Inbox; the clearance checklist appears; Rohan clears the handover, finance clears no-dues, Dev completes the exit
 * interview (which only HR can read); payroll computes the full and final settlement (refused while Dev has no
 * salary) and the owner approves it; HR then cancels the separation so Dev stays employed, which takes back the
 * settlement's unpaid adjustments. Everything is removed and Dev's record restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const lastDay = (() => { const d = new Date(`${todayIst}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 45); return d.toISOString().slice(0, 10); })();
let orgId = '';
let devId = '';
let separationUrl = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
});

test.afterAll(async () => {
  await admin.from('payroll_adjustments').delete().eq('employee_id', devId).eq('reason', 'Full and final settlement').gte('created_at', startedAt);
  await admin.from('compensation_records').delete().eq('employee_id', devId);
  const seps = (await admin.from('separations').select('id, approval_request_id').eq('employee_id', devId).gte('created_at', startedAt)).data ?? [];
  if (seps.length) {
    await admin.from('separations').update({ approval_request_id: null }).in('id', seps.map((s) => s.id));
    await admin.from('approval_requests').delete().in('id', seps.map((s) => s.approval_request_id).filter((x): x is string => !!x));
    await admin.from('separations').delete().in('id', seps.map((s) => s.id));
  }
  await admin.from('employees').update({ status: 'active', date_of_exit: null }).eq('id', devId);
  for (const kind of ['separation.%', 'approval.%', 'settlement.%']) {
    await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', kind).gte('created_at', startedAt);
  }
});

test('the employee resigns; manager then HR approve; the clearance checklist appears', async ({ browser }) => {
  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/separations');
  const form = dev.getByRole('form', { name: 'Resign' });
  await form.getByLabel('Last working day you’d like').fill(lastDay);
  await form.getByLabel('Main reason').selectOption('growth');
  await form.getByLabel('Anything you’d like HR to know').fill(`Moving to a product role ${run}`);
  await form.getByRole('button', { name: 'Submit resignation' }).click();
  await dev.waitForURL(/\/separations\/[0-9a-f-]{36}$/);
  await expect(dev.getByRole('status').filter({ hasText: 'Resignation submitted.' })).toBeVisible();
  await expect(dev.getByText('Awaiting approval')).toBeVisible();
  separationUrl = new URL(dev.url()).pathname;

  for (const [account, message] of [['demo.manager', 'Approved. It moves to the next approver.'], ['demo.hr', 'Approved.']] as const) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, account);
    await open(page, '/app/demo/inbox');
    await page.getByRole('form', { name: /^Decide: Resignation: Dev Nair/ }).getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
  }

  await dev.reload();
  await expect(dev.getByText('On notice')).toBeVisible();
  const clearance = dev.getByRole('list', { name: 'Clearance' });
  await expect(clearance.getByRole('listitem', { name: 'Work handed over' })).toBeVisible();
  await expect(clearance.getByRole('listitem', { name: 'Exit interview' })).toBeVisible();
  const emp = (await admin.from('employees').select('status, date_of_exit').eq('id', devId).single()).data!;
  expect(emp).toEqual({ status: 'on_notice', date_of_exit: lastDay });
});

test('the manager, finance and the employee clear their items; only HR reads the exit interview', async ({ browser }) => {
  const rohan = await (await browser.newContext()).newPage();
  await signIn(rohan, 'demo.manager');
  await open(rohan, separationUrl);
  await expect(rohan.getByText('Moving to a product role')).toHaveCount(0); // the reason is HR's
  await rohan.getByRole('form', { name: 'Clear Work handed over' }).getByRole('button', { name: 'Mark done' }).click();
  await expect(rohan.getByRole('status').filter({ hasText: 'Cleared.' })).toBeVisible();

  const farah = await (await browser.newContext()).newPage();
  await signIn(farah, 'demo.payroll');
  await open(farah, separationUrl);
  await farah.getByRole('form', { name: /^Clear No dues/ }).getByRole('button', { name: 'Mark done' }).click();
  await expect(farah.getByRole('status').filter({ hasText: 'Cleared.' })).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, separationUrl);
  const interview = dev.getByRole('form', { name: 'Exit interview' });
  await interview.getByLabel('Would you recommend working here?').selectOption('4');
  await interview.getByLabel('What should we do better?').fill(`Clearer promotion criteria ${run}`);
  await interview.getByRole('button', { name: 'Submit' }).click();
  await expect(dev.getByRole('status').filter({ hasText: 'Thank you. Your answers went to HR.' })).toBeVisible();
  await expect(dev.getByRole('list', { name: 'Clearance' }).getByRole('listitem', { name: 'Exit interview' }).getByText('Done')).toBeVisible();

  await open(rohan, separationUrl);
  await expect(rohan.getByText('Clearer promotion criteria')).toHaveCount(0);

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, separationUrl);
  await expect(hr.getByText(`Clearer promotion criteria ${run}`)).toBeVisible();
  await expect(hr.getByText(`Moving to a product role ${run}`, { exact: false })).toBeVisible();
  // Handover, no dues and the exit interview are done; any asset or system access Dev holds is still open.
  const total = (await admin.from('clearance_items').select('id').eq('separation_id', separationUrl.split('/').pop()!)).data!.length;
  await expect(hr.getByText(`3 of ${total} done`)).toBeVisible();
});

test('payroll computes the settlement from Dev’s salary; a second person approves it', async ({ browser }) => {
  const farah = await (await browser.newContext()).newPage();
  await signIn(farah, 'demo.payroll');
  await open(farah, separationUrl);
  const prepare = farah.getByRole('form', { name: 'Prepare settlement' });
  await prepare.getByRole('button', { name: 'Compute settlement' }).click();
  await expect(prepare.getByText('No salary is recorded for this employee.')).toBeVisible();

  await open(farah, `/app/demo/employees/${devId}`);
  const salary = farah.getByRole('form', { name: 'Change compensation' });
  await salary.getByLabel('Basic salary (monthly ₹)').fill('30000');
  await salary.getByLabel('House rent allowance (monthly ₹)').fill('15000');
  await salary.getByLabel('Special allowance (monthly ₹)').fill('15000');
  await salary.getByLabel('Effective from').fill('2025-01-01');
  await salary.getByRole('button', { name: 'Save compensation' }).click();
  await expect(farah.getByText(/^₹7,20,000 a year since/)).toBeVisible();

  await open(farah, separationUrl);
  await prepare.getByLabel('Extra line 1').fill(`Laptop bag not returned ${run}`);
  await farah.locator('#f-fnf1-extraAmount1').fill('2000');
  await prepare.getByRole('button', { name: 'Compute settlement' }).click();
  await expect(prepare.getByText('Settlement computed. Someone else with payroll approval rights approves it.')).toBeVisible();
  await expect(farah.getByRole('table', { name: 'Settlement' }).getByText(`Laptop bag not returned ${run}`)).toBeVisible();
  await expect(farah.getByRole('form', { name: 'Approve settlement' })).toHaveCount(0); // not the preparer

  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, 'demo.owner');
  await open(owner, separationUrl);
  await owner.getByRole('form', { name: 'Approve settlement' }).getByRole('button', { name: 'Approve settlement' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Settlement approved.' })).toBeVisible();
  const adj = (await admin.from('payroll_adjustments').select('code, amount').eq('employee_id', devId).eq('reason', 'Full and final settlement').gte('created_at', startedAt)).data ?? [];
  expect(adj.find((a) => a.code === 'FNF_OTHER_1')?.amount).toBe(2000);

  const dev = await (await browser.newContext()).newPage(); // the employee sees the approved statement
  await signIn(dev, 'demo.employee');
  await open(dev, separationUrl);
  await expect(dev.getByRole('table', { name: 'Settlement' }).getByText(`Laptop bag not returned ${run}`)).toBeVisible();
});

test('HR cancels the separation and the employee stays', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, separationUrl);
  await page.getByRole('form', { name: 'Cancel separation' }).getByRole('button', { name: 'Cancel separation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Withdrawn. Nothing changes for the employee.' })).toBeVisible();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  const emp = (await admin.from('employees').select('status, date_of_exit').eq('id', devId).single()).data!;
  expect(emp).toEqual({ status: 'active', date_of_exit: null });
  const left = (await admin.from('payroll_adjustments').select('id').eq('employee_id', devId).eq('reason', 'Full and final settlement').gte('created_at', startedAt)).data ?? [];
  expect(left).toEqual([]); // the settlement's unpaid adjustments were taken back
});
