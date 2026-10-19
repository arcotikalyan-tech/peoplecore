import { expect, type Page } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Expense Admin (Kredily) on the demo tenant. Finance sets a manager-only threshold; Dev's small claim needs only
 * the manager, who decides on the claim page; finance pays it by bank transfer from the payout queue. A claim above
 * the threshold is put on hold for information and answered. Finance adds a category with sub-categories and records
 * an expense for Dev. Settings, categories and claims created here are restored or removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let settingsBefore: { receipt_reading: boolean; multi_level: boolean; threshold: number | null; auto_finalize: boolean; finance_only: boolean; allow_skip: boolean; escalation_days: number } | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  settingsBefore = (await admin.from('expense_settings').select('receipt_reading, multi_level, threshold, auto_finalize, finance_only, allow_skip, escalation_days').eq('organization_id', orgId).single()).data;
});

test.afterAll(async () => {
  if (settingsBefore) await admin.from('expense_settings').update(settingsBefore).eq('organization_id', orgId);
  const { data: claims } = await admin.from('expense_claims').select('id, approval_request_id').eq('organization_id', orgId).or(`title.ilike.%${run}%`);
  for (const c of claims ?? []) {
    if (c.approval_request_id) await admin.from('approval_requests').delete().eq('id', c.approval_request_id);
    await admin.from('expense_claims').delete().eq('id', c.id);
  }
  await admin.from('expense_categories').delete().eq('organization_id', orgId).ilike('name', `%${run}%`);
  await admin.from('notifications').delete().eq('organization_id', orgId).or('kind.like.approval.%,kind.like.expense.%').gte('created_at', startedAt);
});

async function fileClaim(page: Page, title: string, amount: string) {
  await open(page, '/app/demo/expenses');
  const start = page.getByRole('form', { name: 'New claim' });
  await start.getByLabel('What is it for?').fill(title);
  await start.getByRole('button', { name: 'Start claim' }).click();
  const add = page.getByRole('form', { name: 'Add an expense' });
  await add.getByLabel('Category').selectOption({ label: 'Local conveyance (no receipt needed) · up to ₹2000' });
  await add.getByLabel('Amount (₹)').fill(amount);
  await add.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('list', { name: 'Expense items' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  return page.url();
}

test('finance sets a threshold; a small claim needs only the manager; finance pays it by bank transfer', async ({ page, browser }) => {
  const fin = await (await browser.newContext()).newPage();
  await signIn(fin, 'demo.payroll');
  await open(fin, '/app/demo/expenses?tab=settings');
  await expect(fin.getByRole('heading', { level: 1, name: 'Expense Admin' })).toBeVisible();
  const settings = fin.getByRole('form', { name: 'Expense settings' });
  await settings.getByLabel('Approval threshold (₹)').fill('1000');
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings.getByText('Expense settings saved.', { exact: false })).toBeVisible();

  await signIn(page, 'demo.employee');
  const url = await fileClaim(page, `E2E cab ${run}`, '450');
  await expect(page.getByText('Submitted. Your manager approves it.')).toBeVisible();

  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'demo.manager');
  await open(mgr, new URL(url).pathname);
  const decision = mgr.getByRole('region', { name: 'Your decision' });
  await decision.getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText('Claim approved.')).toBeVisible();
  await expect(mgr.getByText('It is paid with the next payroll unless finance pays it sooner.', { exact: false })).toBeVisible();

  await open(fin, '/app/demo/expenses?tab=reimbursement');
  const queue = fin.getByRole('table', { name: 'Payout queue' });
  await queue.getByRole('checkbox', { name: /Select Dev Nair ₹450/ }).check();
  const pay = fin.getByRole('form', { name: 'Pay selected claims' });
  await pay.getByLabel('Bank reference').fill(`UTR${run}`);
  await pay.getByRole('button', { name: 'Mark selected as paid' }).click();
  await expect(fin.getByText('Marked 1 claim as paid.')).toBeVisible();

  await open(page, new URL(url).pathname);
  await expect(page.getByText(`By bank transfer (reference UTR${run}).`)).toBeVisible();
});

test('an approver puts a larger claim on hold; the employee answers', async ({ page, browser }) => {
  await signIn(page, 'demo.employee');
  const url = await fileClaim(page, `E2E airport cab ${run}`, '1500');
  await expect(page.getByText('Submitted. Your manager approves first, then finance.')).toBeVisible();

  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'demo.manager');
  await open(mgr, '/app/demo/expenses?tab=approvals');
  await expect(mgr.getByRole('form', { name: new RegExp(`Decide: Dev Nair: E2E airport cab ${run}`) })).toBeVisible();
  await open(mgr, new URL(url).pathname);
  const hold = mgr.getByRole('form', { name: 'Put on hold' });
  await hold.getByLabel('Need more information?').fill('Which flight was this for?');
  await hold.getByRole('button', { name: '⏸ Put on hold' }).click();
  await expect(mgr.getByText('On hold. The employee has been asked for the information.')).toBeVisible();

  await open(page, new URL(url).pathname);
  await expect(page.getByText('Which flight was this for?')).toBeVisible();
  const answer = page.getByRole('form', { name: 'Answer' });
  await answer.getByLabel('Your answer').fill(`The ${run} client trip`);
  await answer.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.getByText(`The ${run} client trip`)).toBeVisible();
});

test('finance adds a category with sub-categories and records an expense for an employee', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, '/app/demo/expenses?tab=categories');
  const add = page.getByRole('form', { name: 'Add category' });
  await add.getByLabel('Category').fill(`Internet ${run}`);
  await add.getByLabel('Code').fill(`NET${run}`);
  await add.getByLabel('Sub-categories (comma-separated)').fill('Broadband, Mobile data');
  await add.getByRole('button', { name: '＋ Add category' }).click();
  await expect(page.getByRole('list', { name: 'Categories' }).getByText(`Internet ${run}`)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Categories' }).getByText('Mobile data')).toBeVisible();

  await open(page, '/app/demo/expenses?tab=reimbursement');
  const rec = page.getByRole('form', { name: 'Add expense' });
  const devOption = await rec.getByLabel('Employee').locator('option', { hasText: 'Dev Nair' }).getAttribute('value');
  await rec.getByLabel('Employee').selectOption(devOption!);
  await rec.getByLabel('Category').selectOption({ label: `Internet ${run}` });
  await rec.getByLabel('Sub-category').selectOption('Broadband');
  await rec.getByLabel('Amount (₹)').fill('799');
  await rec.getByLabel('Merchant').fill(`Example ISP ${run}`);
  await rec.getByRole('button', { name: '＋ Add Expense' }).click();
  await expect(rec.getByText('Expense added. It is approved and ready to pay.')).toBeVisible();

  await open(page, `/app/demo/expenses?tab=claims&q=${run}&state=approved`);
  await expect(page.getByRole('table', { name: 'All claims' }).getByText(`Example ISP ${run}`, { exact: false })).toBeVisible();
});
