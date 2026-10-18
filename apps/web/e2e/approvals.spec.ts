import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Delegation and escalation rules on the live demo tenant: Rohan Iyer (manager) delegates his approvals to Farah
 * Qureshi for a few days; Dev Nair's leave request then reaches Farah, who approves it on Rohan's behalf (recorded
 * as such; Rohan is told); Rohan ends the delegation. HR changes how long leave approvals wait before escalating.
 * Everything created here is removed afterwards and the rule restored.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const plus = (n: number) => { const d = new Date(`${todayIst}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// A Thursday about seven weeks ahead, clear of the leave journeys' dates.
const leaveDay = (() => { const d = new Date(`${plus(49)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + ((11 - d.getUTCDay()) % 7)); return d.toISOString().slice(0, 10); })();
let orgId = '';
let devId = '';
let clId = '';
let rohanUser = '';
let leaveStep = { id: '', hours: 72 as number | null };

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  rohanUser = (await admin.from('employees').select('user_id').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single()).data!.user_id!;
  clId = (await admin.from('leave_types').select('id').eq('organization_id', orgId).eq('code', 'CL').single()).data!.id;
  const flow = (await admin.from('approval_flows').select('id').eq('organization_id', orgId).eq('subject_type', 'leave_request').eq('is_active', true).single()).data!.id;
  const step = (await admin.from('approval_flow_steps').select('id, escalate_after_hours').eq('flow_id', flow).eq('step_no', 1).single()).data!;
  leaveStep = { id: step.id, hours: step.escalate_after_hours };
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
  await admin.from('approval_delegations').delete().eq('organization_id', orgId).ilike('note', `%${run}%`);
  await admin.from('approval_flow_steps').update({ escalate_after_hours: leaveStep.hours }).eq('id', leaveStep.id);
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'approval.%').gte('created_at', startedAt);
});

test('a manager delegates; the delegate approves on their behalf; the manager ends it', async ({ browser }) => {
  const rohan = await (await browser.newContext()).newPage();
  await signIn(rohan, 'demo.manager');
  await open(rohan, '/app/demo/inbox');
  const delegate = rohan.getByRole('form', { name: 'Delegate your approvals' });
  await delegate.getByLabel('Colleague').selectOption({ label: 'Farah Qureshi' });
  await delegate.getByLabel('From').fill(todayIst);
  await delegate.getByLabel('To').fill(plus(2));
  await delegate.getByLabel('Note').fill(`Offsite ${run}`);
  await delegate.getByRole('button', { name: 'Delegate' }).click();
  await expect(delegate.getByText('Delegated.', { exact: false })).toBeVisible();
  await expect(rohan.getByRole('list', { name: 'Delegations' }).getByText('To Farah Qureshi')).toBeVisible();

  // Dev needs a day to request: HR tops up the balance, then Dev asks for one day.
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/leave?tab=balances');
  await hr.getByRole('link', { name: 'Edit balance of Dev Nair' }).click();
  const bal = hr.getByRole('form', { name: 'Balance: Casual leave' });
  const carried = bal.getByLabel('Carry-forward');
  await carried.fill(String(Number(await carried.inputValue()) + 1));
  await bal.getByLabel('Reason').fill(`Delegation check ${run}`);
  await bal.getByRole('button', { name: 'Save balance' }).click();
  await expect(hr.getByText('Balance saved.')).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/leave');
  const form = dev.getByRole('form', { name: 'Request leave' });
  await form.getByLabel('Leave type').selectOption(clId);
  await form.getByLabel('From').fill(leaveDay);
  await form.getByLabel('To').fill(leaveDay);
  await form.getByLabel('Reason').fill(`Delegation check ${run}`);
  await form.getByRole('button', { name: 'Request leave' }).click();
  await expect(dev.getByText('Leave requested. Your manager has been asked to approve it.')).toBeVisible();

  const farah = await (await browser.newContext()).newPage();
  await signIn(farah, 'demo.payroll');
  await open(farah, '/app/demo/inbox');
  const item = farah.getByRole('list', { name: 'Approvals' }).getByRole('listitem').filter({ hasText: 'Dev Nair: Casual leave' }).filter({ hasText: 'For Rohan Iyer' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(farah.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();

  const leave = (await admin.from('leave_requests').select('status, approval_request_id').eq('employee_id', devId).ilike('reason', `%${run}%`).single()).data!;
  expect(leave.status).toBe('approved');
  const action = (await admin.from('approval_actions').select('via, on_behalf_of').eq('request_id', leave.approval_request_id!).single()).data!;
  expect(action).toEqual({ via: 'delegation', on_behalf_of: rohanUser });

  await rohan.reload();
  await expect(rohan.getByRole('list', { name: 'Notifications' }).getByText(/^Approved on your behalf: Dev Nair/)).toBeVisible();
  await rohan.getByRole('form', { name: 'End delegation to Farah Qureshi' }).getByRole('button', { name: 'End' }).click();
  await expect(rohan.getByRole('status').filter({ hasText: 'Delegation ended.' })).toBeVisible();
  await expect(rohan.getByRole('list', { name: 'Delegations' })).toHaveCount(0);
});

test('HR sets how long leave approvals wait before escalating', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/inbox');
  await page.getByRole('link', { name: 'Approval rules' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Approval rules' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Escalation for Leave requests step 1' });
  await form.getByLabel('Escalate after (hours)').fill('0');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('At least 1 hour')).toBeVisible();
  await form.getByLabel('Escalate after (hours)').fill('48');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Escalates after 48 hours.')).toBeVisible();
  const step = (await admin.from('approval_flow_steps').select('escalate_after_hours').eq('id', leaveStep.id).single()).data!;
  expect(step.escalate_after_hours).toBe(48);
});
