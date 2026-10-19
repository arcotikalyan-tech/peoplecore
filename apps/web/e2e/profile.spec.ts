import { expect, type Page } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * My Profile (Kredily's profile tabs) on the demo tenant: the employee reaches their profile from the menu, adds
 * education and family, uploads an ID that proves their date of birth; HR verifies it. Work, team, work week,
 * attendance, leave, payroll, file manager and e-exit render for the employee. Everything added is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const BUCKET = 'employee-documents';
const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% E2E ${run}\n`);
let devId = '';

const section = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test.beforeAll(async () => {
  const orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
});

test.afterAll(async () => {
  if (!devId) return;
  await admin.from('employee_qualifications').delete().eq('employee_id', devId).ilike('institution', `%${run}%`);
  await admin.from('employee_family_members').delete().eq('employee_id', devId).ilike('name', `%${run}%`);
  const docs = (await admin.from('employee_documents').select('id, storage_path').eq('employee_id', devId).ilike('title', `%${run}%`)).data ?? [];
  if (docs.length) {
    await admin.storage.from(BUCKET).remove(docs.map((d) => d.storage_path));
    await admin.from('employee_documents').delete().in('id', docs.map((d) => d.id));
  }
});

test('the employee opens My Profile and fills in education, family and an ID proof', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await page.getByRole('link', { name: 'My Profile' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dev Nair' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Profile sections' });
  for (const t of ['Stationery', 'Personal', 'Work', 'Team', 'Education', 'Family', 'Documents', 'Work Week', 'Attendance', 'Leave', 'Payroll', 'Expense', 'PMS', 'File Manager', 'E-Exit']) {
    await expect(tabs.getByRole('link', { name: t, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('figure', { name: /Profile \d+% complete/ })).toBeVisible();

  await tabs.getByRole('link', { name: 'Education', exact: true }).click();
  const q = page.getByRole('form', { name: 'Add qualification' });
  await q.getByLabel('Level').selectOption('bachelors');
  await q.getByLabel('Degree').fill('B.Tech');
  await q.getByLabel('Institution').fill(`Example Institute ${run}`);
  await q.getByLabel('From (year)').fill('2016');
  await q.getByLabel('To (year)').fill('2015');
  await q.getByRole('button', { name: '⊕ Add qualification' }).click();
  await expect(q.getByText('Ends before it starts')).toBeVisible();
  await q.getByLabel('To (year)').fill('2020');
  await q.getByRole('button', { name: '⊕ Add qualification' }).click();
  await expect(page.getByRole('list', { name: 'Qualifications' }).getByText(`Example Institute ${run}`)).toBeVisible();

  await open(page, `/app/demo/employees/${devId}?tab=family`);
  const f = page.getByRole('form', { name: 'Add family member' });
  await f.getByLabel('Full name').fill(`Demo Parent ${run}`);
  await f.getByLabel('Relation').selectOption('mother');
  await f.getByLabel('Dependent').selectOption('yes');
  await f.getByRole('button', { name: '⊕ Add family member' }).click();
  await expect(page.getByRole('table', { name: 'Family members' }).getByText(`Demo Parent ${run}`)).toBeVisible();

  await open(page, `/app/demo/employees/${devId}?tab=documents`);
  const up = page.getByRole('form', { name: 'Upload a document' });
  await up.getByLabel('Category').selectOption('identity');
  await up.getByLabel('Title').fill(`Passport ${run}`);
  await up.getByLabel('File').setInputFiles({ name: 'passport.pdf', mimeType: 'application/pdf', buffer: pdf });
  await up.getByLabel('Date of Birth').check();
  await up.getByLabel('Photo ID').check();
  await up.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(`“Passport ${run}” uploaded.`)).toBeVisible();
  await page.reload();
  const coverage = page.getByRole('list', { name: 'Proof coverage' });
  await expect(coverage.getByText(`✓ Passport ${run}`).first()).toBeVisible();
  await expect(page.getByText('Pending verification').first()).toBeVisible();
  // Employees can't verify their own documents.
  await expect(page.getByRole('button', { name: `✓ Verify Passport ${run}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Verify Passport ${run}` })).toHaveCount(0);
});

test('HR verifies the ID; the employee’s other tabs render', async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const hr = await ctx.newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, `/app/demo/employees/${devId}?tab=documents`);
  await hr.getByRole('button', { name: `Verify Passport ${run}` }).click();
  await expect(hr.getByRole('button', { name: `Unverify Passport ${run}` })).toBeVisible();
  const doc = (await admin.from('employee_documents').select('proves, verified_at').eq('employee_id', devId).ilike('title', `Passport ${run}`).single()).data!;
  expect(doc.proves).toEqual(['date_of_birth', 'photo_id']);
  expect(doc.verified_at).not.toBeNull();
  await ctx.close();

  await signIn(page, 'demo.employee');
  const url = (tab: string, extra = '') => `/app/demo/employees/${devId}?tab=${tab}${extra}`;
  await open(page, url('work'));
  await expect(section(page, 'Basic Info')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tenure' })).toBeVisible();
  await open(page, url('team'));
  await expect(page.getByRole('list', { name: 'Reporting line' }).getByText('YOU')).toBeVisible();
  await open(page, url('workweek'));
  await expect(page.getByRole('table', { name: 'Work week' }).or(page.getByText('No work week rule applies yet'))).toBeVisible();
  await open(page, url('attendance'));
  await expect(page.getByRole('list', { name: 'Attendance calendar' })).toBeVisible();
  await open(page, url('attendance', '&view=rule'));
  await expect(page.getByText('Read-only view.', { exact: false })).toBeVisible();
  await open(page, url('leave'));
  await expect(page.getByRole('list', { name: 'Leave balances' })).toBeVisible();
  await open(page, url('payroll'));
  await expect(page.getByRole('navigation', { name: 'Payroll sections' })).toBeVisible();
  await open(page, url('files'));
  await expect(section(page, 'File Manager')).toBeVisible();
  await open(page, url('exit'));
  await expect(page.getByRole('heading', { name: /Apply for Resignation|Exit in progress/ })).toBeVisible();
});
