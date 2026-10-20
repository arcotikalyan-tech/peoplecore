import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Two employee self-service flows on the demo tenant: logging mileage (priced at the organization's rate into this
 * month's draft mileage claim) and asking HR to erase personal contact details, which HR does. Dev's contact details
 * and the claim are restored or removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let devId = '';
let personalBefore: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  personalBefore = (await admin.from('employee_personal').select('*').eq('employee_id', devId).maybeSingle()).data;
});

test.afterAll(async () => {
  const items = (await admin.from('expense_items').select('claim_id').like('merchant', `%${run}%`)).data ?? [];
  const claims = [...new Set(items.map((i) => i.claim_id))];
  if (claims.length) { await admin.from('expense_items').delete().in('claim_id', claims); await admin.from('expense_claims').delete().in('id', claims); }
  await admin.from('data_deletion_requests').delete().eq('employee_id', devId);
  if (personalBefore) await admin.from('employee_personal').upsert(personalBefore as never);
});

test('an employee logs mileage', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/expenses');
  const form = page.getByRole('form', { name: 'Log mileage' });
  await form.locator('input[name="from"]').fill(`Office ${run}`);
  await form.locator('input[name="to"]').fill('Client site');
  await form.locator('input[name="km"]').fill('20');
  await expect(form.getByText(/→ ₹240/)).toBeVisible();
  await form.getByRole('button', { name: 'Add trip' }).click();
  await page.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`Office ${run} → Client site`)).toBeVisible();
});

test('an employee asks HR to erase contact details; HR erases them', async ({ page, browser }) => {
  await admin.from('employee_personal').upsert({ ...(personalBefore ?? { organization_id: orgId, employee_id: devId }), personal_email: 'dev.personal@example.test' } as never);
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/preferences');
  const req = page.getByRole('form', { name: 'Request data deletion' });
  await req.getByLabel('Personal email and phone numbers').check();
  await req.getByRole('button', { name: 'Send request to HR' }).click();
  await expect(page.getByText('Request sent to HR.')).toBeVisible();

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/employees?tab=deletion');
  await hr.getByRole('form', { name: 'Decide request from Dev Nair' }).getByRole('button', { name: 'Erase now' }).click();
  await expect(hr.getByText('Erased. The employee has been told.')).toBeVisible();
  await hr.context().close();

  expect((await admin.from('employee_personal').select('personal_email').eq('employee_id', devId).single()).data!.personal_email).toBeNull();
  await open(page, '/app/demo/preferences');
  await expect(page.getByRole('list', { name: 'Your deletion requests' }).getByText('Erased')).toBeVisible();
});

test('employees see their own onboarding, not the admin hub', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/onboarding');
  await expect(page.getByRole('heading', { level: 1, name: 'My onboarding' })).toBeVisible();
  await expect(page.getByText('Guided plan')).toHaveCount(0);
});
