import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Engagement and services on the live demo tenant: HR publishes an announcement that the employee (Dev Nair)
 * acknowledges; Dev gives kudos; Dev raises a helpdesk ticket that HR answers (with an internal note Dev never
 * sees) and resolves; HR writes knowledge-base articles that Dev can search (drafts stay hidden). Removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});

test.afterAll(async () => {
  await admin.from('announcements').delete().eq('organization_id', orgId).like('title', `%${run}%`);
  await admin.from('kudos').delete().eq('organization_id', orgId).like('message', `%${run}%`);
  await admin.from('tickets').delete().eq('organization_id', orgId).like('subject', `%${run}%`);
  await admin.from('kb_articles').delete().eq('organization_id', orgId).like('title', `%${run}%`);
  for (const kind of ['helpdesk.%', 'kudos.%']) {
    await admin.from('notifications').delete().eq('organization_id', orgId).like('kind', kind).gte('created_at', startedAt);
  }
});

test('HR publishes an announcement; the employee acknowledges it', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/engagement');
  const form = hr.getByRole('form', { name: 'Publish an announcement' });
  await form.getByLabel('Title').fill(`Office closed on Diwali ${run}`);
  await form.getByLabel('Message').fill('The Bengaluru office is closed on 20 October. Plan your work accordingly.');
  await form.getByLabel('Ask everyone to acknowledge it').check();
  await form.getByRole('button', { name: 'Publish' }).click();
  await expect(form.getByText('Announcement published.')).toBeVisible();

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/engagement');
  await employee.getByRole('form', { name: `Acknowledge Office closed on Diwali ${run}` }).getByRole('button', { name: 'I have read this' }).click();
  await expect(employee.getByRole('status').filter({ hasText: 'Acknowledged.' })).toBeVisible();
  await expect(employee.getByRole('region', { name: `Office closed on Diwali ${run}` }).getByText('Acknowledged', { exact: true })).toBeVisible();

  await hr.reload();
  await expect(hr.getByRole('region', { name: `Office closed on Diwali ${run}` }).getByText('1 acknowledged')).toBeVisible();
});

test('the employee gives kudos and everyone sees them', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/engagement');
  const form = page.getByRole('form', { name: 'Give kudos' });
  const rohan = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single()).data!.id;
  await form.getByLabel('Colleague').selectOption(rohan);
  await form.getByLabel('What did they do?').fill(`Thanks for unblocking the release ${run}`);
  await form.getByRole('button', { name: 'Send kudos' }).click();
  await expect(form.getByText('Kudos sent.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Kudos' }).getByText(`Thanks for unblocking the release ${run}`)).toBeVisible();
});

test('a ticket: raised, answered with an internal note, resolved, closed', async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo/helpdesk');
  const raise = employee.getByRole('form', { name: 'Raise a ticket' });
  await raise.getByLabel('Category').selectOption({ label: 'Payroll and payslips' });
  await raise.getByLabel('Subject').fill(`September payslip missing ${run}`);
  await raise.getByLabel('Details').fill('I can’t find my September payslip on the Payslips page.');
  await raise.getByRole('button', { name: 'Raise ticket' }).click();
  await employee.waitForURL(/\/helpdesk\/[0-9a-f-]{36}$/);
  await expect(employee.getByRole('status').filter({ hasText: 'Ticket raised.' })).toBeVisible();
  const ticketUrl = new URL(employee.url()).pathname;

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/helpdesk');
  await hr.getByRole('table', { name: 'Open tickets' }).getByRole('link', { name: `September payslip missing ${run}` }).click();
  await hr.waitForURL(`**${ticketUrl}`);
  const reply = hr.getByRole('form', { name: 'Reply' });
  await reply.getByLabel('Reply').fill('Payroll for September is not locked yet; check with finance.');
  await reply.getByLabel('Internal note (the requester won’t see it)').check();
  await reply.getByRole('button', { name: 'Send' }).click();
  await expect(reply.getByText('Internal note added.')).toBeVisible();
  await reply.getByLabel('Reply').fill('It will be there after this month’s run is locked, on the 30th.');
  await reply.getByRole('button', { name: 'Send' }).click();
  await expect(reply.getByText('Reply sent.')).toBeVisible();
  const update = hr.getByRole('form', { name: 'Update ticket' });
  await update.getByLabel('Status').selectOption('resolved');
  await update.getByRole('button', { name: 'Update' }).click();
  await expect(update.getByText('Resolved. The requester has been told.')).toBeVisible();

  await employee.reload();
  const thread = employee.getByRole('list', { name: 'Replies' });
  await expect(thread.getByText('It will be there after this month’s run is locked, on the 30th.')).toBeVisible();
  await expect(thread.getByText('check with finance')).toHaveCount(0);
  await expect(employee.getByText('Resolved', { exact: true })).toBeVisible();
  await employee.getByRole('form', { name: 'Close ticket' }).getByRole('button', { name: 'Close ticket' }).click();
  await expect(employee.getByRole('status').filter({ hasText: 'Ticket closed.' })).toBeVisible();
  await expect(employee.getByText('This ticket is closed.')).toBeVisible();
});

test('HR writes articles; the employee finds the published one, not the draft', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  for (const [title, published] of [[`Download your payslip ${run}`, true], [`Draft bonus policy ${run}`, false]] as const) {
    await open(hr, '/app/demo/knowledge/new');
    const form = hr.getByRole('form', { name: 'New article' });
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Topic').fill('Payroll');
    await form.getByLabel('Article').fill('Open Payslips from the menu, choose the month and select Download. Payslips appear once payroll is locked.');
    if (!published) await form.getByLabel(/Published/).uncheck();
    await form.getByRole('button', { name: 'Save article' }).click();
    await hr.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/);
    await expect(hr.getByRole('heading', { name: title })).toBeVisible();
  }

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, `/app/demo/knowledge?q=${run}`);
  const results = employee.getByRole('list', { name: 'Articles' });
  await expect(results.getByRole('link', { name: `Download your payslip ${run}` })).toBeVisible();
  await expect(results.getByText(`Draft bonus policy ${run}`)).toHaveCount(0);
});
