import { expect } from '@playwright/test';
import { adminClient, domain, open, signIn, test } from './helpers';
import { linkFromLatestEmail, mailpitUrl } from './mailbox';

/**
 * Platform › Email templates: the platform admin changes the layout and rewords the invitation, sends themselves a
 * test, and the next invitation HR sends uses both. Everything goes back to the standard text afterwards.
 */
test.describe.configure({ mode: 'serial' });
test.skip(!mailpitUrl, 'Needs the local Supabase test inbox (MAILPIT_URL)');

const run = Date.now().toString(36).slice(-5).toUpperCase();
const invitee = `e2e.template.${run.toLowerCase()}@${domain}`;
const admin = adminClient();

test.afterAll(async () => {
  if (!mailpitUrl) return;
  await admin.from('platform_email_templates').delete().eq('key', 'invite');
  await admin.from('platform_email_layout').update({ brand_name: null, accent_color: null, logo_url: null, show_brand_name: null, footer_text: null, support_email: null, address: null }).eq('id', true);
  for (let page = 1; page <= 5; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    for (const user of data.users.filter((u) => u.email === invitee)) {
      await admin.from('organization_members').delete().eq('user_id', user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
    if (data.users.length < 1000) break;
  }
});

test('the platform admin rewords the invitation and changes the layout; the next invitation uses both', async ({ browser }) => {
  const platform = await (await browser.newContext()).newPage();
  await signIn(platform, 'demo.platform');
  await open(platform, '/platform/emails');
  await expect(platform.getByRole('heading', { name: 'Email templates' })).toBeVisible();

  // The layout: every email's colour and footer.
  await platform.getByLabel('Accent colour (hex)').fill('#0a66f0');
  await platform.getByLabel('Footer').fill(`Acme people team ${run}`);
  await platform.getByRole('button', { name: 'Save layout' }).click();
  await expect(platform.getByText('Layout saved.', { exact: false })).toBeVisible();

  // The invitation's words, with a live preview and a check on fill-ins.
  await platform.getByRole('button', { name: /^Invitation/ }).click();
  const subject = platform.getByLabel('Subject');
  await subject.fill('Hello {{orgname}}');
  await expect(platform.getByText('This email has no {{orgname}}', { exact: false })).toBeVisible();
  await subject.fill(`Welcome aboard {{organization}} ${run}`);
  await expect(platform.getByTestId('preview-subject')).toHaveText(`Welcome aboard Acme Technologies ${run}`);
  await platform.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(platform.getByText('Invitation saved.')).toBeVisible();

  // A test goes to the administrator only, with example values.
  const testSince = new Date(Date.now() - 1000);
  await platform.getByRole('button', { name: 'Send me a test' }).click();
  await expect(platform.getByText(`Test email sent to demo.platform@${domain}.`, { exact: false })).toBeVisible();
  const sample = await linkFromLatestEmail(`demo.platform@${domain}`, testSince, /example=1/);
  expect(sample.subject).toBe(`[Test] Welcome aboard Acme Technologies ${run}`);

  // HR invites someone: Supabase hands the email to the app, which uses the new words and layout.
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/members');
  const since = new Date(Date.now() - 1000);
  const invite = hr.locator('form').filter({ has: hr.getByRole('button', { name: 'Send invitation' }) });
  await invite.getByLabel('Work email').fill(invitee);
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(hr.getByText(`Invitation emailed to ${invitee}.`, { exact: false })).toBeVisible();
  const mail = await linkFromLatestEmail(invitee, since, /\/auth\/callback\?token_hash=/);
  expect(mail.subject).toBe(`Welcome aboard PeopleCore Demo (synthetic data) ${run}`);
  expect(mail.html).toContain('background:#0a66f0');
  expect(mail.text).toContain(`Acme people team ${run}`);

  // Back to the standard text.
  await platform.getByRole('button', { name: 'Back to the standard text' }).click();
  await expect(platform.getByText('Invitation is back to the standard text.')).toBeVisible();
  await expect(subject).toHaveValue('You’re invited to join {{organization}} on {{brand}}');
});

test('only platform admins can open the templates', async ({ page }) => {
  await signIn(page, 'demo.hr');
  const res = await page.goto('/platform/emails');
  expect(res?.status()).toBe(404);
});
