import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { adminClient, domain, expectNotFound, open, signIn } from './helpers';

/**
 * Bulk import with a dry run, on the live demo tenant. Every employee created here has the run id in their
 * last name and is deleted afterwards (audit entries stay, by design).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let managerCode = '';
let designation = '';
let locationCode = '';

const HEADER = 'Employee code,First name,Last name,Work email,Employment type,Date of joining,Department code,Designation,Location code,Manager code';
const email = (n: string) => `e2e.import.${n}.${run.toLowerCase()}@${domain}`;

async function check(page: Page, name: string, lines: string[]) {
  const form = page.getByRole('form', { name: 'Check a file' });
  await form.getByLabel(/CSV file|Check another file/).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...lines].join('\r\n')) });
  await form.getByRole('button', { name: 'Check file' }).click();
}

const imported = async () =>
  (await admin.from('employees').select('employee_code, manager_employee_id, department_id').eq('organization_id', orgId).like('last_name', `%${run}`).order('employee_code')).data ?? [];

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  managerCode = (await admin.from('employees').select('employee_code').eq('organization_id', orgId).eq('first_name', 'Rohan').single()).data!.employee_code;
  designation = (await admin.from('designations').select('title').eq('organization_id', orgId).is('archived_at', null).limit(1).single()).data!.title;
  locationCode = (await admin.from('locations').select('code').eq('organization_id', orgId).is('archived_at', null).limit(1).single()).data!.code;
});

test.afterAll(async () => {
  // Reports before managers (manager references), then the rest.
  await admin.from('employees').update({ manager_employee_id: null }).eq('organization_id', orgId).like('last_name', `%${run}`);
  await admin.from('employment_records').update({ manager_employee_id: null }).eq('organization_id', orgId)
    .in('employee_id', (await admin.from('employees').select('id').eq('organization_id', orgId).like('last_name', `%${run}`)).data?.map((e) => e.id) ?? []);
  await admin.from('employees').delete().eq('organization_id', orgId).like('last_name', `%${run}`);
});

test('HR downloads the template', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees');
  await page.getByRole('link', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import employees' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download template' }).click()]);
  const text = (await readFile(await download.path())).toString('utf8');
  expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
    'Employee code,First name,Middle name,Last name,Work email,Work phone,Employment type,Date of joining,Probation ends,Department code,Designation,Location code,Manager code');
});

test('checking a file with problems lists each one by line and saves nothing', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/import');
  await check(page, 'bad.csv', [
    `I${run}-1,Ira,T${run},${email('a')},Permanent,2026-01-05,NOPE${run},,,`,
    `I${run}-2,Om,T${run},${email('a')},Permanent,2026-01-05,,,,`,
    `I${run}-3,Pia,T${run},,Freelance,2026-01-05,,,,`,
    `I${run}-4,Raj,T${run},,Permanent,2026-01-05,,,,GHOST${run}`,
  ]);
  const problems = page.getByRole('list', { name: 'Problems' });
  await expect(problems.getByText(`Unknown or archived department code: “NOPE${run}”.`)).toBeVisible();
  await expect(problems.getByText('Work email: also on line 2')).toBeVisible();
  await expect(problems.getByText('Employment type: Choose an employment type')).toBeVisible();
  await expect(problems.getByText(`Unknown manager code “GHOST${run}”.`)).toBeVisible();
  await expect(page.getByText(/problems? found\. Nothing has been saved/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import \d+ employee/ })).toHaveCount(0);
  expect(await imported()).toEqual([]);
});

test('a clean file is checked, then imported in one go, with managers from the file and the directory', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/import');
  await check(page, 'good.csv', [
    `I${run}-2,Om,T${run},${email('b')},contract,05/01/2026,ENG,${designation},${locationCode},I${run}-1`, // manager on a later line
    `I${run}-1,Ira,T${run},${email('a')},Permanent,2026-01-05,ENG,,,${managerCode}`,
    `I${run}-3,Pia,T${run},,Intern,2026-02-01,,,,`,
  ]);
  await expect(page.getByText('All 3 rows are ready to import. Nothing has been saved yet.')).toBeVisible();
  expect(await imported()).toEqual([]); // the check saved nothing

  await page.getByRole('button', { name: 'Import 3 employees' }).click();
  await expect(page.getByText('3 employees imported.')).toBeVisible();

  const rows = await imported();
  expect(rows.map((r) => r.employee_code)).toEqual([`I${run}-1`, `I${run}-2`, `I${run}-3`]);
  const manager = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('employee_code', managerCode).single()).data!.id;
  const ira = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('employee_code', `I${run}-1`).single()).data!.id;
  expect(rows[0]!.manager_employee_id).toBe(manager);
  expect(rows[1]!.manager_employee_id).toBe(ira);
  expect(rows[2]!.manager_employee_id).toBeNull();

  const { data: events } = await admin.from('audit_events').select('metadata').eq('organization_id', orgId).eq('action', 'import')
    .order('occurred_at', { ascending: false }).limit(1);
  expect(events?.[0]?.metadata).toEqual({ rows: 3, created: 3 });
});

test('importing the same file again is refused as a whole', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/import');
  await check(page, 'again.csv', [`I${run}-1,Ira,T${run},,Permanent,2026-01-05,,,,`]);
  await expect(page.getByRole('list', { name: 'Problems' }).getByText('This employee code is already in use.')).toBeVisible();
});

test('managers have no import', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, '/app/demo/employees');
  await expect(page.getByRole('link', { name: 'Import', exact: true })).toHaveCount(0);
  await open(page, '/app/demo/employees/import');
  await expectNotFound(page);
  expect((await page.request.get('/app/demo/employees/import/template')).status()).toBe(404);
});
