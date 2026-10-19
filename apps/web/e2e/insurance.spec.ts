import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Insurance on the demo tenant: HR sets up the group policy (hiding the policy number from employees), covers Dev,
 * sees him as an endorsement addition and locks the endorsement; Dev sees his cover without the policy number.
 * The policy, coverage and endorsement are restored or removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let policyBefore: Record<string, unknown> | null = null;
let coverageBefore: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  policyBefore = (await admin.from('insurance_policies').select('*').eq('organization_id', orgId).maybeSingle()).data;
  coverageBefore = (await admin.from('insurance_coverage').select('*').eq('employee_id', devId).maybeSingle()).data;
});

test.afterAll(async () => {
  await admin.from('insurance_syncs').delete().eq('organization_id', orgId).gte('synced_at', startedAt);
  if (policyBefore) await admin.from('insurance_policies').upsert(policyBefore as never);
  else await admin.from('insurance_policies').delete().eq('organization_id', orgId);
  if (coverageBefore) await admin.from('insurance_coverage').upsert(coverageBefore as never);
  else await admin.from('insurance_coverage').delete().eq('employee_id', devId);
});

test('HR sets up the policy, covers an employee and locks the endorsement; the employee sees the cover', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/insurance');
  await expect(page.getByRole('heading', { level: 1, name: 'Insurance' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Policy' });
  await form.getByLabel('Insurer name').selectOption('Acko General Insurance');
  await form.getByLabel('Policy number').fill(`GHI-${run}`);
  await form.getByRole('checkbox').nth(1).uncheck(); // policy number: not shown to employees
  await form.getByRole('button', { name: /Key Benefits/ }).click();
  await form.getByLabel('Sum insured (₹)').fill('300000');
  await form.getByLabel('Cover type').selectOption('ESC');
  await form.getByRole('button', { name: 'Save policy' }).click();
  await expect(form.getByText('Policy saved.')).toBeVisible();

  await open(page, '/app/demo/insurance?tab=management&view=members');
  await page.getByRole('form', { name: 'Coverage for Dev Nair' }).getByRole('button', { name: 'Cover' }).click();
  await expect(page.getByRole('table', { name: 'Insured members' }).getByRole('row').filter({ hasText: 'Dev Nair' }).getByText('● Yes')).toBeVisible();

  await open(page, '/app/demo/insurance?tab=management&view=endorsement');
  await expect(page.getByRole('table', { name: 'Additions' }).getByText('Dev Nair').first()).toBeVisible();
  await page.getByRole('form', { name: 'Lock endorsement' }).getByRole('button', { name: 'Lock & mark synced' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Endorsement locked and marked synced/ }).first()).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/insurance');
  await expect(dev.getByRole('heading', { level: 1, name: 'My Insurance' })).toBeVisible();
  await expect(dev.getByRole('table', { name: 'Insured members' }).getByText('Dev Nair')).toBeVisible();
  await expect(dev.getByText('₹3,00,000').first()).toBeVisible();
  await expect(dev.getByText(`GHI-${run}`)).toHaveCount(0);
});
