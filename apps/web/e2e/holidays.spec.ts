import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Holidays on the demo tenant: HR adds an optional holiday next year; Dev takes it from the holiday list and sees
 * it on the year calendar; HR removes it. Anything created is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const year = new Date().getUTCFullYear() + 1;
const date = `${year}-07-15`;
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  await admin.from('holidays').delete().eq('organization_id', orgId).eq('holiday_date', date);
});

test.afterAll(async () => {
  await admin.from('holidays').delete().eq('organization_id', orgId).like('name', `%${run}%`);
});

test('HR adds an optional holiday; an employee takes it and sees it on the calendar', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/holidays?tab=list&year=${year}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Holidays' })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add holiday' });
  await add.getByLabel('Date').fill(date);
  await add.getByLabel('Holiday').fill(`Founders Day ${run}`);
  await add.getByLabel('Type').selectOption('optional');
  await add.getByRole('button', { name: '＋ Add holiday' }).click();
  await expect(add.getByText(`Founders Day ${run} added.`)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Holidays' }).getByText(`Founders Day ${run}`)).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, `/app/demo/holidays?tab=list&year=${year}`);
  await dev.getByRole('form', { name: `Take Founders Day ${run}` }).getByRole('button', { name: 'Take this day' }).click();
  await expect(dev.getByRole('form', { name: `Drop Founders Day ${run}` })).toBeVisible();
  await open(dev, `/app/demo/holidays?tab=calendar&view=month&month=${year}-07`);
  await expect(dev.getByRole('table', { name: 'Month calendar' }).getByText(`Founders Day ${run}`)).toBeVisible();

  await open(page, `/app/demo/holidays?tab=list&year=${year}`);
  await expect(page.getByRole('table', { name: 'Holidays' }).getByText('Optional · 1 chose')).toBeVisible();
  await page.getByRole('form', { name: `Remove Founders Day ${run}` }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Holiday removed.' }).first()).toBeVisible();
});
