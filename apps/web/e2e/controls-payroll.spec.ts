import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Kredily second pass, batch 1, on the demo tenant: directory access in Settings › Controls, the payroll access
 * shortcuts, and the new pay settings. Everything changed here is restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';
let directoryBefore: { access: string; show_birthday: boolean; show_marital_status: boolean } | null = null;
let payBefore: { pay_days_basis: string; payslip_show_paise: boolean; overtime_multiplier: number | null; show_tax_projection: boolean } | null = null;
let hrRole = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  directoryBefore = (await admin.from('directory_settings').select('access, show_birthday, show_marital_status').eq('organization_id', orgId).single()).data;
  payBefore = (await admin.from('payroll_settings').select('pay_days_basis, payslip_show_paise, overtime_multiplier, show_tax_projection').eq('organization_id', orgId).single()).data;
  hrRole = (await admin.from('roles').select('id').eq('organization_id', orgId).eq('key', 'hr_admin').single()).data!.id;
});

test.afterAll(async () => {
  if (directoryBefore) await admin.from('directory_settings').update(directoryBefore).eq('organization_id', orgId);
  if (payBefore) await admin.from('payroll_settings').update(payBefore).eq('organization_id', orgId);
  await admin.from('role_permissions').delete().eq('role_id', hrRole).eq('permission_key', 'payroll.approve');
});

test('the owner limits the directory to HR, and employees then see only themselves', async ({ page, browser }) => {
  const hrName = (await admin.from('employees').select('first_name, last_name').eq('organization_id', orgId).ilike('work_email', 'demo.hr@%').maybeSingle()).data?.first_name;
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=controls');
  const form = page.getByRole('form', { name: 'Privacy & Visibility' });
  await form.getByLabel('Who can browse the directory').selectOption('hr');
  await form.getByRole('switch', { name: 'Birthday' }).check({ force: true });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Directory visibility saved.')).toBeVisible();
  expect((await admin.from('directory_settings').select('access, show_birthday').eq('organization_id', orgId).single()).data).toEqual({ access: 'hr', show_birthday: true });

  if (hrName) {
    const ctx = await browser.newContext();
    const employee = await ctx.newPage();
    await signIn(employee, 'demo.employee');
    await open(employee, '/app/demo/employees');
    await expect(employee.getByText(hrName, { exact: true })).toHaveCount(0);
    await admin.from('directory_settings').update({ access: 'everyone' }).eq('organization_id', orgId);
    await open(employee, '/app/demo/employees');
    await expect(employee.getByText(hrName, { exact: true }).first()).toBeVisible();
    await ctx.close();
  }
});

test('the owner lets HR approve and lock payroll from Controls, then switches it off', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=controls');
  const shortcut = page.getByRole('form', { name: 'HR administrators can approve and lock payroll' });
  await shortcut.getByRole('button', { name: 'Switch on' }).click();
  await expect(shortcut.getByText('Switched on.')).toBeVisible();
  expect((await admin.from('role_permissions').select('scope').eq('role_id', hrRole).eq('permission_key', 'payroll.approve').maybeSingle()).data).toEqual({ scope: 'org' });
  await open(page, '/app/demo/settings?tab=controls');
  await page.getByRole('form', { name: 'HR administrators can approve and lock payroll' }).getByRole('button', { name: 'Switch off' }).click();
  await expect(page.getByText('Switched off.')).toBeVisible();
  expect((await admin.from('role_permissions').select('scope').eq('role_id', hrRole).eq('permission_key', 'payroll.approve')).data).toEqual([]);
});

test('payroll sets a fixed 30 pay days, whole rupees on payslips and overtime pay', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, '/app/demo/payroll?tab=settings&view=pay');
  const form = page.getByRole('form', { name: 'Pay settings' });
  await form.getByLabel('A month’s pay is spread over').selectOption('fixed_30');
  await form.getByLabel('Pay approved overtime').selectOption('2');
  await form.getByLabel('Show paise on payslips').uncheck();
  await form.getByLabel('Employees see their tax projection').uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Settings saved.')).toBeVisible();
  expect((await admin.from('payroll_settings').select('pay_days_basis, payslip_show_paise, overtime_multiplier, show_tax_projection').eq('organization_id', orgId).single()).data)
    .toEqual({ pay_days_basis: 'fixed_30', payslip_show_paise: false, overtime_multiplier: 2, show_tax_projection: false });
});

test('with the projection switched off, employees don’t see the Tax Projection Sheet', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/payslips?tab=tax');
  await expect(page.getByRole('link', { name: 'Tax Summary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tax Projection Sheet' })).toHaveCount(0);
});
