import { expect, type Page } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Leave on the live demo tenant: HR sets a holiday and an opening balance; the employee (Dev Nair) requests
 * leave around it; their manager (Rohan Iyer) approves one request in the Inbox and rejects another; the
 * employee cancels the approved one before it starts. Everything created here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let devId = '';
let clId = '';
let slId = '';
const startedAt = new Date().toISOString();

// A Monday at least three weeks ahead (organization time zone: Asia/Kolkata), and helpers around it.
const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const monday = (() => {
  const d = new Date(`${todayIst}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 21);
  d.setUTCDate(d.getUTCDate() + ((8 - (d.getUTCDay() || 7)) % 7));
  return d;
})();
const day = (n: number) => new Date(monday.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const holiday = `E2E Holiday ${run}`;

const available = async (code: string) => {
  const { data } = await admin.from('leave_ledger').select('days').eq('employee_id', devId).eq('leave_type_id', code === 'CL' ? clId : slId);
  const { data: pending } = await admin.from('leave_requests').select('days').eq('employee_id', devId)
    .eq('leave_type_id', code === 'CL' ? clId : slId).eq('status', 'pending');
  return (data ?? []).reduce((s, r) => s + Number(r.days), 0) - (pending ?? []).reduce((s, r) => s + Number(r.days), 0);
};

async function requestLeave(page: Page, typeId: string, start: string, end: string, reason: string) {
  const form = page.getByRole('form', { name: 'Request leave' });
  await form.getByLabel('Leave type').selectOption(typeId);
  await form.getByLabel('From').fill(start);
  await form.getByLabel('To').fill(end);
  await form.getByLabel('Reason').fill(reason);
  await form.getByRole('button', { name: 'Request leave' }).click();
}

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  const types = (await admin.from('leave_types').select('id, code').eq('organization_id', orgId)).data!;
  clId = types.find((t) => t.code === 'CL')!.id;
  slId = types.find((t) => t.code === 'SL')!.id;
  // A day of sick leave for the rejection journey, whatever the tenant's accrual history (a fresh CI tenant has none).
  await admin.from('leave_ledger').insert({
    organization_id: orgId, employee_id: devId, leave_type_id: slId, entry_date: todayIst, kind: 'adjust', days: 1, note: `E2E sick leave ${run}`,
  });
});

test.afterAll(async () => {
  const { data: reqs } = await admin.from('leave_requests').select('id, approval_request_id').eq('employee_id', devId).ilike('reason', `%${run}%`);
  const ids = (reqs ?? []).map((r) => r.id);
  if (ids.length) {
    await admin.from('leave_ledger').delete().in('request_id', ids);
    await admin.from('leave_requests').update({ approval_request_id: null }).in('id', ids);
    await admin.from('approval_requests').delete().in('id', (reqs ?? []).map((r) => r.approval_request_id).filter((x): x is string => !!x));
    await admin.from('leave_requests').delete().in('id', ids);
  }
  await admin.from('leave_ledger').delete().eq('employee_id', devId).ilike('note', `%${run}%`);
  await admin.from('holidays').delete().eq('organization_id', orgId).eq('name', holiday);
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'approval.%').gte('created_at', startedAt);
});

test('HR adds a holiday and an opening balance', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/leave');
  await page.getByRole('link', { name: 'Leave settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Leave settings' })).toBeVisible();

  const hol = page.getByRole('form', { name: 'Add a holiday' });
  await hol.getByLabel('Date').fill(day(2)); // the Wednesday
  await hol.getByLabel('Holiday').fill(holiday);
  await hol.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('list', { name: 'Holidays' }).getByText(holiday)).toBeVisible();

  const before = await available('CL');
  const adj = page.getByRole('form', { name: 'Adjust a balance' });
  await adj.getByLabel('Employee').selectOption({ label: (await page.locator('#f-adj-employeeId option', { hasText: 'Dev Nair' }).textContent())! });
  await adj.getByLabel('Leave type').selectOption(clId);
  await adj.getByLabel('Days (±)').fill('3');
  await adj.getByLabel('Reason').fill(`Opening balance ${run}`);
  await adj.getByRole('button', { name: 'Adjust balance' }).click();
  await expect(page.getByText('Balance adjusted by 3 day(s).')).toBeVisible();
  expect(await available('CL')).toBe(before + 3);
});

test('the employee requests leave around the holiday; the manager approves it in the Inbox', async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/leave');
  const before = await available('CL');
  await requestLeave(employee, clId, day(0), day(3), `Family visit ${run}`); // Mon–Thu, Wednesday is a holiday
  await expect(employee.getByText('Leave requested. Your manager has been asked to approve it.')).toBeVisible();
  const row = employee.getByRole('row').filter({ hasText: 'Casual leave' }).filter({ hasText: 'Pending' });
  await expect(row.getByRole('cell', { name: '3', exact: true })).toBeVisible();
  expect(await available('CL')).toBe(before - 3);

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/inbox');
  const decision = manager.getByRole('form', { name: /^Decide: Dev Nair: Casual leave/ });
  await decision.getByRole('button', { name: 'Approve' }).click();
  await expect(manager.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();
  await expect(decision).toHaveCount(0); // left the queue

  await open(employee, '/app/demo/leave');
  await expect(employee.getByRole('row').filter({ hasText: 'Casual leave' }).getByText('Approved')).toBeVisible();
  const { data } = await admin.from('leave_requests').select('status, days').eq('employee_id', devId).ilike('reason', `%Family visit ${run}%`).single();
  expect(data).toEqual({ status: 'approved', days: 3 });
  expect(await available('CL')).toBe(before - 3);

  await open(employee, '/app/demo/inbox');
  await expect(employee.getByRole('list', { name: 'Notifications' }).getByText(/^Approved: Dev Nair: Casual leave/)).toBeVisible();
});

test('the employee cancels the approved leave before it starts; the days come back', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/leave');
  const before = await available('CL');
  await page.getByRole('row').filter({ hasText: 'Casual leave' }).filter({ hasText: 'Approved' }).getByRole('button', { name: /^Cancel / }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Casual leave' }).getByText('Cancelled')).toBeVisible();
  expect(await available('CL')).toBe(before + 3);
});

test('a rejection needs a reason and leaves the balance untouched', async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/leave');
  const before = await available('SL');
  await requestLeave(employee, slId, day(7), day(7), `Appointment ${run}`);
  await expect(employee.getByText('Leave requested.', { exact: false })).toBeVisible();

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/inbox');
  const decision = manager.getByRole('form', { name: /^Decide: Dev Nair: Sick leave/ });
  await decision.getByRole('button', { name: 'Reject' }).click();
  await expect(manager.getByRole('alert').filter({ hasText: 'Give a reason when rejecting.' })).toBeVisible();
  await decision.getByLabel('Comment').fill('Clashes with the quarterly review');
  await decision.getByRole('button', { name: 'Reject' }).click();
  await expect(manager.getByRole('status').filter({ hasText: 'Rejected.' })).toBeVisible();

  await open(employee, '/app/demo/leave');
  await expect(employee.getByRole('row').filter({ hasText: 'Sick leave' }).getByText('Rejected')).toBeVisible();
  expect(await available('SL')).toBe(before);
});
