import { expect, test } from '@playwright/test';
import { adminClient, domain, open, signIn } from './helpers';
import { linkFromLatestEmail, mailpitUrl } from './mailbox';

/**
 * Email journeys: sign-in links and invitations, read from the local test inbox. They run against the
 * local Supabase stack (CI, or `supabase start`), where every email is captured; the live project's demo
 * addresses (example.test) can't receive mail, so there they are skipped.
 */
test.describe.configure({ mode: 'serial' });
test.skip(!mailpitUrl, 'Needs the local Supabase test inbox (MAILPIT_URL)');

const run = Date.now().toString(36).slice(-5).toUpperCase();
const invitee = `e2e.invitee.${run.toLowerCase()}@${domain}`;
const admin = adminClient();

test.afterAll(async () => {
  if (!mailpitUrl) return;
  for (let page = 1; page <= 5; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const user = data.users.find((u) => u.email === invitee);
    if (user) {
      await admin.from('organization_members').delete().eq('user_id', user.id);
      await admin.auth.admin.deleteUser(user.id);
      break;
    }
    if (data.users.length < 1000) break;
  }
});

test('an employee signs in with an emailed link', async ({ page }) => {
  const email = `demo.employee@${domain}`;
  const since = new Date(Date.now() - 1000);
  await open(page, '/login');
  await page.getByRole('button', { name: 'Sign in with an email link instead' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('If that email has a PeopleCore account, a sign-in link is on its way.')).toBeVisible();

  const { link } = await linkFromLatestEmail(email, since, /\/auth\/v1\/verify/);
  await page.goto(link); // same browser: the PKCE verifier cookie set by the request completes the sign-in
  await page.waitForURL(/\/app\/demo(\/|$|\?)/); // one organization: straight into it
});

test('a link for an address without an account sends nothing and reveals nothing', async ({ page }) => {
  const email = `nobody.${run.toLowerCase()}@${domain}`;
  await open(page, '/login');
  await page.getByRole('button', { name: 'Sign in with an email link instead' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('If that email has a PeopleCore account, a sign-in link is on its way.')).toBeVisible();
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  expect(((await res.json()) as { messages: unknown[] }).messages).toHaveLength(0);
});

test('HR invites a new person, who accepts from the email and lands in the organization', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/members');
  const since = new Date(Date.now() - 1000);
  const invite = hr.locator('form').filter({ has: hr.getByRole('button', { name: 'Send invitation' }) });
  await invite.getByLabel('Work email').fill(invitee);
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(hr.getByText(`Invitation emailed to ${invitee}.`, { exact: false })).toBeVisible();

  const { subject, link } = await linkFromLatestEmail(invitee, since, /\/auth\/callback\?token_hash=/);
  expect(subject).toBe('You’ve been invited to PeopleCore');

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await guest.waitForURL(/\/app\/demo(\/|$|\?)/); // invitation accepted on first sign-in

  const user = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === invitee)!;
  const { data: member } = await admin.from('organization_members').select('status').eq('user_id', user.id).single();
  expect(member?.status).toBe('active');

  // The link works once.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await again.waitForURL(/\/login\?error=link/);
});
