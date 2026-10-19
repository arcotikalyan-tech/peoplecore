import { expect, type Page } from '@playwright/test';
import { adminClient, domain, expectNotFound, open, signIn, test } from './helpers';

/**
 * Personal details, identity numbers and bank accounts on the live demo tenant. Uses a throwaway employee
 * (deleted afterwards, with all their details) and restores the demo employee's own details at the end.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let subjectId = '';
let devId = '';

const section = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const rohan = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').single()).data!;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  const { data, error } = await admin
    .from('employees')
    .insert({
      organization_id: orgId,
      employee_code: `E2E-${run}`,
      first_name: 'Sana',
      last_name: `Test${run}`,
      work_email: `e2e.sensitive.${run.toLowerCase()}@${domain}`,
      employment_type: 'permanent',
      date_of_joining: '2026-01-05',
      status: 'active',
      manager_employee_id: rohan.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  subjectId = data.id;
  await admin.from('employment_records').insert({
    organization_id: orgId, employee_id: subjectId, effective_from: '2026-01-05', employment_type: 'permanent',
    change_reason: 'joining', manager_employee_id: rohan.id,
  });
});

test.afterAll(async () => {
  if (subjectId) await admin.from('employees').delete().eq('id', subjectId); // cascades personal, identity, bank, contacts
  if (devId) {
    await admin.from('emergency_contacts').delete().eq('employee_id', devId);
    await admin.from('employee_personal').delete().eq('employee_id', devId);
  }
});

test('HR edits work details and personal details', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${subjectId}?tab=work`);

  const work = section(page, 'Basic Info');
  await work.getByRole('button', { name: 'Edit' }).click();
  await work.getByLabel('Work phone').fill('+91 98450 12345');
  await work.getByRole('button', { name: 'Save work details' }).click();
  await expect(work.getByText('+919845012345')).toBeVisible();

  await open(page, `/app/demo/employees/${subjectId}?tab=personal`);
  const personal = section(page, 'Personal Info');
  await personal.getByRole('button', { name: 'Edit' }).click();
  await personal.getByLabel('Date of birth').fill('1993-08-21');
  await personal.getByLabel('Blood group').selectOption('O+');
  await personal.getByRole('button', { name: 'Save personal info' }).click();
  await expect(personal.getByText('21 Aug 1993')).toBeVisible();
  await expect(personal.getByText('O+')).toBeVisible();

  const addresses = section(page, 'Addresses');
  await addresses.getByRole('button', { name: 'Edit' }).click();
  await addresses.getByLabel('City', { exact: true }).fill('Mysuru');
  await addresses.getByText('Permanent address is the same as current').click();
  await addresses.getByRole('button', { name: 'Save addresses' }).click();
  await expect(addresses.getByText('Mysuru (same as current)', { exact: false })).toBeVisible();

  const { data } = await admin.from('employee_personal').select('date_of_birth, city, blood_group, perm_same_as_current').eq('employee_id', subjectId).single();
  expect(data).toEqual({ date_of_birth: '1993-08-21', city: 'Mysuru', blood_group: 'O+', perm_same_as_current: true });
});

test('HR records identity numbers; they show masked, and viewing them in full is audited', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${subjectId}?tab=documents`);
  const identity = section(page, 'Identity numbers');
  await identity.getByRole('button', { name: 'Add identity details' }).click();

  await identity.getByLabel('PAN').fill('ABCDE1234F'); // not an individual's PAN
  await identity.getByLabel('Aadhaar (last 4 digits only)').fill('9012');
  await identity.getByLabel('UAN (PF)').fill('1001 2345 6789');
  await identity.getByRole('button', { name: 'Save identity details' }).click();
  await expect(identity.getByText('An individual’s PAN has P as its 4th character')).toBeVisible();

  await identity.getByLabel('PAN').fill('ABCPE1234F');
  await identity.getByRole('button', { name: 'Save identity details' }).click();
  await expect(identity.getByText('••••••234F')).toBeVisible();
  await expect(identity.getByText('XXXX XXXX 9012')).toBeVisible();
  await expect(identity.getByText('ABCPE1234F')).toHaveCount(0);

  await identity.getByRole('button', { name: 'Show full numbers' }).click();
  await expect(identity.getByText('ABCPE1234F')).toBeVisible();
  await expect(identity.getByText('100123456789')).toBeVisible();

  await open(page, `/app/demo/employees/${subjectId}?tab=work`);
  await expect(section(page, 'Activity').getByText('viewed the full identity details').first()).toBeVisible();
});

test('payroll changes the bank account; HR cannot see bank details at all', async ({ browser }) => {
  const payroll = await (await browser.newContext()).newPage();
  await signIn(payroll, 'demo.payroll');
  await open(payroll, `/app/demo/employees/${subjectId}?tab=payroll&view=bank`);
  const bank = section(payroll, 'Bank account');
  await bank.getByRole('button', { name: 'Add bank account' }).click();
  await bank.getByLabel('Account holder name').fill(`Sana Test${run}`);
  await bank.getByLabel('Bank name').fill('Demo Bank');
  // Required fields: match the accessible name (the visual asterisk is aria-hidden).
  await bank.getByRole('textbox', { name: 'Account number', exact: true }).fill('0012 3456 7890');
  await bank.getByLabel('Confirm account number').fill('001234567899');
  await bank.getByLabel('IFSC').fill('demb0001234');
  await bank.getByRole('button', { name: 'Save bank account' }).click();
  await expect(bank.getByText('The account numbers don’t match')).toBeVisible();

  await bank.getByLabel('Confirm account number').fill('001234567890');
  await bank.getByRole('button', { name: 'Save bank account' }).click();
  await expect(bank.getByText('••••••••7890')).toBeVisible();
  await expect(bank.getByText('DEMB0001234')).toBeVisible();

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, `/app/demo/employees/${subjectId}?tab=documents`);
  await expect(hr.getByRole('heading', { name: 'Identity numbers' })).toBeVisible();
  await open(hr, `/app/demo/employees/${subjectId}?tab=payroll&view=bank`);
  await expect(hr.getByRole('heading', { name: 'Bank account' })).toHaveCount(0);
});

test('employees edit their own personal details and emergency contacts, and cannot open a colleague', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, `/app/demo/employees/${devId}`);

  await expect(section(page, 'Personal Info').getByText('Visible to you and HR.')).toBeVisible();
  const contact = section(page, 'Contact Info');
  await contact.getByRole('button', { name: 'Edit' }).click();
  await contact.getByLabel('Personal phone').fill('+91 90000 11111');
  await contact.getByRole('button', { name: 'Save contact info' }).click();
  await expect(contact.getByText('+919000011111').first()).toBeVisible();

  await open(page, `/app/demo/employees/${devId}?tab=family`);
  const emergency = section(page, 'Emergency Contact');
  await emergency.getByRole('textbox', { name: 'Name', exact: true }).fill('Asha Nair');
  await emergency.getByLabel('Relationship').fill('Sister');
  await emergency.getByRole('textbox', { name: 'Phone', exact: true }).fill('+91 90000 22222');
  await emergency.getByRole('button', { name: 'Add contact' }).click();
  await expect(emergency.getByText('Asha Nair')).toBeVisible();

  // The employee has no access to restricted sections for colleagues, or to colleagues at all.
  await open(page, `/app/demo/employees/${subjectId}`);
  await expectNotFound(page);
});

test('a manager sees a report’s work profile but no personal, identity or bank details', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, `/app/demo/employees/${subjectId}`);
  await expect(page.getByRole('heading', { level: 1, name: `Sana Test${run}` })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Family' })).toHaveCount(0);
  for (const title of ['Personal Info', 'Identity numbers', 'Bank account']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  }
});
