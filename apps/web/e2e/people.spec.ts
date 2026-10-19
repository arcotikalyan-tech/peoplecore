import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * People (Kredily's directory) on the demo tenant: HR's overview, grid and list, lifecycle and org chart; HR confirms
 * a probation in bulk; directory visibility decides what an employee sees about colleagues. Restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';
let settingsBefore: { show_department: boolean; show_designation: boolean; show_email: boolean; show_phone: boolean; show_location: boolean } | null = null;
let target: { id: string; probation_end_date: string | null; confirmed_on: string | null; first_name: string; last_name: string | null } | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  settingsBefore = (await admin.from('directory_settings').select('show_department, show_designation, show_email, show_phone, show_location').eq('organization_id', orgId).single()).data;
  target = (await admin.from('employees').select('id, probation_end_date, confirmed_on, first_name, last_name').eq('organization_id', orgId).eq('status', 'active')
    .eq('first_name', 'Dev').single()).data;
  // Dev's probation ended yesterday and isn't confirmed.
  const joined = (await admin.from('employees').select('date_of_joining').eq('id', target!.id).single()).data!.date_of_joining;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await admin.from('employees').update({ probation_end_date: yesterday > joined ? yesterday : joined, confirmed_on: null }).eq('id', target!.id);
});

test.afterAll(async () => {
  if (settingsBefore) await admin.from('directory_settings').update(settingsBefore).eq('organization_id', orgId);
  if (target) await admin.from('employees').update({ probation_end_date: target.probation_end_date, confirmed_on: target.confirmed_on }).eq('id', target.id);
});

test('HR sees the overview, people, lifecycle and org chart, and confirms a probation', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees');
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Workforce lifecycle' })).toBeVisible();
  await page.getByRole('navigation', { name: 'People sections' }).getByRole('link', { name: /^People/ }).click();
  await expect(page.getByRole('link', { name: 'Open Dev Nair' })).toBeVisible();

  await page.getByRole('link', { name: /Confirm Probation/ }).click();
  const board = page.getByRole('form', { name: 'People' });
  await board.getByRole('checkbox', { name: 'Select Dev Nair' }).check();
  await board.getByRole('button', { name: '✓ Confirm probation' }).click();
  await expect(page.getByText('Confirmed 1 person.')).toBeVisible();
  expect((await admin.from('employees').select('confirmed_on').eq('id', target!.id).single()).data!.confirmed_on).not.toBeNull();

  await open(page, '/app/demo/employees?tab=people&view=list');
  await expect(page.getByRole('table', { name: 'People' })).toBeVisible();
  await open(page, '/app/demo/employees?tab=lifecycle');
  await expect(page.getByRole('region', { name: 'Active' })).toBeVisible();
  await open(page, '/app/demo/employees?tab=orgchart');
  await expect(page.getByRole('list', { name: 'Organization chart' })).toBeVisible();
});

test('directory visibility decides what employees see about colleagues', async ({ page, browser }) => {
  await admin.from('directory_settings').update({ show_email: false }).eq('organization_id', orgId);
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/employees');
  await expect(page.getByRole('navigation', { name: 'People sections' }).getByRole('link', { name: 'Overview' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Email / })).toHaveCount(0);

  const ctx = await browser.newContext();
  const hr = await ctx.newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/employees?tab=settings');
  const form = hr.getByRole('form', { name: 'Privacy & Visibility' });
  await form.getByRole('switch', { name: 'Work email' }).check({ force: true });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(hr.getByText('Directory visibility saved.')).toBeVisible();
  await ctx.close();

  await open(page, '/app/demo/employees');
  await expect(page.getByRole('link', { name: /^Email / }).first()).toBeVisible();
});
