import { expect } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

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
  await admin.from('asset_requests').delete().eq('organization_id', orgId).like('reason', `%${run}%`);
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
  await admin.from('payroll_adjustments').delete().eq('organization_id', orgId).eq('code', 'ASSET_RECOVERY').like('reason', `%${run}%`).is('applied_run_id', null);
  await admin.from('asset_requests').delete().eq('organization_id', orgId).like('reason', `%${run}%`);
  await admin.from('asset_categories').delete().eq('organization_id', orgId).like('name', `%${run}%`);
});

test('HR issues a laptop; the employee confirms receipt; HR takes it back', async ({ browser }) => {
  const laptop = `Loaner laptop ${run}`;
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/assets/new');
  const form = hr.getByRole('form', { name: 'Add an asset' });
  await form.getByLabel('Name').fill(laptop);
  await form.getByLabel('Category').selectOption({ label: 'Laptop' });
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

test('an employee requests a monitor; HR fulfils it; it is lost and the dues go to payroll', async ({ browser }) => {
  const monitor = `Spare monitor ${run}`;
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/assets/new');
  const form = hr.getByRole('form', { name: 'Add an asset' });
  await form.getByLabel('Name').fill(monitor);
  await form.getByLabel('Category').selectOption({ label: 'Monitor' });
  await form.getByLabel('Condition').selectOption('new');
  await form.getByRole('button', { name: 'Add asset' }).click();
  await hr.waitForURL(/\/assets\/[0-9a-f-]{36}$/);
  const assetUrl = new URL(hr.url()).pathname;

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/assets?tab=requests');
  await expect(employee.getByRole('heading', { level: 1, name: 'My Assets' })).toBeVisible();
  const req = employee.getByRole('form', { name: 'Request asset' });
  await req.getByLabel('Category').selectOption((await req.getByLabel('Category').locator('option', { hasText: 'Monitor' }).getAttribute('value'))!);
  await req.getByLabel('Reason').fill(`Second screen ${run}`);
  await req.getByRole('button', { name: '＋ Request Asset' }).click();
  await expect(req.getByText('Request raised. Asset managers have been told.')).toBeVisible();
  await expect(employee.getByRole('table', { name: 'My requests' }).getByRole('row').filter({ hasText: `Second screen ${run}` }).getByText('Pending')).toBeVisible();

  await open(hr, '/app/demo/assets?tab=requests');
  await expect(hr.getByRole('heading', { level: 1, name: 'Asset Management' })).toBeVisible();
  const decide = hr.getByRole('form', { name: 'Decide: Dev Nair: Monitor' });
  const option = await decide.getByLabel('Issue').locator('option', { hasText: monitor }).getAttribute('value');
  await decide.getByLabel('Issue').selectOption(option!);
  await decide.getByRole('button', { name: 'Approve' }).click();
  await expect(hr.getByRole('status').filter({ hasText: 'Approved and issued.' })).toBeVisible();

  await employee.reload();
  await expect(employee.getByRole('table', { name: 'My requests' }).getByRole('row').filter({ hasText: `Second screen ${run}` }).getByText('Fulfilled')).toBeVisible();

  await open(hr, assetUrl);
  const back = hr.getByRole('form', { name: 'Record return' });
  await back.getByLabel('Then').selectOption('lost');
  await back.getByRole('button', { name: 'Record return' }).click();
  await expect(hr.getByRole('status').filter({ hasText: 'Recorded as lost.' })).toBeVisible();
  await hr.getByRole('list', { name: 'Issue history' }).locator('summary', { hasText: 'Record dues' }).click();
  const dues = hr.getByRole('form', { name: 'Record dues' });
  await dues.getByLabel('Amount due (₹)').fill('12000');
  await dues.getByLabel('For').fill(`Lost monitor ${run}`);
  await dues.getByRole('button', { name: 'Record dues' }).click();
  await expect(hr.getByText(/Dues ₹12,000(\.00)? · Pending/)).toBeVisible();

  await open(hr, '/app/demo/assets?tab=dues');
  await hr.getByRole('form', { name: `Settle dues: Dev Nair · ${monitor}` }).getByRole('button', { name: 'Deduct in payroll' }).click();
  await expect(hr.getByRole('status').filter({ hasText: 'Added to the next payroll run as a deduction.' })).toBeVisible();
  const adj = (await admin.from('payroll_adjustments').select('kind, amount').eq('organization_id', orgId).eq('code', 'ASSET_RECOVERY').like('reason', `%${run}%`).single()).data!;
  expect(adj).toEqual({ kind: 'deduction', amount: 12000 });
});

test('HR adds a category and sends an asset for repair', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/assets?tab=categories');
  const add = page.getByRole('form', { name: 'Add category' });
  await add.getByLabel('Category').fill(`Tablet ${run}`);
  await add.getByLabel('Useful life (months)').fill('30');
  await add.getByRole('button', { name: '＋ Add Category' }).click();
  await expect(add.getByText(`Category Tablet ${run} added.`)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Asset categories' }).getByText(`Tablet ${run}`)).toBeVisible();

  await open(page, '/app/demo/assets/new');
  const form = page.getByRole('form', { name: 'Add an asset' });
  await form.getByLabel('Name').fill(`Tab ${run}`);
  await form.getByLabel('Category').selectOption({ label: `Tablet ${run}` });
  await form.getByRole('button', { name: 'Add asset' }).click();
  await page.waitForURL(/\/assets\/[0-9a-f-]{36}$/);
  const repair = page.getByRole('form', { name: 'Send for repair' });
  await repair.getByLabel('Problem').fill('Screen flickers');
  await repair.getByLabel('Vendor').fill('Example Service Centre');
  await repair.getByRole('button', { name: 'Send for repair' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent for repair.' })).toBeVisible();

  await open(page, '/app/demo/assets?tab=repairs');
  const done = page.getByRole('form', { name: `Complete repair of Tab ${run}` });
  await done.getByLabel('Cost (₹)').fill('1500');
  await done.getByRole('button', { name: 'Mark repaired' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Repair complete. The asset is available again.' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Repair history' }).getByText('Screen flickers')).toBeVisible();

  await open(page, `/app/demo/assets?tab=register&q=${run}`);
  await expect(page.getByRole('table', { name: 'Asset register' }).getByText(`Tab ${run}`)).toBeVisible();
});
