import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Loans on the demo tenant: Dev (given a salary for the test) checks eligibility, simulates and applies; his
 * manager and then payroll approve; payroll disburses by bank and the schedule appears in Dev's statement;
 * payroll forecloses it. The salary, loan, approvals and adjustments are removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let salaryId: string | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  const existing = (await admin.from('compensation_records').select('id').eq('employee_id', devId).is('effective_to', null)).data ?? [];
  if (existing.length === 0) {
    const comps = (await admin.from('salary_components').select('id, code').eq('organization_id', orgId).in('code', ['BASIC', 'HRA', 'SPECIAL'])).data!;
    const rec = (await admin.from('compensation_records').insert({ organization_id: orgId, employee_id: devId, effective_from: '2025-10-01', annual_ctc: 720000, note: `E2E loans ${run}` }).select('id').single()).data!;
    salaryId = rec.id;
    const amount: Record<string, number> = { BASIC: 30000, HRA: 12000, SPECIAL: 18000 };
    await admin.from('compensation_lines').insert(comps.map((c) => ({ organization_id: orgId, record_id: rec.id, component_id: c.id, monthly_amount: amount[c.code]! })));
  }
});

test.afterAll(async () => {
  const loans = (await admin.from('loans').select('id, approval_request_id').eq('organization_id', orgId).like('purpose', `%${run}%`)).data ?? [];
  for (const l of loans) {
    await admin.from('payroll_adjustments').delete().eq('organization_id', orgId).in('code', ['LOAN_EMI', 'LOAN_DISBURSAL']).like('reason', `%${l.id.slice(0, 8)}%`).is('applied_run_id', null);
    await admin.from('loans').delete().eq('id', l.id);
    if (l.approval_request_id) await admin.from('approval_requests').delete().eq('id', l.approval_request_id);
  }
  if (salaryId) await admin.from('compensation_records').delete().eq('id', salaryId);
  await admin.from('notifications').delete().eq('organization_id', orgId).or('kind.like.approval.%,kind.like.loan.%').gte('created_at', startedAt);
});

test('an employee simulates and applies; the manager and payroll approve; payroll disburses and forecloses', async ({ page, browser }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/loans?tab=simulator');
  await expect(page.getByRole('heading', { level: 1, name: 'My Loans' })).toBeVisible();
  await expect(page.getByText('✓ You can apply')).toBeVisible();
  await expect(page.getByLabel('Loan figures').first()).toBeVisible();
  await page.getByRole('link', { name: 'Apply with these →' }).click();

  const form = page.getByRole('form', { name: 'Apply for a loan' });
  await form.getByLabel('Amount (₹)').fill('20000');
  await form.getByLabel('Tenure (months)').fill('4');
  await expect(form.getByText('₹5,000.00')).toBeVisible(); // EMI preview (interest-free by default)
  await form.getByLabel('Purpose').fill(`Laptop repair ${run}`);
  await form.getByRole('button', { name: 'Apply' }).click();
  await page.waitForURL(/\/loans\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({ hasText: 'Application sent. Your manager approves first, then payroll.' })).toBeVisible();
  const loanPath = new URL(page.url()).pathname;

  const mgr = await (await browser.newContext()).newPage();
  await signIn(mgr, 'demo.manager');
  await open(mgr, loanPath);
  await mgr.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByRole('status').filter({ hasText: 'Approved. It moves to the next approver.' })).toBeVisible();

  const pay = await (await browser.newContext()).newPage();
  await signIn(pay, 'demo.payroll');
  await open(pay, '/app/demo/loans?tab=approvals');
  await expect(pay.getByRole('heading', { level: 1, name: 'Loans & Advances' })).toBeVisible();
  await open(pay, loanPath);
  await pay.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: 'Approve' }).click();
  await expect(pay.getByRole('status').filter({ hasText: 'Approved. Payroll can disburse it now.' })).toBeVisible();
  const disburse = pay.getByRole('form', { name: 'Disburse loan' });
  await disburse.getByLabel('Bank reference').fill(`UTR${run}`);
  await disburse.getByRole('button', { name: 'Disburse' }).click();
  await expect(pay.getByRole('status').filter({ hasText: 'Disbursed. EMIs are scheduled and deducted through payroll.' })).toBeVisible();
  await expect(pay.getByRole('table', { name: 'Repayment schedule' }).getByRole('row')).toHaveCount(5);

  await open(page, '/app/demo/loans?tab=statements');
  await expect(page.getByRole('table', { name: 'Repayment schedule' }).getByText('5,000.00').first()).toBeVisible();

  await open(pay, loanPath);
  const close = pay.getByRole('form', { name: 'Foreclose loan' });
  await close.getByLabel('How was the balance settled?').fill(`Repaid by transfer ${run}`);
  await close.getByRole('button', { name: 'Close the loan' }).click();
  await expect(pay.getByRole('status').filter({ hasText: 'Loan closed. ₹20,000 of principal was settled outside payroll.' })).toBeVisible();
  await open(pay, '/app/demo/loans?tab=tracker&status=closed');
  await expect(pay.getByRole('table', { name: 'Loans' }).getByRole('row').filter({ hasText: 'Dev Nair' }).first()).toBeVisible();
});
