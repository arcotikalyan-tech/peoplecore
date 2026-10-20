import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Learn on the demo tenant: HR creates a course with a lesson, a skill and points, publishes it, composes a journey and
 * a rule; Dev finds the course in Explore, enrols, marks the lesson done (which completes the course) and opens the
 * certificate. Everything created here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const title = `Data privacy ${run}`;
const admin = adminClient();
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});

test.afterAll(async () => {
  const courses = (await admin.from('courses').select('id').eq('organization_id', orgId).like('title', `%${run}%`)).data ?? [];
  const ids = courses.map((c) => c.id);
  await admin.from('learn_rules').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('learn_journeys').delete().eq('organization_id', orgId).like('title', `%${run}%`);
  if (ids.length) {
    await admin.from('course_enrollments').delete().in('course_id', ids);
    await admin.from('courses').delete().in('id', ids);
  }
  await admin.from('learn_skills').delete().eq('organization_id', orgId).like('name', `%${run}%`);
});

test('HR builds a course, journey and rule; the employee completes it through its lesson', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/learning');
  await expect(page.getByRole('heading', { level: 1, name: 'Learn · L&D Cockpit' })).toBeVisible();

  await open(page, '/app/demo/learning?tab=skills');
  const skill = page.getByRole('form', { name: 'New skill' });
  await skill.locator('input[name="name"]').fill(`Privacy ${run}`);
  await skill.locator('input[name="category"]').fill('Compliance');
  await skill.getByRole('button', { name: '＋ Add skill' }).click();
  await expect(skill.getByText(`Privacy ${run} added.`)).toBeVisible();

  await open(page, '/app/demo/learning/new');
  const form = page.getByRole('form', { name: 'New course' });
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Format').selectOption('online');
  await form.getByRole('button', { name: 'Add course' }).click();
  await page.waitForURL(/\/learning\/[0-9a-f-]{36}$/);

  const lesson = page.getByRole('form', { name: 'New lesson' });
  await lesson.locator('input[name="title"]').fill('What counts as personal data');
  await lesson.locator('textarea[name="body"]').fill('Names, emails, IDs and anything that identifies a person.');
  await lesson.getByRole('button', { name: '＋ Add lesson' }).click();
  await expect(lesson.getByText('What counts as personal data added.')).toBeVisible();
  const cs = page.getByRole('form', { name: 'Add a skill this course teaches' });
  await cs.locator('select[name="skillId"]').selectOption({ label: `Privacy ${run}` });
  await cs.getByRole('button', { name: 'Add skill' }).click();
  await expect(cs.getByText('Skill saved.')).toBeVisible();
  const pts = page.getByRole('form', { name: 'Completion points' });
  await pts.locator('input[name="points"]').fill('30');
  await pts.getByRole('button', { name: 'Save' }).click();
  await expect(pts.getByText('Points saved.')).toBeVisible();

  await open(page, '/app/demo/learning?tab=journeys');
  const journey = page.getByRole('form', { name: 'New journey' });
  await journey.locator('input[name="title"]').fill(`Compliance path ${run}`);
  await journey.locator('select[name="status"]').selectOption('published');
  await journey.getByLabel('Step 1').selectOption({ label: title });
  await journey.getByRole('button', { name: '＋ New journey' }).click();
  await expect(journey.getByText(`Compliance path ${run} created.`)).toBeVisible();

  await open(page, '/app/demo/learning?tab=assignments');
  const rule = page.getByRole('form', { name: 'New rule' });
  await rule.locator('input[name="name"]').fill(`New joiners ${run}`);
  await rule.locator('select[name="target"]').selectOption({ label: `Course · ${title}` });
  await rule.getByRole('button', { name: '＋ New rule' }).click();
  await expect(rule.getByText(/Rule created/)).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, `/app/demo/learning?tab=explore&q=${run}`);
  await dev.getByRole('link', { name: new RegExp(title) }).click();
  await dev.getByRole('form', { name: `Enrol in ${title}` }).getByRole('button', { name: 'Enrol' }).click();
  await dev.getByRole('form', { name: 'Mark What counts as personal data done' }).getByRole('button', { name: 'Mark done' }).click();
  await expect(dev.getByText('Course complete 🎉')).toBeVisible();
  await dev.getByRole('link', { name: '🎓 Certificate' }).click();
  await expect(dev.getByText('Certificate of completion')).toBeVisible();
  await expect(dev.getByText(title)).toBeVisible();
  await dev.context().close();
});
