import { expect, test, type Page } from '@playwright/test';
import { adminClient, domain, expectNotFound, open, signIn } from './helpers';

/**
 * The hire journey on the live demo tenant: requisition → candidate → offer → employee (pre-joining),
 * with one employee per hire, candidate deduplication, consent, erasure and scoped visibility. Everything
 * created here carries the run id and is deleted afterwards (audit entries stay, by design).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const title = `E2E Engineer ${run}`;
const candidateEmail = `e2e.cand.${run.toLowerCase()}@${domain}`;
const admin = adminClient();
let orgId = '';
let managerLabel = '';
let requisitionUrl = '';

const joiningDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const addForm = (page: Page) => page.getByRole('form', { name: 'Add candidate' });

async function addCandidate(page: Page, first: string, email: string, consent: boolean) {
  const form = addForm(page);
  await form.getByLabel('First name').fill(first);
  await form.getByLabel('Last name').fill(`Test${run}`);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Source').selectOption('referral');
  if (consent) await form.getByRole('checkbox', { name: /agreed to us storing/ }).check();
  await form.getByRole('button', { name: 'Add candidate' }).click();
}

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const rohan = (await admin.from('employees').select('employee_code').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single()).data!;
  managerLabel = `Rohan Iyer (${rohan.employee_code})`;
});

test.afterAll(async () => {
  const reqs = (await admin.from('job_requisitions').select('id').eq('organization_id', orgId).like('title', `%${run}`)).data ?? [];
  const apps = reqs.length ? (await admin.from('applications').select('id, candidate_id, converted_employee_id').in('requisition_id', reqs.map((r) => r.id))).data ?? [] : [];
  if (apps.length) await admin.from('applications').delete().in('id', apps.map((a) => a.id));
  await admin.from('candidates').delete().eq('organization_id', orgId).like('last_name', `%${run}`);
  if (reqs.length) await admin.from('job_requisitions').delete().in('id', reqs.map((r) => r.id));
  const hired = apps.map((a) => a.converted_employee_id).filter((x): x is string => !!x);
  if (hired.length) await admin.from('employees').delete().in('id', hired);
});

test('HR opens a requisition with a hiring manager', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/recruitment');
  const form = page.getByRole('form', { name: 'New requisition' });
  await form.getByLabel('Job title').fill(title);
  await form.getByLabel('Department').selectOption({ label: 'Engineering (ENG)' });
  await form.getByLabel('Hiring manager').selectOption({ label: managerLabel });
  await form.getByRole('button', { name: 'Create requisition' }).click();
  await page.waitForURL(/\/app\/demo\/recruitment\/[0-9a-f-]{36}$/);
  requisitionUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText(/^REQ\d{5} · Permanent · 1 opening$/)).toBeVisible();
});

test('candidates need consent, are not duplicated, and can be erased', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, requisitionUrl);

  await addCandidate(page, 'Kavya', candidateEmail, false);
  await expect(addForm(page).getByText('The candidate must agree before their details are stored')).toBeVisible();
  await addCandidate(page, 'Kavya', candidateEmail, true);
  await expect(page.getByText('Kavya added to the pipeline.')).toBeVisible();
  await addCandidate(page, 'Kavya', candidateEmail.toUpperCase(), true);
  await expect(page.getByText('This candidate has already applied for this requisition.')).toBeVisible();
  expect((await admin.from('candidates').select('id').eq('organization_id', orgId).ilike('email', candidateEmail)).data).toHaveLength(1);

  const eraseEmail = `e2e.erase.${run.toLowerCase()}@${domain}`;
  await addCandidate(page, 'Esha', eraseEmail, true);
  await expect(page.getByText('Esha added to the pipeline.')).toBeVisible();
  // The erase form sits in a collapsed <details>; open it from Esha's card first (hidden forms have no role).
  await page.getByRole('listitem').filter({ hasText: `Esha Test${run}` }).getByText('Erase candidate').click();
  const erase = page.getByRole('form', { name: `Erase Esha Test${run}` });
  await erase.getByRole('checkbox').check();
  await erase.getByRole('button', { name: 'Erase permanently' }).click();
  await expect(page.getByText(`Esha Test${run}`)).toHaveCount(0);
  expect((await admin.from('candidates').select('id').eq('organization_id', orgId).eq('email', eraseEmail)).data).toEqual([]);
});

test('HR moves the candidate to Offer and hires them: one pre-joining employee, requisition filled', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, requisitionUrl);
  const name = `Kavya Test${run}`;
  const move = page.getByRole('form', { name: `Move ${name}` });
  await move.getByLabel('Stage').selectOption('offer');
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('list', { name: 'Offer' }).getByText(name)).toBeVisible();

  const hire = page.getByRole('form', { name: `Hire ${name}` });
  await hire.getByLabel('Date of joining').fill(joiningDate);
  await hire.getByLabel('Work email').fill(`e2e.hire.${run.toLowerCase()}@${domain}`);
  await hire.getByRole('button', { name: 'Hire and create employee' }).click();
  await page.waitForURL(/\/app\/demo\/employees\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Pre-joining')).toBeVisible();

  const req = (await admin.from('job_requisitions').select('id, status').eq('organization_id', orgId).eq('title', title).single()).data!;
  expect(req.status).toBe('closed');
  const apps = (await admin.from('applications').select('stage, converted_employee_id').eq('requisition_id', req.id)).data!;
  expect(apps).toHaveLength(1);
  expect(apps[0]!.stage).toBe('hired');
  const employees = (await admin.from('employees').select('id, status, department_id').eq('organization_id', orgId).eq('last_name', `Test${run}`)).data!;
  expect(employees).toEqual([{ id: apps[0]!.converted_employee_id, status: 'pre_joining', department_id: expect.any(String) }]);
});

test('the hiring manager sees the requisition read-only; employees see no recruitment', async ({ browser }) => {
  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/recruitment');
  await manager.getByRole('link', { name: title }).click();
  await expect(manager.getByRole('list', { name: 'Hired' }).getByText(`Kavya Test${run}`)).toBeVisible();
  await expect(manager.getByRole('form', { name: 'Add candidate' })).toHaveCount(0);
  await expect(manager.getByRole('form', { name: 'New requisition' })).toHaveCount(0);

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo');
  await expect(employee.getByRole('link', { name: 'Recruitment' })).toHaveCount(0);
  await open(employee, requisitionUrl);
  await expectNotFound(employee);
});
