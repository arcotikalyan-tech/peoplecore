import { expect } from '@playwright/test';
import { textPdf } from '@peoplecore/ai';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Document reading and drafting on the demo tenant, answered by the test provider (dev server started with
 * AI_PROVIDER=mock, which reads labelled lines from the generated PDFs). HR reads a resume into the candidate
 * form and adds the candidate; HR drafts a job description and saves it; the employee reads a receipt into an
 * expense. Each suggestion ends up accepted only because a person submitted the normal form.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const admin = adminClient();
const startedAt = new Date().toISOString();
const email = `asha.${run}@example.test`;
let orgId = '';
let reqId = '';
let before: { enabled: boolean; monthly_token_budget: number; hourly_limit_per_user: number } | null = null;

const suggestions = async (agent: string) =>
  (await admin.from('ai_suggestions').select('status, payload').eq('organization_id', orgId).eq('agent', agent).gte('created_at', startedAt)).data ?? [];

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  before = (await admin.from('ai_settings').select('enabled, monthly_token_budget, hourly_limit_per_user').eq('organization_id', orgId).maybeSingle()).data;
  await admin.from('ai_settings').upsert({ organization_id: orgId, enabled: true, monthly_token_budget: 2_000_000, hourly_limit_per_user: 30 }, { onConflict: 'organization_id' });
  reqId = (await admin.from('job_requisitions').insert({ organization_id: orgId, code: `AI-${run}`, title: `Data Analyst ${run}`, description: 'SQL and dashboards for the sales team.' })
    .select('id').single()).data!.id;
});

test.afterAll(async () => {
  await admin.from('candidates').delete().eq('organization_id', orgId).eq('email', email);
  await admin.from('job_requisitions').delete().eq('id', reqId);
  const { data: claims } = await admin.from('expense_claims').select('id').eq('organization_id', orgId).ilike('title', `%${run}%`);
  for (const c of claims ?? []) {
    await admin.from('expense_items').delete().eq('claim_id', c.id);
    await admin.from('expense_claims').delete().eq('id', c.id);
  }
  await admin.from('ai_runs').delete().eq('organization_id', orgId).gte('created_at', startedAt);
  if (before) await admin.from('ai_settings').update(before).eq('organization_id', orgId);
  else await admin.from('ai_settings').delete().eq('organization_id', orgId);
});

test('HR reads a resume into the candidate form, checks it and adds the candidate', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/recruitment/${reqId}`);
  const reader = page.getByRole('form', { name: 'Read a resume' });
  await reader.getByLabel('Read a resume with AI').setInputFiles({
    name: 'asha.pdf', mimeType: 'application/pdf',
    buffer: textPdf(['Name: Asha Verma', 'Title: Data Analyst', 'Company: Acme Analytics', `Email: ${email}`, 'Phone: +91 98450 12345', 'Gender: Female']),
  });
  await reader.getByRole('button', { name: 'Read resume' }).click();
  const read = page.getByRole('region', { name: 'Read from the resume' });
  await expect(read.getByText(email)).toBeVisible();
  await expect(read).not.toContainText('Female'); // protected attributes are never returned
  await read.getByRole('button', { name: 'Fill in the form' }).click();

  const add = page.getByRole('form', { name: 'Add candidate' });
  await expect(add.getByLabel('Email')).toHaveValue(email);
  await expect(add.getByLabel('Phone')).toHaveValue('+919845012345');
  await expect(add.getByLabel('Current company')).toHaveValue('Acme Analytics');
  await add.getByLabel('The candidate agreed').check();
  await add.getByRole('button', { name: 'Add candidate' }).click();
  await expect(add.getByText('Asha added to the pipeline.')).toBeVisible();

  const cand = (await admin.from('candidates').select('first_name, last_name, phone, current_company').eq('organization_id', orgId).eq('email', email).single()).data;
  expect(cand).toEqual({ first_name: 'Asha', last_name: 'Verma', phone: '+919845012345', current_company: 'Acme Analytics' });
  expect((await suggestions('resume_extraction')).map((s) => s.status)).toEqual(['accepted']);
});

test('HR drafts a job description with AI, edits it and saves', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/recruitment/${reqId}`);
  await page.getByRole('form', { name: 'Draft a description' }).getByRole('button', { name: 'Draft with AI' }).click();
  const draft = page.getByRole('region', { name: 'Draft description' });
  await expect(draft).toContainText('What you\'ll do');
  await draft.getByRole('button', { name: 'Use this draft' }).click();
  const editor = page.getByRole('form', { name: 'Job description' });
  const box = editor.getByLabel('Description');
  await expect(box).toHaveValue(/^As our Data Analyst/);
  await box.fill(`${await box.inputValue()}\n\nHybrid: two days a week in the office.`);
  await editor.getByRole('button', { name: 'Save description' }).click();
  await expect(editor.getByText('Description saved.')).toBeVisible();

  const saved = (await admin.from('job_requisitions').select('description').eq('id', reqId).single()).data!.description;
  expect(saved).toMatch(/^As our Data Analyst[\s\S]*Hybrid: two days a week in the office\.$/);
  expect((await suggestions('job_description')).map((s) => s.status)).toEqual(['edited']);
});

test('the employee reads a receipt into an expense and adds it', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/expenses');
  const start = page.getByRole('form', { name: 'New claim' });
  await start.getByLabel('What is it for?').fill(`Team lunch ${run}`);
  await start.getByRole('button', { name: 'Start claim' }).click();
  await page.waitForURL(/\/app\/demo\/expenses\/[0-9a-f-]{36}$/);

  const add = page.getByRole('form', { name: 'Add an expense' });
  await add.getByLabel('Receipt').setInputFiles({
    name: 'lunch.pdf', mimeType: 'application/pdf',
    buffer: textPdf(['Merchant: Cafe Coffee Day', 'Date: 2026-10-12', 'Category: Meals', '2 x Sandwich  Rs 1,180.00', 'GST 5%  Rs 59.00', 'Total: Rs 1,239.00']),
  });
  await add.getByRole('button', { name: 'Read the receipt with AI' }).click();
  const read = page.getByRole('region', { name: 'Read from the receipt' });
  await expect(read).toContainText('Cafe Coffee Day');
  await read.getByRole('button', { name: 'Fill in the form' }).click();
  await expect(add.getByLabel('Amount (₹)')).toHaveValue('1239');
  await expect(add.getByLabel('Date')).toHaveValue('2026-10-12');
  await expect(add.getByLabel('Merchant')).toHaveValue('Cafe Coffee Day');
  await add.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('list', { name: 'Expense items' }).getByText('Meals · ₹1,239')).toBeVisible();

  expect((await suggestions('receipt_extraction')).map((s) => s.status)).toEqual(['accepted']);
});
