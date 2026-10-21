import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

/**
 * Vendor payouts on the demo tenant: payroll adds a vendor and records an invoice (TDS worked out), the owner
 * approves it, downloads the bank file and marks it paid; the owner gives an HR administrator vendor payout access
 * from Controls; payroll switches Dearness Allowance on. Everything created here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const vendorName = `E2E Studio ${run}`;
const admin = adminClient();
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});

test.afterAll(async () => {
  const { data: v } = await admin.from('vendors').select('id').eq('organization_id', orgId).eq('name', vendorName);
  for (const x of v ?? []) await admin.from('vendor_payments').delete().eq('vendor_id', x.id);
  await admin.from('vendors').delete().eq('organization_id', orgId).eq('name', vendorName);
  const role = (await admin.from('roles').select('id').eq('organization_id', orgId).eq('key', 'vendor_admin').single()).data!.id;
  await admin.from('member_roles').delete().eq('role_id', role);
  await admin.from('payroll_settings').update({ da_enabled: false }).eq('organization_id', orgId);
});

test('payroll adds a vendor and records an invoice; the owner approves, downloads the bank file and marks it paid', async ({ page, browser }) => {
  await signIn(page, 'demo.payroll');
  await open(page, '/app/demo/vendors?tab=vendors');
  const add = page.getByRole('form', { name: 'Add a vendor' });
  await add.getByLabel('Vendor name').fill(vendorName);
  await add.getByLabel('Type').selectOption('professional');
  await add.getByLabel('PAN').fill('ABCDE1234F');
  await add.getByLabel('Account holder').fill(vendorName);
  await add.getByLabel('Account number').fill('123456789012');
  await add.getByLabel('IFSC').fill('HDFC0001234');
  await add.getByLabel('TDS section').selectOption('194J');
  await add.getByRole('button', { name: '＋ Add vendor' }).click();
  await expect(page.getByText(`${vendorName} added.`)).toBeVisible();

  await open(page, '/app/demo/vendors?tab=payments');
  const invoice = page.getByRole('form', { name: 'Record a vendor invoice' });
  await invoice.getByLabel('Vendor').selectOption({ label: `${vendorName} · 194J 10%` });
  await invoice.getByLabel('Invoice number').fill(`INV-${run}`);
  await invoice.getByLabel('Invoice amount (₹)').fill('50000');
  await invoice.getByRole('button', { name: 'Record invoice' }).click();
  await expect(page.getByText(`Invoice INV-${run} recorded.`)).toBeVisible();
  const pay = (await admin.from('vendor_payments').select('id, tds_amount, net_amount, status').eq('organization_id', orgId).eq('invoice_number', `INV-${run}`).single()).data!;
  expect([Number(pay.tds_amount), Number(pay.net_amount), pay.status]).toEqual([5000, 45000, 'submitted']);

  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await signIn(owner, 'demo.owner');
  await open(owner, '/app/demo/vendors?tab=payments');
  const board = owner.getByRole('form', { name: 'Vendor payments' });
  await board.getByRole('checkbox', { name: `Select ${vendorName} INV-${run}` }).check();
  await board.getByRole('button', { name: /^Approve/ }).click();
  await expect(owner.getByText('Approved 1 payment.')).toBeVisible();

  await open(owner, '/app/demo/vendors?tab=payments');
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('link', { name: /Bank file/ }).click()]);
  const csv = (await readFile(await download.path())).toString('utf8');
  expect(csv).toContain(`NEFT,${vendorName},123456789012,HDFC0001234,45000.00`);

  const board2 = owner.getByRole('form', { name: 'Vendor payments' });
  await board2.getByRole('checkbox', { name: `Select ${vendorName} INV-${run}` }).check();
  await board2.getByLabel('UTR / reference').fill(`UTR${run}`);
  await board2.getByRole('button', { name: 'Mark paid' }).click();
  await expect(owner.getByText('Marked paid 1 payment.')).toBeVisible();
  expect((await admin.from('vendor_payments').select('status, reference').eq('id', pay.id).single()).data).toEqual({ status: 'paid', reference: `UTR${run}` });
  await ctx.close();
});

test('the owner gives an HR administrator vendor payout access from Controls', async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const hr = await ctx.newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/vendors');
  await expectNotFound(hr);

  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=controls');
  const panel = page.getByRole('region', { name: 'Vendor payout access for HR' });
  await panel.getByRole('listitem').filter({ hasText: 'demo.hr@' }).getByRole('button', { name: 'Give access' }).click();
  await expect(panel.getByText('Vendor payout access given.')).toBeVisible();

  await open(hr, '/app/demo/vendors');
  await expect(hr.getByRole('heading', { level: 1, name: 'Vendor payouts' })).toBeVisible();
  await ctx.close();
});

test('payroll switches Dearness Allowance on and a DA component appears', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, '/app/demo/payroll?tab=settings&view=pay');
  const form = page.getByRole('form', { name: 'Pay settings' });
  await form.getByLabel('Use Dearness Allowance (DA) in salaries').check();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Settings saved.')).toBeVisible();
  expect((await admin.from('salary_components').select('is_active, pf_wage').eq('organization_id', orgId).eq('code', 'DA').single()).data).toEqual({ is_active: true, pf_wage: true });
});
