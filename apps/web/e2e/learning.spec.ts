import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Learning on the live demo tenant: HR adds a yearly compliance course and assigns it to Dev Nair with a due date;
 * Dev starts and completes it; his manager (Rohan Iyer) sees it in "Your team"; HR sees the completion and its
 * expiry. Dev also enrols himself in an open course. Removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const compliance = `Fire safety ${run}`;
const open1 = `Writing clearly ${run}`;
const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const inTwoWeeks = (() => { const d = new Date(`${todayIst}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 14); return d.toISOString().slice(0, 10); })();
let orgId = '';
let courseUrl = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});

test.afterAll(async () => {
  const courses = (await admin.from('courses').select('id').eq('organization_id', orgId).like('title', `%${run}%`)).data ?? [];
  if (courses.length) {
    await admin.from('course_enrollments').delete().in('course_id', courses.map((c) => c.id));
    await admin.from('courses').delete().in('id', courses.map((c) => c.id));
  }
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'learning.%').gte('created_at', startedAt);
});

test('HR adds courses and assigns one to the employee', async ({ page }) => {
  await signIn(page, 'demo.hr');
  for (const [title, yearly] of [[compliance, true], [open1, false]] as const) {
    await open(page, '/app/demo/learning/new');
    const form = page.getByRole('form', { name: 'New course' });
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Format').selectOption('online');
    await form.getByLabel('Duration (minutes)').fill('45');
    if (yearly) {
      await form.getByLabel('Valid for (months)').fill('12');
      await form.getByLabel('Anyone can enrol themselves').uncheck();
    }
    await form.getByRole('button', { name: 'Add course' }).click();
    await page.waitForURL(/\/learning\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('status').filter({ hasText: 'Course added.' })).toBeVisible();
    if (yearly) courseUrl = new URL(page.url()).pathname;
  }

  await open(page, courseUrl);
  const assign = page.getByRole('form', { name: 'Assign this course' });
  await assign.getByRole('checkbox', { name: /Dev Nair/ }).check();
  await assign.getByLabel('Due by').fill(inTwoWeeks);
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(assign.getByText('Assigned to 1 person.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Enrolments' }).getByRole('row').filter({ hasText: 'Dev Nair' }).getByText('Not started')).toBeVisible();
});

test('the employee completes it; their manager and HR see it', async ({ browser }) => {
  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/learning');
  const mine = dev.getByRole('list', { name: 'Your learning' });
  await expect(mine.getByRole('listitem').filter({ hasText: compliance }).getByText('Mandatory')).toBeVisible();
  await dev.getByRole('form', { name: `Start ${compliance}` }).getByRole('button', { name: 'Start' }).click();
  await expect(dev.getByRole('status').filter({ hasText: 'Started.' })).toBeVisible();
  const complete = dev.getByRole('form', { name: `Complete ${compliance}` });
  await complete.getByLabel('Note').fill('Watched all modules');
  await complete.getByRole('button', { name: 'Mark complete' }).click();
  await expect(dev.getByRole('status').filter({ hasText: 'Marked complete.' })).toBeVisible();
  await expect(mine.getByRole('listitem').filter({ hasText: compliance }).getByText(/valid until/)).toBeVisible();

  // Open courses: enrol yourself.
  await dev.getByRole('form', { name: `Enrol in ${open1}` }).getByRole('button', { name: 'Enrol' }).click();
  await expect(dev.getByRole('status').filter({ hasText: 'Enrolled.' })).toBeVisible();
  await expect(mine.getByRole('listitem').filter({ hasText: open1 }).getByText('In progress')).toBeVisible();

  const rohan = await (await browser.newContext()).newPage();
  await signIn(rohan, 'demo.manager');
  await open(rohan, '/app/demo/learning');
  await expect(rohan.getByRole('table', { name: 'Your team’s learning' }).getByRole('row').filter({ hasText: compliance }).getByText('Completed')).toBeVisible();

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, courseUrl);
  await expect(hr.getByRole('table', { name: 'Enrolments' }).getByRole('row').filter({ hasText: 'Dev Nair' }).getByText(/valid until/)).toBeVisible();
  const row = (await admin.from('course_enrollments').select('status, valid_until, completion_note')
    .eq('course_id', courseUrl.split('/').pop()!).single()).data!;
  expect(row.status).toBe('completed');
  expect(row.completion_note).toBe('Watched all modules');
  expect(row.valid_until).not.toBeNull();
});
