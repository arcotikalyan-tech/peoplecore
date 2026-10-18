import { expect, test } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn } from './helpers';

/**
 * Assets and system access on the live demo tenant: HR adds a laptop and issues it to Dev Nair, who confirms
 * receipt; HR takes it back. HR adds a system, records Dev's account, and revokes it. Employees can't reach the
 * inventory or the access register. Removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
});

test.afterAll(async () => {
  const assets = (await admin.from('assets').select('id').eq('organization_id', orgId).like('name', `%${run}%`)).data ?? [];
  if (assets.length) {
    await admin.from('asset_assignments').delete().in('asset_id', assets.map((a) => a.id));
    await admin.from('assets').delete().in('id', assets.map((a) => a.id));
  }
  const systems = (await admin.from('access_systems').select('id').eq('organization_id', orgId).like('name', `%${run}%`)).data ?? [];
  if (systems.length) {
    await admin.from('access_grants').delete().in('system_id', systems.map((s) => s.id));
    await admin.from('access_systems').delete().in('id', systems.map((s) => s.id));
  }
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'asset.%').gte('created_at', startedAt);
});

test('HR issues a laptop; the employee confirms receipt; HR takes it back', async ({ browser }) => {
  const laptop = `Loaner laptop ${run}`;
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/assets/new');
  const form = hr.getByRole('form', { name: 'Add an asset' });
  await form.getByLabel('Name').fill(laptop);
  await form.getByLabel('Type').fill('Laptop');
  await form.getByLabel('Serial number').fill(`E2E-${run}`);
  await form.getByRole('button', { name: 'Add asset' }).click();
  await hr.waitForURL(/\/assets\/[0-9a-f-]{36}$/);
  await expect(hr.getByRole('status').filter({ hasText: /Asset AST-\d+ added\./ })).toBeVisible();
  const assetUrl = new URL(hr.url()).pathname;

  const issue = hr.getByRole('form', { name: 'Issue asset' });
  await issue.getByLabel('Issue to').selectOption(devId);
  await issue.getByLabel('Condition').fill('Good, with charger');
  await issue.getByRole('button', { name: 'Issue' }).click();
  await expect(hr.getByRole('status').filter({ hasText: 'Issued. They’ve been asked to confirm they have it.' })).toBeVisible();
  await expect(hr.getByRole('list', { name: 'Issue history' }).getByText('Not confirmed')).toBeVisible();

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/assets');
  await expect(employee.getByRole('table', { name: 'Assets' })).toHaveCount(0); // no inventory for employees
  await employee.getByRole('form', { name: `Confirm receipt of ${laptop}` }).getByRole('button', { name: 'I have it' }).click();
  await expect(employee.getByRole('status').filter({ hasText: 'Thanks. Receipt confirmed.' })).toBeVisible();
  await expect(employee.getByRole('list', { name: 'Your assets' }).getByRole('listitem').filter({ hasText: laptop }).getByText('Confirmed')).toBeVisible();

  await open(hr, assetUrl);
  await expect(hr.getByRole('list', { name: 'Issue history' }).getByText('Confirmed', { exact: true })).toBeVisible();
  const back = hr.getByRole('form', { name: 'Record return' });
  await back.getByLabel('Then').selectOption('in_stock');
  await back.getByLabel('Condition on return').fill('Good');
  await back.getByRole('button', { name: 'Record return' }).click();
  await expect(hr.getByRole('status').filter({ hasText: 'Return recorded.' })).toBeVisible();
  await expect(hr.getByRole('form', { name: 'Issue asset' })).toBeVisible(); // back in stock

  const db = (await admin.from('assets').select('status').eq('organization_id', orgId).eq('name', laptop).single()).data!;
  expect(db.status).toBe('in_stock');
});

test('HR records system access for the employee and revokes it', async ({ browser }) => {
  const system = `Wiki ${run}`;
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/assets/access');
  const add = hr.getByRole('form', { name: 'Add a system' });
  await add.getByLabel('System').fill(system);
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(add.getByText('System added.')).toBeVisible();

  const record = hr.getByRole('form', { name: 'Record access' });
  await record.getByLabel('Person').selectOption(devId);
  await record.getByLabel('System').selectOption({ label: system });
  await record.getByLabel('Account').fill(`dev.${run.toLowerCase()}`);
  await record.getByLabel('Access level').fill('Editor');
  await record.getByRole('button', { name: 'Record access' }).click();
  await expect(record.getByText('Access recorded.')).toBeVisible();

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/assets');
  await expect(employee.getByRole('list', { name: 'Your system access' }).getByText(system)).toBeVisible();

  await hr.reload();
  const revoke = hr.getByRole('form', { name: `Revoke dev.${run.toLowerCase()} in ${system}` });
  await revoke.getByLabel('Reason').fill('Moved off the project');
  await revoke.getByRole('button', { name: 'Revoke' }).click();
  await expect(hr.getByRole('status').filter({ hasText: 'Access revoked.' })).toBeVisible();

  await employee.reload();
  await expect(employee.getByRole('list', { name: 'Your system access' }).getByText(system)).toHaveCount(0);
  const grant = (await admin.from('access_grants').select('revoked_at, revoke_note').eq('organization_id', orgId).eq('account', `dev.${run.toLowerCase()}`).single()).data!;
  expect(grant.revoked_at).not.toBeNull();
  expect(grant.revoke_note).toBe('Moved off the project');
});

test('employees can’t open the inventory or the access register', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/assets/new');
  await expectNotFound(page);
  await open(page, '/app/demo/assets/access');
  await expectNotFound(page);
});
