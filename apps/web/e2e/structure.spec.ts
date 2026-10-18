import { expect, type Page } from '@playwright/test';
import { adminClient, domain, open, signIn, test } from './helpers';

/**
 * Editing, archiving and restoring structure on the live demo tenant. Uses throwaway departments and one
 * throwaway employee, all deleted afterwards (audit entries stay, by design).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const used = { code: `E2EU-${run}`, name: `E2E Used ${run}` };
const spare = { code: `E2ES-${run}`, name: `E2E Spare ${run}` };
const admin = adminClient();
let orgId = '';
let usedId = '';
let spareId = '';

const row = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const { data, error } = await admin.from('departments')
    .insert([{ organization_id: orgId, ...used }, { organization_id: orgId, ...spare }])
    .select('id, code');
  if (error) throw new Error(error.message);
  usedId = data.find((d) => d.code === used.code)!.id;
  spareId = data.find((d) => d.code === spare.code)!.id;
  const emp = await admin.from('employees').insert({
    organization_id: orgId, employee_code: `E2E-${run}`, first_name: 'Kiran', last_name: `Test${run}`,
    work_email: `e2e.structure.${run.toLowerCase()}@${domain}`, employment_type: 'permanent',
    date_of_joining: '2026-01-05', status: 'active', department_id: usedId,
  });
  if (emp.error) throw new Error(emp.error.message);
});

test.afterAll(async () => {
  await admin.from('employees').delete().eq('organization_id', orgId).eq('employee_code', `E2E-${run}`);
  await admin.from('departments').delete().eq('organization_id', orgId).in('id', [usedId, spareId].filter(Boolean));
});

test('HR renames a department and moves it under another', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/structure');

  await row(page, spare.name).getByRole('button', { name: `Edit ${spare.name}` }).click();
  const editor = page.getByRole('form', { name: `Edit department ${spare.name}` });
  await editor.getByLabel('Department name').fill(`${spare.name} Ops`);
  await editor.getByLabel('Parent department').selectOption({ label: used.name });
  await editor.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText(`Department “${spare.name} Ops” updated.`)).toBeVisible();
  await expect(row(page, `${spare.name} Ops`).getByRole('cell', { name: used.name, exact: true })).toBeVisible();
  const { data } = await admin.from('departments').select('name, parent_id').eq('id', spareId).single();
  expect(data).toEqual({ name: `${spare.name} Ops`, parent_id: usedId });
  spare.name = `${spare.name} Ops`;
});

test('a department in use cannot be archived; an unused one can, and comes back', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/structure');

  // Used by one employee and parent of the spare department.
  await expect(row(page, used.name).getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await row(page, used.name).getByRole('button', { name: `Archive ${used.name}` }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This department is still used by 1 current employee.' })).toBeVisible();

  await row(page, spare.name).getByRole('button', { name: `Archive ${spare.name}` }).click();
  await expect(row(page, spare.name)).toHaveCount(0); // moved to the collapsed archived list
  await page.getByText(/^Archived \(\d+\)$/).first().click();
  await expect(row(page, spare.name).getByRole('button', { name: `Restore ${spare.name}` })).toBeVisible();
  expect((await admin.from('departments').select('archived_at').eq('id', spareId).single()).data!.archived_at).not.toBeNull();

  // Archived departments aren't offered to employees.
  await open(page, '/app/demo/employees/new');
  await expect(page.getByLabel('Department').locator('option', { hasText: spare.name })).toHaveCount(0);

  await open(page, '/app/demo/structure');
  await page.getByText(/^Archived \(\d+\)$/).first().click();
  await row(page, spare.name).getByRole('button', { name: `Restore ${spare.name}` }).click();
  await expect(row(page, spare.name).getByRole('button', { name: `Edit ${spare.name}` })).toBeVisible();
  expect((await admin.from('departments').select('archived_at').eq('id', spareId).single()).data!.archived_at).toBeNull();
});

test('a manager sees the structure read-only', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, '/app/demo/structure');
  await expect(page.getByRole('cell', { name: used.name, exact: true }).first()).toBeVisible(); // also shown as a parent
  await expect(page.getByRole('button', { name: /^(Edit|Archive) / })).toHaveCount(0);
  await expect(page.getByLabel('Department name')).toHaveCount(0);
});
