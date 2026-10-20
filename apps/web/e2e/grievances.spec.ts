import { expect } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

/**
 * Grievances on the live demo tenant: Dev Nair raises a concern naming Rohan Iyer; HR opens it (recorded in the
 * audit log), adds an internal note and a message, investigates and resolves it; Dev sees the message and the
 * outcome but not the note; Rohan, being named, can't open the case. Removed afterwards (audit events stay).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const subject = `Meeting conduct ${run}`;
let orgId = '';
let rohanId = '';
let caseUrl = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  rohanId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single()).data!.id;
});

test.afterAll(async () => {
  await admin.from('grievances').delete().eq('organization_id', orgId).like('subject', `%${run}%`);
  await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', 'grievance.%').gte('created_at', startedAt);
});

test('the employee raises a concern in confidence', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/grievances');
  await expect(page.getByRole('table', { name: 'Cases' })).toHaveCount(0); // employees see only their own
  const form = page.getByRole('form', { name: 'Raise a concern' });
  await form.getByLabel('What is it about?').selectOption('conduct');
  await form.getByLabel('Title').fill(subject);
  await form.getByLabel('What happened?').fill('In the weekly review my work was mocked in front of the whole team, twice this month.');
  await form.getByLabel('Person involved', { exact: true }).selectOption(rohanId);
  await form.getByRole('button', { name: 'Submit in confidence' }).click();
  await page.waitForURL(/\/grievances\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({ hasText: 'Submitted in confidence.' })).toBeVisible();
  await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
  caseUrl = new URL(page.url()).pathname;
});

test('HR handles it; the employee sees replies and the outcome, never internal notes', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/grievances');
  await hr.getByRole('table', { name: 'Cases' }).getByRole('link', { name: subject }).click();
  await hr.waitForURL(`**${caseUrl}`);
  await expect(hr.getByText('Dev Nair')).toBeVisible(); // raised by
  const message = hr.getByRole('form', { name: 'Send a message' });
  await message.getByLabel('Message').fill('Rohan’s skip-level confirms the pattern.');
  await message.getByLabel('Internal note (the person who raised it won’t see it)').check();
  await message.getByRole('button', { name: 'Send' }).click();
  await expect(message.getByText('Internal note added.')).toBeVisible();
  await message.getByLabel('Message').fill('Thank you for raising this. We are looking into it and will update you this week.');
  await message.getByRole('button', { name: 'Send' }).click();
  await expect(message.getByText('Message sent.')).toBeVisible();
  const update = hr.getByRole('form', { name: 'Update case' });
  await update.getByLabel('Status').selectOption('investigating');
  await update.getByRole('button', { name: 'Update' }).click();
  await expect(update.getByText('Case updated. The person who raised it has been told.')).toBeVisible();

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, caseUrl);
  const thread = employee.getByRole('list', { name: 'Messages' });
  await expect(thread.getByText('We are looking into it')).toBeVisible();
  await expect(thread.getByText('skip-level')).toHaveCount(0);
  await expect(employee.getByText('Investigating', { exact: true })).toBeVisible();

  await update.getByLabel('Status').selectOption('resolved');
  await update.getByLabel('Outcome').fill('The manager has been given feedback and will chair reviews with HR present for the next quarter.');
  // The confirmation from the first update is still showing, so wait for this save itself to come back.
  const saved = hr.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/grievances/'));
  await update.getByRole('button', { name: 'Update' }).click();
  await saved;
  await expect(update.getByText('Case updated. The person who raised it has been told.')).toBeVisible();

  await employee.reload();
  await expect(employee.getByText('will chair reviews with HR present')).toBeVisible();
  await expect(employee.getByText('Resolved', { exact: true })).toBeVisible();

  const caseId = caseUrl.split('/').pop()!;
  const kiran = (await admin.from('employees').select('user_id').eq('organization_id', orgId).eq('first_name', 'Kiran').single()).data!.user_id;
  const views = (await admin.from('audit_events').select('actor_user_id').eq('entity_type', 'grievances').eq('entity_id', caseId).eq('action', 'view')).data ?? [];
  expect(views.some((v) => v.actor_user_id === kiran)).toBe(true);
});

test('the person named in the case can’t open it', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, '/app/demo/grievances');
  await expect(page.getByRole('link', { name: subject })).toHaveCount(0);
  await open(page, caseUrl);
  await expectNotFound(page);
});
