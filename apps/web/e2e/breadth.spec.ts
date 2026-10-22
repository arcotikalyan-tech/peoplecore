import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Kredily second pass, batch 4 on the demo tenant: ID Studio visiting cards (custom line, roll-out, SVG export), the
 * Konnect discussion board, the interview calendar and job feed, and Learn's starter library and reminders.
 * Everything made here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const STARTER = 'Managing your time and priorities';
let orgId = '';
let starterBefore = false;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  starterBefore = !!(await admin.from('courses').select('id').eq('organization_id', orgId).eq('title', STARTER).maybeSingle()).data;
});

test.afterAll(async () => {
  await admin.from('id_card_designs').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('konnect_threads').delete().eq('organization_id', orgId).like('title', `%${run}%`);
  if (!starterBefore) {
    const course = (await admin.from('courses').select('id').eq('organization_id', orgId).eq('title', STARTER).maybeSingle()).data;
    if (course) {
      await admin.from('course_enrollments').delete().eq('course_id', course.id);
      await admin.from('courses').delete().eq('id', course.id);
      await admin.from('notifications').delete().eq('organization_id', orgId).eq('kind', 'learning.reminder').like('title', `%${STARTER}%`);
    }
  }
});

test('ID Studio: a visiting card with a custom line, rolled out and exported as SVGs; Dev gets his card', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/idstudio');
  const create = page.getByRole('form', { name: 'New design' });
  await create.getByLabel('Design name').fill(`Visiting ${run}`);
  await create.getByLabel('Visiting card').check();
  await create.getByRole('button', { name: 'Create design' }).click();
  await page.waitForURL(/tab=fields&design=/);
  const designId = new URL(page.url()).searchParams.get('design')!;

  const fields = page.getByRole('form', { name: 'Fields and layout' });
  await fields.getByRole('button', { name: '＋ Add field' }).click();
  await fields.getByLabel('Custom line 1 label').fill('Desk');
  await fields.getByLabel('Custom line 1 value').fill(`B-12 ${run}`);
  await fields.getByRole('button', { name: 'Save fields' }).click();
  await expect(fields.getByText('Fields and layout saved.')).toBeVisible();
  await expect.poll(async () => (await admin.from('id_card_designs').select('card_type, custom_fields').eq('id', designId).single()).data)
    .toEqual({ card_type: 'visiting', custom_fields: [{ label: 'Desk', value: `B-12 ${run}` }] });

  await open(page, '/app/demo/idstudio');
  const visiting = page.getByRole('list', { name: 'Visiting card designs' }).getByRole('listitem').filter({ hasText: `Visiting ${run}` });
  await expect(visiting.getByText(`B-12 ${run}`).first()).toBeVisible();
  await visiting.getByRole('form', { name: `Roll out Visiting ${run}` }).getByRole('button', { name: '👥 Roll out to everyone' }).click();
  await expect(visiting.getByRole('status').filter({ hasText: /^Rolled out: \d+/ })).toBeVisible();
  expect((await admin.from('id_card_designs').select('rolled_out_at').eq('id', designId).single()).data!.rolled_out_at).not.toBeNull();

  const zip = await page.request.get(`/app/demo/idstudio/export?design=${designId}`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toBe('application/zip');
  const bytes = await zip.body();
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(bytes.includes(Buffer.from('Dev Nair - front.svg'))).toBe(true);
  expect(bytes.includes(Buffer.from(`B-12 ${run}`))).toBe(true);

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/idstudio');
  const mine = dev.getByRole('region', { name: `My visiting card · Visiting ${run}` });
  await expect(mine.getByText(`B-12 ${run}`).first()).toBeVisible();
  await expect(mine.getByRole('link', { name: '⤓ Download my visiting card (SVG)' })).toHaveAttribute('href', `/app/demo/idstudio/export?design=${designId}`);
  const own = await dev.request.get(`/app/demo/idstudio/export?design=${designId}`);
  expect(own.status()).toBe(200);
  const ownBytes = await own.body();
  expect(ownBytes.includes(Buffer.from('Dev Nair - front.svg'))).toBe(true);
  expect(ownBytes.toString('latin1').split(' - front.svg').length - 1).toBe(2); // one card (named in the entry and the directory)
});

