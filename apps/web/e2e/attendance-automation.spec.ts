import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Attendance rules and automation (Kredily second pass, batch 2) on the demo tenant: HR sets the default rule's
 * penalties with a leave order, switches to rotational shifts, draws a polygon zone and tests punches against it,
 * saves a view of the logs and reverts penalties in bulk; the employee (Dev Nair) regularizes two days at once.
 * Everything created or changed here is put back afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const zoneName = `E2E Yard ${run}`;
const viewName = `E2E view ${run}`;
let orgId = '';
let devId = '';
let ruleId = '';
let rule: { penalties_enabled: boolean; late_marks_allowed: number | null; late_interval: number; late_method: string; late_penalty_days: number; penalty_leave_order: string[] } | null = null;

const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const prevMonth = (() => {
  const d = new Date(`${todayIst.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();
/** Two weekdays early last month, for the bulk regularization. */
const regDays = (() => {
  const out: string[] = [];
  for (let day = 3; out.length < 2; day++) {
    const x = new Date(`${prevMonth}-${String(day).padStart(2, '0')}T00:00:00Z`);
    if (x.getUTCDay() !== 0 && x.getUTCDay() !== 6) out.push(x.toISOString().slice(0, 10));
  }
  return out;
})();

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  const r = (await admin.from('shifts').select('id, penalties_enabled, late_marks_allowed, late_interval, late_method, late_penalty_days, penalty_leave_order')
    .eq('organization_id', orgId).eq('is_default', true).single()).data!;
  const { id, ...rest } = r;
  ruleId = id;
  rule = rest;
});

test.afterAll(async () => {
  if (rule) await admin.from('shifts').update(rule).eq('id', ruleId);
  await admin.from('geofences').delete().eq('organization_id', orgId).eq('name', zoneName);
  await admin.from('saved_views').delete().eq('organization_id', orgId).eq('name', viewName);
  await admin.from('attendance_penalties').delete().eq('organization_id', orgId).like('detail', `%E2E ${run}%`);
  const { data: regs } = await admin.from('regularization_requests').select('id, approval_request_id').eq('employee_id', devId).ilike('reason', `%${run}%`);
  if (regs?.length) {
    await admin.from('regularization_requests').update({ approval_request_id: null }).in('id', regs.map((x) => x.id));
    await admin.from('approval_requests').delete().in('id', regs.map((x) => x.approval_request_id).filter((x): x is string => !!x));
    await admin.from('regularization_requests').delete().in('id', regs.map((x) => x.id));
  }
  await admin.from('attendance_days').delete().eq('employee_id', devId).in('work_date', regDays); // a cache; recomputed when needed
});

test('HR sets the default rule’s penalties with a leave order, and sees what they mean', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/attendance?tab=rules');
  const editor = page.getByRole('form', { name: 'Edit rule General shift' });
  await editor.getByRole('tab', { name: 'Penalties' }).click();
  await editor.getByLabel('Penalty rules').check();
  const late = editor.getByRole('group', { name: 'Late coming' });
  await late.getByLabel('Allowed per cycle').fill('2');
  await late.getByLabel('Then one per').fill('3');
  await late.getByLabel('Deduction').selectOption('half_day');
  await editor.getByLabel('Deduct from first').selectOption({ label: 'Casual leave' });
  await expect(late.getByText('2 late arrivals allowed per cycle; then half a day for every 3 more, from Casual leave → loss of pay.')).toBeVisible();
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Rule “General shift” saved.')).toBeVisible();
  const cl = (await admin.from('leave_types').select('id').eq('organization_id', orgId).eq('code', 'CL').single()).data!.id;
  expect((await admin.from('shifts').select('penalties_enabled, late_marks_allowed, late_interval, late_method, penalty_leave_order').eq('id', ruleId).single()).data)
    .toEqual({ penalties_enabled: true, late_marks_allowed: 2, late_interval: 3, late_method: 'half_day', penalty_leave_order: [cl] });

  await page.getByRole('link', { name: 'Rotational shift' }).click();
  await expect(page.getByRole('region', { name: 'Rotational shifts' })).toBeVisible();
});

test('HR draws a polygon zone and tests punches against it', async ({ page }) => {
  const pune = (await admin.from('locations').select('id').eq('organization_id', orgId).eq('name', 'Pune office').single()).data!.id;
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/attendance?tab=settings');
  const form = page.getByRole('form', { name: 'New zone' });
  await form.getByLabel('Location').selectOption(pune);
  await form.getByLabel('Zone name').fill(zoneName);
  await form.getByRole('radio', { name: /Polygon/ }).click();
  await form.getByLabel('Corners').fill('18.5300, 73.8400\n18.5300, 73.8420\n18.5320, 73.8420\n18.5320, 73.8400');
  await expect(form.getByRole('img', { name: 'Polygon zone preview' })).toBeVisible();
  await form.getByRole('button', { name: '＋ Add zone' }).click();
  await expect(page.getByText(`Zone “${zoneName}” saved.`)).toBeVisible();
  const zone = (await admin.from('geofences').select('shape, points, latitude').eq('organization_id', orgId).eq('name', zoneName).single()).data!;
  expect([zone.shape, (zone.points as unknown[]).length, Number(zone.latitude)]).toEqual(['polygon', 4, 18.531]);

  const tester = page.getByRole('form', { name: 'Test a punch' });
  await tester.getByLabel('Location').selectOption(pune);
  await tester.getByLabel('Latitude').fill('18.5310');
  await tester.getByLabel('Longitude').fill('73.8410');
  await tester.getByRole('button', { name: '🎯 Test punch' }).click();
  await expect(tester.getByRole('list', { name: 'Test results' }).getByRole('listitem').filter({ hasText: zoneName })).toContainText('✓ Inside');
  await tester.getByLabel('Latitude').fill('18.5400');
  await tester.getByRole('button', { name: '🎯 Test punch' }).click();
  await expect(tester.getByRole('list', { name: 'Test results' }).getByRole('listitem').filter({ hasText: zoneName })).toContainText('✗ Outside');
});

test('HR saves a view of the logs, and reverts penalties in bulk', async ({ page }) => {
  await admin.from('attendance_penalties').insert([
    { organization_id: orgId, employee_id: devId, cycle_month: `${prevMonth}-01`, kind: 'late_marks', occurrences: 2, days: 0.5, total_days: 0.5, method: 'half_day', version: 1, detail: `E2E ${run}: 4 late arrivals` },
    { organization_id: orgId, employee_id: devId, cycle_month: `${prevMonth}-01`, kind: 'early_exits', occurrences: 1, days: 0.25, total_days: 0.25, method: 'hourly', version: 1, detail: `E2E ${run}: 1 early exit` },
  ]);
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/attendance?tab=logs&view=penalty&month=${prevMonth}`);
  await page.getByText('★ Saved views').click();
  await page.getByLabel('Save this view as').fill(viewName);
  await page.getByRole('button', { name: '★ Save view' }).click();
  await expect(page.getByText(`View “${viewName}” saved.`)).toBeVisible();

  const board = page.getByRole('form', { name: 'Penalties' });
  await board.getByRole('checkbox', { name: 'Select Dev Nair Late coming' }).check();
  await board.getByRole('checkbox', { name: 'Select Dev Nair Early leaving' }).check();
  await board.getByRole('button', { name: '↺ Revert selected' }).click();
  await expect(page.getByText('2 penalties reverted.')).toBeVisible();
  const { data } = await admin.from('attendance_penalties').select('reverted_at').eq('organization_id', orgId).like('detail', `%E2E ${run}%`);
  expect(data!.every((x) => x.reverted_at)).toBe(true);

  await open(page, '/app/demo/attendance?tab=logs');
  await page.getByText('★ Saved views').click();
  await page.getByRole('link', { name: viewName }).click();
  await expect(page).toHaveURL(new RegExp(`view=penalty.*month=${prevMonth}|month=${prevMonth}.*view=penalty`));
});

test('the employee regularizes two days at once', async ({ page }) => {
  await admin.from('attendance_days').upsert(regDays.map((d) => ({ organization_id: orgId, employee_id: devId, work_date: d, status: 'absent' as const })),
    { onConflict: 'employee_id,work_date' });
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/attendance');
  const form = page.getByRole('form', { name: 'Regularize several days' });
  for (const d of regDays) await form.locator(`input[name="workDates"][value="${d}"]`).check();
  await form.getByLabel('Check-in').fill('09:30');
  await form.getByLabel('Check-out').fill('18:30');
  await form.getByLabel('Reason').fill(`Card reader was down ${run}`);
  await form.getByRole('button', { name: 'Regularize 2 days' }).click();
  await expect(page.getByText('2 regularizations requested.')).toBeVisible();
  const { data } = await admin.from('regularization_requests').select('work_date, status').eq('employee_id', devId).ilike('reason', `%${run}%`).order('work_date');
  expect(data).toEqual(regDays.map((d) => ({ work_date: d, status: 'pending' })));
});
