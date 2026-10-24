import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Helpdesk response targets and ratings, on the demo tenant: HR counts business hours (09:30 to 18:30 on working
 * days); Dev's new ticket is due inside those hours; HR resolves it, Dev rates it 4 of 5, and HR sees the rating and the
 * 90-day average. The settings are restored and the ticket removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
type Settings = NonNullable<Awaited<ReturnType<typeof loadSettings>>['data']>;
let before: Settings | null = null;
const loadSettings = (org: string) => admin.from('helpdesk_settings').select('*').eq('organization_id', org).maybeSingle();
let ticketPath = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  before = (await loadSettings(orgId)).data;
});

test.afterAll(async () => {
  const tickets = (await admin.from('tickets').select('id').eq('organization_id', orgId).like('subject', `%${run}%`)).data ?? [];
  for (const t of tickets) await admin.from('notifications').delete().eq('link', `/helpdesk/${t.id}`);
  await admin.from('tickets').delete().in('id', tickets.map((t) => t.id));
  if (before) await admin.from('helpdesk_settings').upsert(before);
  else await admin.from('helpdesk_settings').delete().eq('organization_id', orgId);
});

test('HR counts business hours; a new ticket is due within them', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/helpdesk/settings');
  const form = hr.getByRole('form', { name: 'Response targets' });
  await form.getByLabel('Normal (hours)').fill('16');
  await form.getByLabel(/Count business hours only/).check();
  await form.getByLabel('Day starts').fill('09:30');
  await form.getByLabel('Day ends').fill('18:30');
  await form.getByRole('button', { name: 'Save targets' }).click();
  await expect(form.getByText(/^Saved\./)).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/helpdesk');
  const raise = dev.getByRole('form', { name: 'Raise a ticket' });
  await raise.getByLabel('Category').selectOption({ label: 'IT and access' });
  await raise.getByLabel('Subject').fill(`Printer jam ${run}`);
  await raise.getByLabel('Details').fill('The second-floor printer jams on every double-sided job.');
  await raise.getByRole('button', { name: 'Raise ticket' }).click();
  await dev.waitForURL(/\/helpdesk\/[0-9a-f-]{36}$/);
  ticketPath = new URL(dev.url()).pathname;
  const due = (await admin.from('tickets').select('sla_due_at, created_at').eq('id', ticketPath.split('/').pop()!).single()).data!;
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(due.sla_due_at));
  expect(local >= '09:30' && local <= '18:30', `due at ${local} IST`).toBe(true);
  expect(Date.parse(due.sla_due_at) - Date.parse(due.created_at)).toBeGreaterThanOrEqual(16 * 3_600_000); // never sooner than wall-clock
});

test('Dev rates the resolved ticket; HR sees the rating and the average', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, ticketPath);
  const update = hr.getByRole('form', { name: 'Update ticket' });
  await update.getByLabel('Status').selectOption('resolved');
  await update.getByRole('button', { name: /Update|Save/ }).click();
  await expect(hr.getByText('Resolved', { exact: true }).first()).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, ticketPath);
  const rate = dev.getByRole('form', { name: 'Rate the help' });
  await rate.getByLabel('4 · Good').check();
  await rate.getByLabel('Anything to add? (optional)').fill('Fixed the same day, thanks.');
  await rate.getByRole('button', { name: 'Send rating' }).click();
  await expect(rate.getByText('Thank you. Your rating helps the helpdesk improve.')).toBeVisible();

  await hr.reload();
  await expect(hr.getByText('4 of 5', { exact: true })).toBeVisible();
  await expect(hr.getByText('Fixed the same day, thanks.')).toBeVisible();
  await open(hr, '/app/demo/helpdesk');
  await expect(hr.getByLabel('Satisfaction')).toContainText('of 5');
});
