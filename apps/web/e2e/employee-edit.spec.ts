import { expect } from '@playwright/test';
import { adminClient, domain, open, signIn, test } from './helpers';

/**
 * Editing an employee shows what the view shows: HR changes the official email from Contact Info, corrects the joining
 * date in Basic Info and moves a contract hire to permanent through Change assignment; the employee sees the official
 * email but can't change it. Uses a throwaway employee record (deleted afterwards) and Dev's own record (put back).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const admin = adminClient();
let orgId = '';
let empId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  empId = (await admin.from('employees').insert({
    organization_id: orgId, employee_code: `ED${run.toUpperCase()}`, first_name: 'Edit', last_name: `Check${run}`, work_email: `edit.${run}@${domain}`,
    status: 'active', employment_type: 'contract', date_of_joining: '2026-02-10',
  }).select('id').single()).data!.id;
  await admin.from('employment_records').insert({ organization_id: orgId, employee_id: empId, effective_from: '2026-02-10', employment_type: 'contract', change_reason: 'joining' });
});

test.afterAll(async () => {
  await admin.from('employment_records').delete().eq('employee_id', empId);
  await admin.from('employee_personal').delete().eq('employee_id', empId);
  await admin.from('employees').delete().eq('id', empId);
});

test('HR edits the official email, corrects the joining date and makes a contract hire permanent', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${empId}?tab=personal`);
  const contact = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Contact Info' }) }).first();
  await expect(contact.getByText(`edit.${run}@${domain}`)).toBeVisible();
  await contact.getByRole('button', { name: 'Edit' }).click();
  const form = page.getByRole('form', { name: 'Contact info' });
  await expect(form.getByLabel('Official email')).toHaveValue(`edit.${run}@${domain}`);
  await form.getByLabel('Official email').fill(`edit.new.${run}@${domain}`);
  await form.getByRole('button', { name: 'Save contact info' }).click();
  await expect(page.getByText(`edit.new.${run}@${domain}`).first()).toBeVisible();
  expect((await admin.from('employees').select('work_email').eq('id', empId).single()).data!.work_email).toBe(`edit.new.${run}@${domain}`);

  await open(page, `/app/demo/employees/${empId}?tab=work`);
  const basic = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Basic Info' }) }).first();
  await basic.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Date of joining').fill('2026-02-01');
  await page.getByRole('button', { name: 'Save work details' }).click();
  await expect(page.getByText('Work details saved.')).toBeVisible();
  expect((await admin.from('employees').select('date_of_joining').eq('id', empId).single()).data!.date_of_joining).toBe('2026-02-01');
  expect((await admin.from('employment_records').select('effective_from').eq('employee_id', empId).eq('change_reason', 'joining').single()).data!.effective_from).toBe('2026-02-01');

  await open(page, `/app/demo/employees/${empId}?tab=work`);
  await page.getByLabel('Effective from').fill('2026-08-01');
  await page.getByLabel('Reason').selectOption({ label: 'Employment type change' });
  await page.getByLabel('Employee type').selectOption({ label: 'Permanent' });
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect.poll(async () => (await admin.from('employees').select('employment_type').eq('id', empId).single()).data!.employment_type).toBe('permanent');
});

test('employees see their official email in Contact Info but only HR changes it', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'My profile' }).click();
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}/);
  await open(page, `${new URL(page.url()).pathname}?tab=personal`);
  const contact = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Contact Info' }) }).first();
  await contact.getByRole('button', { name: 'Edit' }).click();
  const official = page.getByRole('form', { name: 'Contact info' }).getByLabel('Official email');
  await expect(official).toBeDisabled();
  await expect(official).not.toHaveValue('');
});
