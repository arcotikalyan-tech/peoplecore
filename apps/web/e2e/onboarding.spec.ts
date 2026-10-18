import { expect } from '@playwright/test';
import { adminClient, domain, open, signIn, test } from './helpers';

/**
 * Onboarding and policies on the live demo tenant: HR starts onboarding for a throwaway joiner who reports to
 * Rohan Iyer; Rohan finds his task in the Inbox and completes it; HR sees progress. HR publishes a policy and
 * the employee (Dev Nair) acknowledges it. Everything created here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const policyTitle = `E2E policy ${run}`;
let orgId = '';
let joinerId = '';
const joiner = `Mira Test${run}`;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const rohan = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').single()).data!;
  const in10 = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await admin.from('employees').insert({
    organization_id: orgId, employee_code: `E2E-${run}`, first_name: 'Mira', last_name: `Test${run}`,
    work_email: `e2e.onboarding.${run.toLowerCase()}@${domain}`, employment_type: 'permanent', date_of_joining: in10,
    status: 'pre_joining', manager_employee_id: rohan.id,
  }).select('id').single();
  if (error) throw new Error(error.message);
  joinerId = data.id;
});

test.afterAll(async () => {
  const { data: plans } = await admin.from('onboarding_plans').select('id').eq('employee_id', joinerId);
  if (plans?.length) await admin.from('tasks').delete().in('subject_id', plans.map((p) => p.id));
  await admin.from('onboarding_plans').delete().eq('employee_id', joinerId);
  if (joinerId) await admin.from('employees').delete().eq('id', joinerId);
  await admin.from('policy_documents').delete().eq('organization_id', orgId).eq('title', policyTitle);
});

test('HR starts onboarding; the manager completes a task from the Inbox; HR sees progress', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/onboarding');
  const form = hr.getByRole('form', { name: 'Start onboarding' });
  await form.getByLabel('Employee').selectOption({ label: `${joiner} (E2E-${run})` });
  await form.getByRole('button', { name: 'Start onboarding' }).click();
  await expect(hr.getByText('Onboarding started.', { exact: false })).toBeVisible();
  const plan = hr.getByRole('list', { name: 'Onboarding in progress' }).getByRole('listitem').filter({ hasText: joiner }).first();
  await expect(plan.getByText('0/7 done')).toBeVisible();

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/inbox');
  await manager.getByRole('button', { name: `Mark “Plan the first week — ${joiner}” done` }).click();
  await expect(manager.getByRole('list', { name: 'Tasks' }).getByText(`Plan the first week — ${joiner}`)).toHaveCount(0);

  await open(hr, '/app/demo/onboarding');
  await expect(hr.getByRole('list', { name: 'Onboarding in progress' }).getByRole('listitem').filter({ hasText: joiner }).first().getByText('1/7 done')).toBeVisible();
  const { data } = await admin.from('tasks').select('title, status').eq('assignee_employee_id', joinerId).order('title');
  expect(data?.map((t) => t.status)).toEqual(['open', 'open', 'open']); // the joiner's own three tasks wait for them
});

test('HR publishes a policy; the employee acknowledges it; HR sees who has', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/policies');
  const form = hr.getByRole('form', { name: 'Publish a policy' });
  await form.getByLabel('Title').fill(policyTitle);
  await form.locator('textarea[name="body"]').fill('Treat colleagues with respect. Report concerns to HR.');
  await form.getByRole('button', { name: 'Publish' }).click();
  await expect(hr.getByText('Policy published.')).toBeVisible();

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/policies');
  await employee.getByRole('form', { name: `Acknowledge ${policyTitle}` }).getByRole('button', { name: 'I have read and accept this policy' }).click();
  await expect(employee.getByText(/^Acknowledged /).first()).toBeVisible();

  await open(hr, '/app/demo/policies');
  await hr.getByText(/^1 of \d+ acknowledged$/).click();
  const devRow = hr.getByRole('list', { name: `Acknowledgements for ${policyTitle}` }).getByRole('listitem').filter({ hasText: 'Dev Nair' });
  await expect(devRow).toBeVisible();
  await expect(devRow.getByText('Not yet')).toHaveCount(0); // a date instead
});
