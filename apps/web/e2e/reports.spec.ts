import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

/**
 * Reports (Kredily's report library) on the demo tenant: HR exports the employee master as Excel and CSV, builds and
 * saves a custom report, runs it from Saved Templates and schedules a report; payroll staff see payroll reports and get
 * a clear message for a month that hasn't been processed; employees without report access can't open Reports.
 * Templates and schedules created here are removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});
test.afterAll(async () => {
  await admin.from('report_templates').delete().eq('organization_id', orgId).ilike('name', `%${run}%`);
  await admin.from('report_schedules').delete().eq('organization_id', orgId).eq('report_key', 'employee_master');
});

async function generate(page: Page, format: 'Excel' | 'CSV') {
  await page.getByRole('radio', { name: format }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ Generate & export' }).click()]);
  return { name: download.suggestedFilename(), bytes: await readFile((await download.path())!) };
}

test('HR exports the employee master as Excel and CSV; payroll reports are not listed for HR', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  const cats = page.getByRole('navigation', { name: 'Report categories' });
  await expect(cats.getByRole('link', { name: /Directory/ })).toBeVisible();
  await expect(cats.getByRole('link', { name: /Payroll/ })).toHaveCount(0);

  await cats.getByRole('link', { name: /Directory/ }).click();
  await page.getByRole('list', { name: 'Report list' }).getByRole('link', { name: /Employee Master/ }).click();
  const xlsx = await generate(page, 'Excel');
  expect(xlsx.name).toMatch(/^employee-master-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK');
  const csv = await generate(page, 'CSV');
  const text = csv.bytes.toString('utf8');
  expect(text).toContain('Employee ID,Name,Status');
  expect(text).toContain('Dev Nair');

  await page.reload();
  await expect(page.getByRole('list', { name: 'Recent exports' }).getByText('Employee Master').first()).toBeVisible();
  const { data } = await admin.from('audit_events').select('metadata').eq('organization_id', orgId).eq('entity_type', 'report').order('occurred_at', { ascending: false }).limit(1);
  expect((data![0]!.metadata as { report: string }).report).toBe('employee_master');
});

test('HR builds a custom report, saves it as a template, runs it and schedules a report', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/reports?report=custom_builder');
  await page.getByLabel('Group by').selectOption('department');
  const save = page.getByRole('form', { name: 'Save as template' });
  await save.getByLabel('Template name').fill(`Headcount ${run}`);
  await save.getByRole('button', { name: 'Save template' }).click();
  await expect(save.getByText(`Template “Headcount ${run}” saved.`, { exact: false })).toBeVisible();

  await open(page, '/app/demo/reports?report=saved_templates');
  await page.getByRole('radio', { name: new RegExp(`Headcount ${run}`) }).check();
  const out = await generate(page, 'CSV');
  expect(out.bytes.toString('utf8')).toContain('Department,Employee ID,Name');

  await open(page, '/app/demo/reports?report=employee_master');
  await page.getByRole('button', { name: '⏰ Schedule this report' }).click();
  const sch = page.getByRole('form', { name: 'Schedule report' });
  await sch.getByLabel('Frequency').selectOption('monthly');
  await sch.getByRole('button', { name: 'Schedule' }).click();
  await expect(sch.getByText('Scheduled.', { exact: false })).toBeVisible();
  await open(page, '/app/demo/reports?view=scheduled');
  await expect(page.getByRole('list', { name: 'Schedules' }).getByText('Employee Master')).toBeVisible();
  await page.getByRole('button', { name: 'Remove schedule for Employee Master' }).click();
  await expect(page.getByRole('list', { name: 'Schedules' })).toHaveCount(0);
});

test('payroll staff see payroll reports and a clear message for an unprocessed month', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, '/app/demo/reports?report=consolidated_net_pay');
  await expect(page.getByRole('heading', { name: 'Consolidated Net Pay' })).toBeVisible();
  const year = String(new Date().getUTCFullYear() - 4);
  await page.getByLabel('Year').selectOption(year);
  await page.getByLabel('Month').selectOption('01');
  await page.getByRole('button', { name: '⬇ Generate & export' }).click();
  await expect(page.getByText(`No processed payroll for January ${year} yet`, { exact: false })).toBeVisible();
});

test('employees without report access cannot open Reports', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/reports');
  await expectNotFound(page);
});
