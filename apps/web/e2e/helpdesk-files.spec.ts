import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Files on a helpdesk ticket, on the demo tenant: Dev attaches a screenshot and downloads it again; HR sees it and
 * adds an internal file Dev never sees; a file that isn't a PDF or an image is refused. Then HR switches on emails for
 * helpdesk replies, and HR's reply queues one for Dev. Everything is removed or restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let ticketPath = '';
let emailRuleBefore: boolean | null = null;

// A 1×1 PNG and a minimal PDF: enough for the type check, which reads the first bytes.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  emailRuleBefore = (await admin.from('notification_email_rules').select('enabled').eq('organization_id', orgId).eq('event', 'helpdesk_reply').maybeSingle()).data?.enabled ?? null;
});

test.afterAll(async () => {
  const tickets = (await admin.from('tickets').select('id').eq('organization_id', orgId).like('subject', `%${run}%`)).data ?? [];
  for (const t of tickets) {
    const files = (await admin.from('ticket_attachments').select('id').eq('ticket_id', t.id)).data ?? [];
    if (files.length) await admin.storage.from('helpdesk-attachments').remove(files.map((f) => `${orgId}/${t.id}/${f.id}`));
    await admin.from('notifications').delete().eq('link', `/helpdesk/${t.id}`);
    await admin.from('email_outbox').delete().eq('link', `/helpdesk/${t.id}`);
  }
  if (emailRuleBefore === null) await admin.from('notification_email_rules').delete().eq('organization_id', orgId).eq('event', 'helpdesk_reply');
  else await admin.from('notification_email_rules').update({ enabled: emailRuleBefore }).eq('organization_id', orgId).eq('event', 'helpdesk_reply');
  await admin.from('tickets').delete().in('id', tickets.map((t) => t.id));
});

test('the requester and HR share files on a ticket; internal files stay with HR', async ({ browser }) => {
  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/helpdesk');
  const raise = dev.getByRole('form', { name: 'Raise a ticket' });
  await raise.getByLabel('Category').selectOption({ label: 'IT and access' });
  await raise.getByLabel('Subject').fill(`VPN error ${run}`);
  await raise.getByLabel('Details').fill('The VPN shows an error every time I connect; screenshot attached.');
  await raise.getByRole('button', { name: 'Raise ticket' }).click();
  await dev.waitForURL(/\/helpdesk\/[0-9a-f-]{36}$/);
  ticketPath = new URL(dev.url()).pathname;

  const attach = dev.getByRole('form', { name: 'Attach a file' });
  await attach.getByLabel('File').setInputFiles({ name: 'notes.txt', mimeType: 'image/png', buffer: Buffer.from('not really an image') });
  await attach.getByRole('button', { name: 'Attach' }).click();
  await expect(attach.getByText('Upload a PDF, JPEG or PNG file.').first()).toBeVisible();
  await attach.getByLabel('File').setInputFiles({ name: `vpn-error-${run}.png`, mimeType: 'image/png', buffer: png });
  await attach.getByRole('button', { name: 'Attach' }).click();
  const files = dev.getByRole('list', { name: 'Files' });
  await expect(files.getByRole('link', { name: `vpn-error-${run}.png` })).toBeVisible();
  const download = await dev.request.get(await files.getByRole('link', { name: `vpn-error-${run}.png` }).getAttribute('href') as string);
  expect(download.status()).toBe(200);
  expect(Buffer.compare(await download.body(), png)).toBe(0);

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, ticketPath);
  await expect(hr.getByRole('list', { name: 'Files' }).getByRole('link', { name: `vpn-error-${run}.png` })).toBeVisible();
  const hrAttach = hr.getByRole('form', { name: 'Attach a file' });
  await hrAttach.getByLabel('File').setInputFiles({ name: `vpn-logs-${run}.pdf`, mimeType: 'application/pdf', buffer: pdf });
  await hrAttach.getByLabel('Internal (the requester won’t see it)').check();
  await hrAttach.getByRole('button', { name: 'Attach' }).click();
  await expect(hr.getByRole('list', { name: 'Files' }).getByRole('link', { name: `vpn-logs-${run}.pdf` })).toBeVisible();

  await open(dev, ticketPath);
  await expect(dev.getByRole('list', { name: 'Files' }).getByRole('link', { name: `vpn-error-${run}.png` })).toBeVisible();
  await expect(dev.getByText(`vpn-logs-${run}.pdf`)).toHaveCount(0);
  const internalId = (await admin.from('ticket_attachments').select('id').like('name', `vpn-logs-${run}%`).single()).data!.id;
  expect((await dev.request.get(`${ticketPath}/files/${internalId}`, { maxRedirects: 0 })).status()).toBe(404); // no link for the requester

  await dev.getByRole('form', { name: `Remove vpn-error-${run}.png` }).getByRole('button', { name: 'Remove' }).click();
  await expect(dev.getByRole('list', { name: 'Files' })).toHaveCount(0);
  expect((await admin.from('ticket_attachments').select('name').like('name', `%${run}%`)).data!.map((f) => f.name)).toEqual([`vpn-logs-${run}.pdf`]);
});

test('with helpdesk reply emails switched on, an agent’s reply emails the requester', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/settings?tab=notifications');
  const rules = page.getByRole('form', { name: 'Email notifications' });
  await rules.getByLabel('Helpdesk replies').check();
  await rules.getByRole('button', { name: 'Save email notifications' }).click();
  await expect(rules.getByText(/^Email notifications saved/)).toBeVisible();

  await open(page, ticketPath);
  const reply = page.getByRole('form', { name: 'Reply' });
  await reply.getByLabel('Reply').fill(`Please reconnect after the update ${run}.`);
  await reply.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('list', { name: 'Replies' }).getByText(`Please reconnect after the update ${run}.`)).toBeVisible();
  const ticketId = ticketPath.split('/').at(-1)!;
  const queued = (await admin.from('email_outbox').select('to_email, subject, body').eq('event', 'helpdesk_reply').eq('link', `/helpdesk/${ticketId}`)).data!;
  expect(queued).toHaveLength(1);
  expect(queued[0]!.to_email).toMatch(/^demo\.employee@/);
  expect(queued[0]!.body).toContain(`Please reconnect after the update ${run}.`);
});
