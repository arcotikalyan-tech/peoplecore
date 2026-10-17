import { expect, test } from '@playwright/test';
import { adminClient, domain, expectNotFound, open, signIn } from './helpers';

/**
 * Core journeys on the live demo tenant, in order. Every step goes through the real UI; the database is
 * then checked directly. Everything created here is deleted in afterAll (audit entries stay, by design).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const dept = { code: `E2E-${run}`, name: `E2E Dept ${run}` };
const person = { first: 'Esha', last: `Test${run}`, email: `e2e.${run.toLowerCase()}@${domain}` };
const tenant = { name: `E2E Org ${run}`, slug: `e2e-${run.toLowerCase()}` };

const admin = adminClient();
let orgId = '';
let engDeptId = '';
let managerId = '';
let employeeId = '';

test.beforeAll(async () => {
  const { data: org } = await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single();
  if (!org) throw new Error('Seed the demo tenant first (seed:demo).');
  orgId = org.id;
  engDeptId = (await admin.from('departments').select('id').eq('organization_id', orgId).eq('code', 'ENG').single()).data!.id;
  const manager = await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single();
  managerId = manager.data!.id;
});

test.afterAll(async () => {
  // Employees first (their history cascades), then the department they referenced, then the test tenant.
  await admin.from('employees').delete().eq('organization_id', orgId).ilike('work_email', `%${run.toLowerCase()}%`);
  await admin.from('departments').delete().eq('organization_id', orgId).eq('code', dept.code);
  await admin.from('organizations').delete().eq('slug', tenant.slug);
});

test('HR adds a department', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/structure');

  const form = page.locator('form').filter({ has: page.getByLabel('Department name') });
  await form.getByLabel('Code').fill(dept.code);
  await form.getByLabel('Department name').fill(dept.name);
  await form.getByRole('button', { name: 'Add' }).click();

  await expect(page.getByText(`Department “${dept.name}” created.`)).toBeVisible();
  await expect(page.getByRole('cell', { name: dept.name, exact: true })).toBeVisible();

  const { data } = await admin.from('departments').select('id').eq('organization_id', orgId).eq('code', dept.code);
  expect(data).toHaveLength(1);
});

test('HR sees clear validation errors on the employee form', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/new');
  await page.getByRole('button', { name: 'Create employee' }).click();

  await expect(page.getByText('Please fix the highlighted fields.')).toBeVisible();
  await expect(page.getByText('First name is required')).toBeVisible();
  await expect(page.getByText('Enter a valid date (YYYY-MM-DD)')).toBeVisible();
  await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
});

test('HR adds an employee', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/new');

  await page.getByLabel('First name').fill(person.first);
  await page.getByLabel('Last name').fill(person.last);
  await page.getByLabel('Work email').fill(person.email);
  await page.getByLabel('Date of joining').fill('2026-10-01');
  await page.getByLabel('Department', { exact: true }).selectOption({ label: `${dept.name} (${dept.code})` });
  await page.getByLabel('Reporting manager').selectOption(managerId);
  await page.getByRole('button', { name: 'Create employee' }).click();

  await page.waitForURL(/\/app\/demo\/employees\/[0-9a-f-]{36}\?created=1$/);
  employeeId = /employees\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await expect(page.getByText('Employee created.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: `${person.first} ${person.last}` })).toBeVisible();
  await expect(page.getByText(/^EMP\d{5}$/)).toBeVisible();

  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Employment history' }) });
  await expect(history.getByText('Joining', { exact: true })).toBeVisible();

  const { data: row } = await admin.from('employees').select('status, department_id, manager_employee_id, employee_code').eq('id', employeeId).single();
  expect(row).toMatchObject({ status: 'active', manager_employee_id: managerId });
  expect(row!.employee_code).toMatch(/^EMP\d{5}$/);
});

test('a duplicate work email is refused and the form keeps what was typed', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/new');

  await page.getByLabel('First name').fill('Duplicate');
  await page.getByLabel('Work email').fill(person.email.toUpperCase());
  await page.getByLabel('Date of joining').fill('2026-10-02');
  await page.getByRole('button', { name: 'Create employee' }).click();

  await expect(page.getByText('Another employee already uses this work email.')).toBeVisible();
  await expect(page.getByLabel('First name')).toHaveValue('Duplicate');
  expect(page.url()).toContain('/employees/new');
});

test('HR records a transfer; history is kept, not overwritten', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${employeeId}`);

  await page.getByLabel('Reason').selectOption('transfer');
  await page.getByLabel('Department', { exact: true }).selectOption(engDeptId);
  await page.getByLabel('Notes').fill('E2E transfer');
  await page.getByRole('button', { name: 'Record change' }).click();

  await expect(page.getByText('Assignment recorded.')).toBeVisible();
  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Employment history' }) });
  await expect(history.getByText('Transfer', { exact: true })).toBeVisible();
  await expect(history.getByText('Joining', { exact: true })).toBeVisible();
  await expect(history.getByText('E2E transfer')).toBeVisible();

  const { data: records } = await admin
    .from('employment_records')
    .select('change_reason, effective_to, department_id')
    .eq('employee_id', employeeId)
    .order('effective_from');
  expect(records!.map((r) => r.change_reason)).toEqual(['joining', 'transfer']);
  expect(records![0]!.effective_to).not.toBeNull(); // the joining entry was closed, not edited away
  expect(records![1]).toMatchObject({ effective_to: null, department_id: engDeptId });
  const { data: snapshot } = await admin.from('employees').select('department_id').eq('id', employeeId).single();
  expect(snapshot!.department_id).toBe(engDeptId);
});

test('every change above is in the audit log, attributed to HR', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/audit');

  const byHr = page.getByRole('row').filter({ hasText: 'Kiran Menon' });
  await expect(byHr.filter({ hasText: 'Departments' }).first()).toBeVisible();
  await expect(byHr.filter({ hasText: 'Employment records' }).first()).toBeVisible();
  await expect(byHr.filter({ has: page.getByRole('link', { name: 'Employee' }) }).first()).toBeVisible();

  const { count } = await admin
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('entity_id', employeeId);
  expect(count).toBeGreaterThanOrEqual(2); // created + snapshot updated by the transfer
});

test('the manager sees the new report but cannot edit; an employee cannot see them at all', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, `/app/demo/employees/${employeeId}`);
  await expect(page.getByRole('heading', { level: 1, name: `${person.first} ${person.last}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Change assignment' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Activity' })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, 'demo.employee');
  await open(page, `/app/demo/employees/${employeeId}`);
  await expectNotFound(page);
  await expect(page.getByText(person.last)).toHaveCount(0);
});

test('the platform admin creates a tenant and cannot see inside it', async ({ page }) => {
  await signIn(page, 'demo.platform');
  await expect(page.getByText('You’re not a member of any organization yet')).toBeVisible();
  await open(page, '/platform');

  await page.getByLabel('Organization name').fill(tenant.name);
  // Accessible name (what screen readers announce) excludes the visual "required" asterisk.
  await page.getByRole('textbox', { name: 'URL', exact: true }).fill(tenant.slug);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page.getByText(`Organization “${tenant.name}” created.`)).toBeVisible();
  await expect(page.getByRole('cell', { name: `/app/${tenant.slug}` })).toBeVisible();
  const { data: roles } = await admin
    .from('roles')
    .select('key, organizations!inner(slug)')
    .eq('organizations.slug', tenant.slug);
  expect(roles).toHaveLength(8); // standard roles seeded for the new tenant

  await open(page, `/app/${tenant.slug}`);
  await expectNotFound(page);
});

test('signing out ends the session', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/);

  await page.goto('/app/demo/employees');
  await expect(page).toHaveURL(/\/login\?next=/);
});
