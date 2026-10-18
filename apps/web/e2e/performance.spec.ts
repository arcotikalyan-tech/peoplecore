import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * A review cycle on the live demo tenant: HR opens it; the employee (Dev Nair) sets a goal and submits a self
 * review; their manager (Rohan Iyer) reviews; HR calibrates and shares; Dev sees the outcome. Removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const cycle = `E2E cycle ${run}`;
let orgId = '';
let devId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
});

test.afterAll(async () => {
  const { data: cycles } = await admin.from('review_cycles').select('id').eq('organization_id', orgId).eq('name', cycle);
  for (const c of cycles ?? []) {
    const { data: reviews } = await admin.from('reviews').select('id').eq('cycle_id', c.id);
    await admin.from('tasks').delete().eq('subject_id', c.id);
    if (reviews?.length) await admin.from('tasks').delete().in('subject_id', reviews.map((r) => r.id));
    await admin.from('review_cycles').delete().eq('id', c.id);
  }
  await admin.from('goals').delete().eq('employee_id', devId).ilike('title', `%${run}%`);
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'performance.%').gte('created_at', startedAt);
});

test('HR creates and opens a review cycle', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/performance/cycles');
  const form = page.getByRole('form', { name: 'New review cycle' });
  await form.getByLabel('Name').fill(cycle);
  await form.getByLabel('Period from').fill('2026-04-01');
  await form.getByLabel('Period to').fill('2026-09-30');
  await form.getByRole('button', { name: 'Create cycle' }).click();
  await expect(page.getByText('Cycle created.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Activate' }).first().click();
  await expect(page.getByRole('heading', { name: cycle }).locator('xpath=ancestor::section[1]').getByText('active', { exact: true })).toBeVisible();
});

test('the employee sets a goal and submits a self review', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/performance');
  const goal = page.getByRole('form', { name: 'Add a goal' });
  await goal.getByLabel('Goal').fill(`Cut checkout latency in half ${run}`);
  await goal.getByLabel('Weight (%)').fill('50');
  await goal.getByRole('button', { name: 'Add goal' }).click();
  await expect(page.getByRole('list', { name: 'Your goals' }).getByText(`Cut checkout latency in half ${run}`)).toBeVisible();

  const self = page.getByRole('form', { name: 'Self review' });
  await self.getByLabel('Rating').selectOption('4');
  await self.locator('textarea[name="comments"]').fill('Halved checkout latency and on-boarded two new engineers.');
  await self.getByRole('button', { name: 'Submit self review' }).click();
  await expect(page.getByText('Shared when the cycle closes').first()).toBeVisible();
});

test('the manager reviews; HR calibrates and shares; the employee sees the outcome', async ({ browser }) => {
  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/performance');
  const form = manager.getByRole('form', { name: 'Manager review for Dev Nair' });
  await form.getByLabel('Rating').selectOption('3');
  await form.locator('textarea[name="comments"]').fill('Strong delivery; next year lead a project end to end.');
  await form.getByRole('button', { name: 'Submit manager review' }).click();
  await expect(manager.getByRole('list', { name: 'Team reviews' }).getByText(/Manager: 3/).first()).toBeVisible();

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/performance/cycles');
  const cal = hr.getByRole('form', { name: 'Calibrate Dev Nair' });
  await cal.getByLabel('Final').selectOption('4');
  await cal.getByLabel('Note (needed if it differs)').fill('Above the bar against peers this cycle.');
  await cal.getByRole('button', { name: 'Save' }).click();
  await expect(hr.getByText('Calibrated.')).toBeVisible();
  await hr.getByRole('form', { name: `Share ${cycle}` }).getByRole('button', { name: 'Share results' }).click();
  await expect(hr.getByRole('heading', { name: cycle }).locator('xpath=ancestor::section[1]').getByText('shared', { exact: true })).toBeVisible();

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/performance');
  await expect(employee.getByText('4 · Exceeds expectations').last()).toBeVisible();
  await expect(employee.getByText('Strong delivery; next year lead a project end to end.')).toBeVisible();
});
