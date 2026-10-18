import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { adminClient, open, signIn } from './helpers';

/**
 * Attendance on the live demo tenant: the employee (Dev Nair) checks in from the browser and regularizes a
 * missed day, which their manager approves; HR imports a biometric export twice (the second time nothing new
 * is added) and reads the monthly summary. Everything created here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let devCode = '';

const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
/** Weekdays before yesterday, newest first (org-local). */
const pastWeekdays = (() => {
  const out: string[] = [];
  const d = new Date(`${todayIst}T00:00:00Z`);
  for (let i = 2; out.length < 4; i++) {
    const x = new Date(d.getTime() - i * 86_400_000);
    if (x.getUTCDay() !== 0 && x.getUTCDay() !== 6) out.push(x.toISOString().slice(0, 10));
  }
  return out;
})();
const [regDay, importDay] = pastWeekdays as [string, string];

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const dev = (await admin.from('employees').select('id, employee_code').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!;
  devId = dev.id;
  devCode = dev.employee_code;
});

test.afterAll(async () => {
  const { data: regs } = await admin.from('regularization_requests').select('id, approval_request_id').eq('employee_id', devId).ilike('reason', `%${run}%`);
  await admin.from('attendance_punches').delete().eq('employee_id', devId).gte('received_at', startedAt);
  if (regs?.length) {
    await admin.from('regularization_requests').update({ approval_request_id: null }).in('id', regs.map((r) => r.id));
    await admin.from('approval_requests').delete().in('id', regs.map((r) => r.approval_request_id).filter((x): x is string => !!x));
    await admin.from('regularization_requests').delete().in('id', regs.map((r) => r.id));
  }
  await admin.from('biometric_devices').delete().eq('organization_id', orgId).eq('serial_number', `E2E-${run}`);
  await admin.from('anomaly_flags').delete().eq('employee_id', devId).gte('created_at', startedAt);
  await admin.from('attendance_days').delete().eq('employee_id', devId).in('work_date', [todayIst, ...pastWeekdays]); // a cache; recomputed later
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'approval.%').gte('created_at', startedAt);
});

test('the employee checks in from the browser', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/attendance');
  const before = (await admin.from('attendance_punches').select('id').eq('employee_id', devId).gte('received_at', startedAt)).data!.length;
  await page.getByRole('button', { name: /^Check (in|out)$/ }).click();
  await expect(page.getByText(/^Punch recorded at /)).toBeVisible();
  const { data } = await admin.from('attendance_punches').select('method, source_key').eq('employee_id', devId).gte('received_at', startedAt);
  expect(data).toHaveLength(before + 1);
  expect(data!.at(-1)).toMatchObject({ method: 'web', source_key: expect.stringMatching(new RegExp(`^web:${devId}:`)) });
});

test('a missed day is regularized and the manager approves it', async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/attendance');
  const form = employee.getByRole('form', { name: 'Regularize a day' });
  await form.getByLabel('Day').fill(regDay);
  await form.getByLabel('Check-in').fill('09:30');
  await form.getByLabel('Check-out').fill('18:30');
  await form.getByLabel('Reason').fill(`Badge reader was down ${run}`);
  await form.getByRole('button', { name: 'Request regularization' }).click();
  await expect(employee.getByText('Regularization requested. Your manager has been asked to approve it.')).toBeVisible();

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/inbox');
  await manager.getByRole('form', { name: /^Decide: Dev Nair: attendance for/ }).getByRole('button', { name: 'Approve' }).click();
  await expect(manager.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();

  const day = (await admin.from('attendance_days').select('status, is_regularized, worked_minutes').eq('employee_id', devId).eq('work_date', regDay).single()).data;
  expect(day).toEqual({ status: 'present', is_regularized: true, worked_minutes: 480 });
  if (regDay.slice(0, 7) === todayIst.slice(0, 7)) {
    await open(employee, '/app/demo/attendance');
    const row = employee.getByRole('table', { name: 'Your attendance this month' }).getByRole('row').filter({ hasText: 'regularized' });
    await expect(row.getByText('Present')).toBeVisible();
  }
});

test('HR imports a biometric export; importing it again adds nothing', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/attendance/settings');
  const add = page.getByRole('form', { name: 'New device' });
  await add.getByLabel('Serial number').fill(`E2E-${run}`);
  await add.getByLabel('Name').fill(`E2E reader ${run}`);
  await add.getByRole('button', { name: 'Add device' }).click();
  await expect(page.getByText(`Device “E2E reader ${run}” added.`)).toBeVisible();

  const csv = Buffer.from(`employee_code,punched_at,record_id\r\n${devCode},${importDay} 09:28:00,${run}-1\r\n${devCode},${importDay} 18:41:00,${run}-2\r\n`);
  const importForm = page.getByRole('form', { name: 'Import device punches' });
  for (const expected of ['2 punch(es) imported, 0 already seen.', '0 punch(es) imported, 2 already seen.']) {
    await importForm.getByLabel('Device').selectOption({ label: `E2E reader ${run} (E2E-${run})` });
    await importForm.getByLabel('CSV export').setInputFiles({ name: 'device.csv', mimeType: 'text/csv', buffer: csv });
    await importForm.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText(expected)).toBeVisible();
  }
  const day = (await admin.from('attendance_days').select('status, punch_count').eq('employee_id', devId).eq('work_date', importDay).single()).data;
  expect(day).toEqual({ status: 'present', punch_count: 2 });
});

test('HR reads the monthly summary and exports it for payroll', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/attendance');
  await page.getByRole('link', { name: 'Monthly summary' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monthly attendance' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: devCode })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
  const text = (await readFile(await download.path())).toString('utf8').replace(/^\uFEFF/, '');
  expect(text.split('\r\n')[0]).toBe('Employee code,Name,Days in period,Present,Half days,Absent,Paid leave,Unpaid leave,Weekly offs,Holidays,Not marked,Late days,Payable days,LOP days');
  expect(text).toContain(`${devCode},Dev Nair,`);
});