test('Konnect: Dev starts a discussion, HR replies and pins it, Dev sees both', async ({ page, browser }) => {
  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/konnect');
  await expect(dev.getByRole('heading', { level: 1, name: 'Konnect' })).toBeVisible();
  const start = dev.getByRole('form', { name: 'Start a discussion' });
  if (!(await start.isVisible())) await dev.getByText('＋ Start a discussion').click();
  await start.getByLabel('Title').fill(`Lunch ideas ${run}`);
  await start.getByLabel('Message').fill('Where should the team go on Friday?');
  await start.getByRole('button', { name: 'Post discussion' }).click();
  await expect(dev.getByRole('list', { name: 'Discussions' }).getByText(`Lunch ideas ${run}`)).toBeVisible();

  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/konnect');
  await page.getByRole('list', { name: 'Discussions' }).getByRole('link', { name: new RegExp(`Lunch ideas ${run}`) }).click();
  const thread = page.getByRole('article', { name: `Lunch ideas ${run}` });
  await expect(thread.getByText('Where should the team go on Friday?')).toBeVisible();
  const reply = page.getByRole('form', { name: 'Reply' });
  await reply.getByLabel('Your reply').fill(`The new canteen ${run}`);
  await reply.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('list', { name: 'Replies' }).getByText(`The new canteen ${run}`)).toBeVisible();
  await thread.getByRole('form', { name: 'Pin' }).getByRole('button').click();
  await expect(thread.getByText('📌 Pinned')).toBeVisible();

  await open(dev, '/app/demo/konnect');
  await dev.getByRole('list', { name: 'Discussions' }).getByRole('link', { name: new RegExp(`Lunch ideas ${run}`) }).click();
  await expect(dev.getByRole('article', { name: `Lunch ideas ${run}` }).getByText('📌 Pinned')).toBeVisible();
  await expect(dev.getByRole('list', { name: 'Replies' }).getByText(`The new canteen ${run}`)).toBeVisible();
  await expect(dev.getByRole('article', { name: `Lunch ideas ${run}` }).getByRole('form', { name: 'Pin' })).toHaveCount(0); // not a moderator
});

test('Hiring: the interview calendar and the public job feed', async ({ page, request }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/recruitment?tab=pipeline&view=interviews');
  await page.getByRole('link', { name: '🗓 Calendar view' }).click();
  await expect(page.getByRole('table', { name: 'Interview calendar' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Interviews · [A-Z][a-z]+ \d{4}$/ })).toBeVisible();
  await page.getByRole('link', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/show=calendar&month=\d{4}-\d{2}/);
  await open(page, '/app/demo/recruitment?tab=outreach&view=board');
  await expect(page.getByLabel('Job feed address')).toHaveText(/\/careers\/demo\/jobs\.xml$/);

  const feed = await request.get('/careers/demo/jobs.xml');
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('application/xml');
  const xml = await feed.text();
  expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<source>')).toBe(true);
  const url = /<url><!\[CDATA\[(.+?)\]\]><\/url>/.exec(xml)?.[1];
  if (url) { // a published job: its page carries Google's job-posting data
    const job = await request.get(new URL(url).pathname);
    expect(await job.text()).toContain('"@type":"JobPosting"');
  }
});

test('Learn: HR adds a starter course and reminds the people who haven’t finished it', async ({ page }) => {
  test.skip(starterBefore, 'the demo tenant already has this starter course');
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/learning?tab=courses');
  const card = page.getByRole('list', { name: 'Starter courses' }).getByRole('listitem').filter({ hasText: STARTER });
  await card.getByRole('button', { name: '＋ Add to catalog' }).click();
  await expect(card.getByRole('link', { name: '✓ In your catalog · open' })).toBeVisible();
  const course = (await admin.from('courses').select('id, status').eq('organization_id', orgId).eq('title', STARTER).single()).data!;
  expect(course.status).toBe('draft');
  expect((await admin.from('course_lessons').select('id').eq('course_id', course.id)).data).toHaveLength(3);

  const dev = (await admin.from('employees').select('id, user_id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!;
  await admin.from('course_enrollments').insert({ organization_id: orgId, course_id: course.id, employee_id: dev.id, source: 'assigned', due_on: '2026-01-01' });
  await card.getByRole('link', { name: '✓ In your catalog · open' }).click();
  const remind = page.getByRole('form', { name: 'Remind learners' });
  await remind.getByRole('button', { name: 'Overdue only' }).click();
  await expect(remind.getByRole('status')).toHaveText('Reminded 1 person.');
  await remind.getByRole('button', { name: '🔔 Remind everyone not finished' }).click();
  await expect(remind.getByRole('status')).toContainText('No one to remind');
  const notes = (await admin.from('notifications').select('title').eq('user_id', dev.user_id!).eq('kind', 'learning.reminder').like('title', `%${STARTER}%`)).data!;
  expect(notes).toHaveLength(1);
});
