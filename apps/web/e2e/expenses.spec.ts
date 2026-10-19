import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Expenses on the live demo tenant: the employee (Dev Nair) files a claim with a receipt; their manager approves
 * it in the Inbox, then finance (the payroll admin); the employee sees it approved and can open the receipt.
 * Everything created here, receipts included, is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const title = `E2E client visit ${run}`;
let orgId = '';
let devId = '';
let claimUrl = '';

// A 1×1 PNG (synthetic).
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
});

test.afterAll(async () => {
  const { data: claims } = await admin.from('expense_claims').select('id, approval_request_id').eq('employee_id', devId).ilike('title', `%${run}%`);
  for (const c of claims ?? []) {
    const { data: items } = await admin.from('expense_items').select('receipt_path').eq('claim_id', c.id);
    const paths = (items ?? []).map((i) => i.receipt_path).filter((p): p is string => !!p);
    if (paths.length) await admin.storage.from('expense-receipts').remove(paths);
    await admin.from('expense_claims').update({ approval_request_id: null }).eq('id', c.id);
    if (c.approval_request_id) await admin.from('approval_requests').delete().eq('id', c.approval_request_id);
    await admin.from('expense_claims').delete().eq('id', c.id);
  }
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'approval.%').gte('created_at', startedAt);
});

test('the employee files a claim with a receipt and submits it', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/expenses');
  const start = page.getByRole('form', { name: 'New claim' });
  await start.getByLabel('What is it for?').fill(title);
  await start.getByRole('button', { name: 'Start claim' }).click();
  await page.waitForURL(/\/app\/demo\/expenses\/[0-9a-f-]{36}$/);
  claimUrl = new URL(page.url()).pathname;

  const add = page.getByRole('form', { name: 'Add an expense' });
  await add.getByLabel('Category').selectOption({ label: 'Local conveyance (no receipt needed) · up to ₹2000' });
  await add.getByLabel('Amount (₹)').fill('450');
  await add.getByLabel('Merchant').fill('City cabs');
  await add.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('list', { name: 'Expense items' }).getByText('Local conveyance · ₹450')).toBeVisible();

  await add.getByLabel('Category').selectOption({ label: 'Meals · up to ₹5000' });
  await add.getByLabel('Amount (₹)').fill('1200');
  await add.getByRole('button', { name: 'Add expense' }).click();
  await expect(add.getByText('Meals needs a receipt.')).toBeVisible();
  await add.getByLabel('Category').selectOption({ label: 'Meals · up to ₹5000' });
  await add.getByLabel('Amount (₹)').fill('1200');
  await add.getByLabel('Receipt').setInputFiles({ name: 'dinner.png', mimeType: 'image/png', buffer: png });
  await add.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('list', { name: 'Expense items' }).getByText('Meals · ₹1,200')).toBeVisible();

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('submitted', { exact: true })).toBeVisible();
});

test('the manager and then finance approve it in the Inbox', async ({ browser }) => {
  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/inbox');
  await manager.getByRole('form', { name: new RegExp(`^Decide: Dev Nair: ${title}`) }).getByRole('button', { name: 'Approve' }).click();
  await expect(manager.getByRole('status').filter({ hasText: 'Approved. It moves to the next approver.' })).toBeVisible();

  const finance = await (await browser.newContext()).newPage();
  await signIn(finance, 'demo.payroll');
  await open(finance, '/app/demo/inbox');
  await finance.getByRole('form', { name: new RegExp(`^Decide: Dev Nair: ${title}`) }).getByRole('button', { name: 'Approve' }).click();
  await expect(finance.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();

  const { data } = await admin.from('expense_claims').select('status, total').eq('employee_id', devId).eq('title', title).single();
  expect(data).toEqual({ status: 'approved', total: 1650 });
});

test('the employee sees the claim approved and can open the receipt', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, claimUrl);
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  const res = await page.request.get(`${claimUrl}/receipts/${(await admin.from('expense_items').select('id').eq('receipt_name', 'dinner.png').order('created_at', { ascending: false }).limit(1).single()).data!.id}`, { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toContain('/storage/v1/object/sign/expense-receipts/');
});
