import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { adminClient, domain, expectNotFound, open, signIn, test } from './helpers';

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

/** Upload, keep the suggested column mapping, check. */
async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const form = page.getByRole('form', { name: 'Upload a file' });
  await form.getByLabel(/CSV or Excel file|Start again with another file/).setInputFiles(file);
  await form.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('form', { name: 'Map columns' })).toBeVisible();
}
async function check(page: Page, name: string, lines: string[]) {
  await upload(page, { name, mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...lines].join('\r\n')) });
  await page.getByRole('form', { name: 'Map columns' }).getByRole('button', { name: 'Check rows' }).click();
}

/** A one-sheet .xlsx with inline strings (stored, not compressed): enough for the importer's reader. */
function xlsx(rows: string[][]): Buffer {
  const cell = (v: string, c: number, r: number) => `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`;
  const parts: Record<string, string> = {
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Employees" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, c, r + 1)).join('')}</row>`).join('')}</sheetData></worksheet>`,
  };
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const data = Buffer.from(text);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(n.length, 28); head.writeUInt32LE(offset, 42);
    chunks.push(local, n, data);
    central.push(head, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
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
    `I${run}-3,Pia,T${run},,Volunteer,2026-01-05,,,,`,
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
  await expect(page.getByText('3 employees imported from good.csv.')).toBeVisible();

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

test('a greytHR export in Excel is mapped by itself, with department and manager names turned into codes', async ({ page }) => {
  const rohan = (await admin.from('employees').select('id, first_name, last_name').eq('organization_id', orgId).eq('employee_code', managerCode).single()).data!;
  const dept = (await admin.from('departments').select('name').eq('organization_id', orgId).eq('code', 'ENG').single()).data!.name;
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/import');
  await upload(page, { name: 'greythr.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx([
    ['Employee No', 'Name', 'DOJ', 'Department', 'Email', 'Category', 'Reporting Manager', 'Blood Group'],
    [`I${run}-7`, `Kavya T${run}`, '05-Jan-2026', dept, email('g'), 'Full Time', `${rohan.first_name} ${rohan.last_name} (${managerCode})`, 'O+'],
  ]) });
  const map = page.getByRole('form', { name: 'Map columns' });
  await expect(map.getByText('looks like a greytHR file')).toBeVisible();
  await expect(map.getByLabel('Name imports as')).toHaveValue('full_name');
  await expect(map.getByLabel('Blood Group imports as')).toHaveValue('');
  await map.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.getByText('All 1 rows are ready to import. Nothing has been saved yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 employee' }).click();
  await expect(page.getByText('1 employee imported from greythr.xlsx.')).toBeVisible();
  const kavya = (await admin.from('employees').select('first_name, last_name, date_of_joining, employment_type, manager_employee_id, department_id')
    .eq('organization_id', orgId).eq('employee_code', `I${run}-7`).single()).data!;
  const eng = (await admin.from('departments').select('id').eq('organization_id', orgId).eq('code', 'ENG').single()).data!.id;
  expect(kavya).toEqual({ first_name: 'Kavya', last_name: `T${run}`, date_of_joining: '2026-01-05', employment_type: 'permanent', manager_employee_id: rohan.id, department_id: eng });
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
