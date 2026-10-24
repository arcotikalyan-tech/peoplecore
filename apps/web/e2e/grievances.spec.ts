import { expect } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

/**
 * Grievances on the live demo tenant: Dev Nair raises a concern naming Rohan Iyer; HR opens it (recorded in the
 * audit log), adds an internal note and a message, investigates and resolves it; Dev sees the message and the
 * outcome but not the note; Rohan, being named, can't open the case. Then Dev raises a concern anonymously with a file:
 * HR sees "Anonymous" and nowhere Dev's name, downloads the file and adds an internal one Dev never sees. Removed
 * afterwards with their files (audit events stay).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
const subject = `Meeting conduct ${run}`;
let orgId = '';
let rohanId = '';
let caseUrl = '';
let anonymousUrl = '';
const anonymousSubject = `Travel claims ${run}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  rohanId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single()).data!.id;
});

test.afterAll(async () => {
  const cases = (await admin.from('grievances').select('id').eq('organization_id', orgId).like('subject', `%${run}%`)).data ?? [];
  const files = (await admin.from('grievance_files').select('id, grievance_id').in('grievance_id', cases.map((c) => c.id))).data ?? [];
  if (files.length) await admin.storage.from('grievance-files').remove(files.map((x) => `${orgId}/${x.grievance_id}/${x.id}`));
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

test('an anonymous concern: HR never sees who raised it; files go both ways, internal ones stay with HR', async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/grievances');
  const form = employee.getByRole('form', { name: 'Raise a concern' });
  await form.getByLabel('What is it about?').selectOption('ethics');
  await form.getByLabel('Title').fill(anonymousSubject);
  await form.getByLabel('What happened?').fill('Taxi bills from a travel desk that does not exist are being claimed every month.');
  await form.getByLabel(/Raise it anonymously/).check();
  await form.getByRole('button', { name: 'Submit in confidence' }).click();
  await employee.waitForURL(/\/grievances\/[0-9a-f-]{36}$/);
  await expect(employee.getByRole('status').filter({ hasText: 'Submitted anonymously.' })).toBeVisible();
  anonymousUrl = new URL(employee.url()).pathname;
  const attach = employee.getByRole('form', { name: 'Attach a file' });
  await attach.getByLabel('File').setInputFiles({ name: 'claims-summary.pdf', mimeType: 'application/pdf', buffer: PDF });
  await attach.getByRole('button', { name: 'Attach' }).click();
  await expect(attach.getByText('File attached.')).toBeVisible();

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/grievances');
  await expect(hr.getByRole('table', { name: 'Cases' }).getByRole('row').filter({ hasText: anonymousSubject })).toContainText('Anonymous');
  await open(hr, anonymousUrl);
  await expect(hr.getByText('Anonymous', { exact: true })).toBeVisible(); // raised by
  // Nowhere on the page outside the pick lists (which list every colleague).
  const shown = await hr.evaluate(() => { const copy = document.body.cloneNode(true) as HTMLElement; copy.querySelectorAll('select, script, template').forEach((s) => s.remove()); return copy.innerText; });
  expect(shown).not.toContain('Dev Nair');
  const files = hr.getByRole('list', { name: 'Files' });
  await expect(files.getByText('Person who raised it')).toBeVisible();
  const download = await hr.request.get(await files.getByRole('link', { name: 'claims-summary.pdf' }).getAttribute('href') ?? '');
  expect(download.status()).toBe(200);
  expect((await download.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const hrAttach = hr.getByRole('form', { name: 'Attach a file' });
  await hrAttach.getByLabel('File').setInputFiles({ name: 'finance-check.pdf', mimeType: 'application/pdf', buffer: PDF });
  await hrAttach.getByLabel('Internal (the person who raised it won’t see it)').check();
  await hrAttach.getByRole('button', { name: 'Attach' }).click();
  await expect(hrAttach.getByText('File attached.')).toBeVisible();

  await employee.reload();
  await expect(employee.getByRole('list', { name: 'Files' }).getByRole('link', { name: 'claims-summary.pdf' })).toBeVisible();
  await expect(employee.getByText('finance-check.pdf')).toHaveCount(0);
  const caseId = anonymousUrl.split('/').pop()!;
  const created = (await admin.from('audit_events').select('actor_user_id').eq('entity_type', 'grievances').eq('entity_id', caseId).eq('action', 'insert')).data ?? [];
  expect(created).toEqual([{ actor_user_id: null }]);
});
