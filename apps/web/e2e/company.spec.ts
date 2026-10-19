import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Company Profile on the demo tenant: HR edits company details and statutory IDs (a bad PAN is refused), adds the
 * registered office and a director, and creates a custom employee field that then appears on a profile. Restored after.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';
let before: Record<string, unknown> | null = null;
const field = `E2E shirt ${Date.now()}`;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  before = (await admin.from('company_profiles').select('*').eq('organization_id', orgId).maybeSingle()).data;
  await admin.from('company_addresses').delete().eq('organization_id', orgId).eq('kind', 'registered');
});

test.afterAll(async () => {
  if (before) await admin.from('company_profiles').update(before as never).eq('organization_id', orgId);
  await admin.from('company_addresses').delete().eq('organization_id', orgId).eq('kind', 'registered');
  await admin.from('company_officers').delete().eq('organization_id', orgId).eq('name', 'E2E Director');
  await admin.from('employee_custom_fields').delete().eq('organization_id', orgId).eq('label', field);
});

test('HR maintains the company profile, statutory IDs, offices, directors and custom fields', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/company?tab=overview&edit=details');
  const details = page.getByRole('form', { name: 'Company details' });
  await details.getByLabel('Brand name').fill('PeopleCore Demo');
  await details.getByLabel('Industry type').fill('Software');
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await open(page, '/app/demo/company?tab=statutory&edit=ids');
  const ids = page.getByRole('form', { name: 'Company ID' });
  await ids.getByLabel('Company PAN').fill('BAD');
  await ids.getByRole('button', { name: 'Save' }).click();
  await expect(ids.getByText('Like AAACD1234E')).toBeVisible();
  await ids.getByLabel('Company PAN').fill('AAACP1234E');
  await ids.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const director = page.getByRole('form', { name: 'Add director' });
  await director.getByLabel('Name').fill('E2E Director');
  await director.getByLabel('DIN').fill('01234567');
  await director.getByRole('button', { name: '⊕ Add director' }).click();
  await expect(page.getByRole('cell', { name: 'E2E Director', exact: true })).toBeVisible();

  await open(page, '/app/demo/company?tab=address');
  const reg = page.getByRole('form', { name: 'Registered office' });
  await reg.getByLabel('Address line 1').fill('1 Example Road');
  await reg.getByLabel('City').fill('Bengaluru');
  await reg.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByText('Address saved.').first()).toBeVisible();
  await expect(page.getByText('1 Example Road')).toBeVisible();

  await open(page, '/app/demo/company?tab=fields');
  const cf = page.getByRole('form', { name: 'Create field' });
  await cf.getByLabel('Field name').fill(field);
  await cf.getByLabel('Type').selectOption('select');
  await cf.getByLabel('Options (comma-separated)').fill('S, M, L');
  await cf.getByRole('button', { name: 'Create field' }).click();
  await expect(page.getByRole('cell', { name: field, exact: true })).toBeVisible();

  const dev = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').single()).data!.id;
  await open(page, `/app/demo/employees/${dev}`);
  const values = page.getByRole('form', { name: 'Custom fields' });
  await values.getByLabel(field).selectOption('M');
  await values.getByRole('button', { name: 'Save' }).click();
  await expect(values.getByText('Saved.')).toBeVisible();
});

test('employees read the company profile but can’t edit it', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/company');
  await expect(page.getByRole('heading', { level: 1, name: 'Company Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: '✎ Edit profile' })).toHaveCount(0);
});
