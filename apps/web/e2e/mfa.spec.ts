import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { totp } from '../scripts/lib/totp';
import { adminClient, domain, liveEnv, open, signIn, test } from './helpers';

/**
 * Two-step sign-in is off until the owner turns it on in Settings › Controls; then everyone in the organization sets
 * it up at their next sign-in, whatever their role. Uses a throwaway employee account (deleted afterwards, with its
 * authenticator) and puts the demo company's switch back off.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const email = `e2e.staff.${run}@${domain}`;
const admin = adminClient();
let orgId = '';
let userId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: liveEnv().password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the test account: ${error?.message}`);
  userId = data.user.id;
  const member = await admin.from('organization_members').insert({ organization_id: orgId, user_id: userId, status: 'active' }).select('id').single();
  const role = await admin.from('roles').select('id').eq('organization_id', orgId).eq('key', 'employee').single();
  await admin.from('member_roles').insert({ organization_id: orgId, member_id: member.data!.id, role_id: role.data!.id });
});

test.afterAll(async () => {
  await admin.from('org_controls').update({ require_mfa: false }).eq('organization_id', orgId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function signInWithPassword(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.locator('input[name="password"]').fill(liveEnv().password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('with two-step off, a new employee signs in with their password alone', async ({ page }) => {
  await signInWithPassword(page);
  await page.waitForURL(/\/app\/demo$/);
  await open(page, '/app/demo/preferences');
  await expect(page.getByRole('region', { name: 'Two-step sign-in' }).getByRole('link', { name: 'Turn on' })).toBeVisible();
});

test('the owner turns it on for everyone; the employee then sets it up before anything else', async ({ page, browser }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=controls');
  const everyone = page.getByRole('form', { name: 'Two-step sign-in for everyone' });
  await everyone.getByRole('button', { name: 'Turn on for everyone' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Two-step sign-in is on for everyone' })).toBeVisible();
  await expect.poll(async () => (await admin.from('org_controls').select('require_mfa').eq('organization_id', orgId).single()).data?.require_mfa).toBe(true);

  const staff = await (await browser.newContext()).newPage();
  await signInWithPassword(staff);
  await staff.waitForURL(/\/mfa\?next=/);
  await expect(staff.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await expect(staff.getByText('Your organization asks everyone to use two-step sign-in.', { exact: false })).toBeVisible();
  await expect(staff.getByRole('link', { name: 'Not now' })).toHaveCount(0);

  // Going around it leads straight back.
  await staff.goto('/app/demo/leave');
  await expect(staff).toHaveURL(/\/mfa\?next=%2Fapp%2Fdemo$/);

  await staff.waitForLoadState('networkidle');
  await staff.getByRole('button', { name: 'Set up authenticator app' }).click();
  await expect(staff.getByRole('img', { name: /QR code/ })).toBeVisible();
  const secret = (await staff.getByTestId('totp-secret').textContent())!.trim();

  // A wrong code is refused with a clear message.
  await staff.getByLabel('Authentication code').fill('000000');
  await staff.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await expect(staff.getByText('That code didn’t work.', { exact: false })).toBeVisible();

  await staff.getByLabel('Authentication code').fill(totp(secret));
  await staff.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await staff.waitForURL(/\/app\/demo$/);
  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  expect(data!.factors.filter((f) => f.status === 'verified')).toHaveLength(1);

  // While the organization requires it, nobody can turn their own off.
  await open(staff, '/app/demo/preferences');
  const panel = staff.getByRole('region', { name: 'Two-step sign-in' });
  await expect(panel.getByText('Your organization requires it for everyone.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Turn off' })).toHaveCount(0);

  // The owner turns it off again; people who set it up keep it until they turn it off themselves.
  await open(page, '/app/demo/settings?tab=controls');
  await page.getByRole('form', { name: 'Two-step sign-in for everyone' }).getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Two-step sign-in is off' })).toBeVisible();
  await open(staff, '/app/demo/preferences');
  await panel.getByRole('button', { name: 'Turn off' }).click();
  await panel.getByRole('button', { name: 'Yes, turn it off' }).click();
  await expect(staff.getByText('Two-step sign-in is off. Your password alone opens your account.')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Turn on' })).toBeVisible();
  await expect.poll(async () => (await admin.auth.admin.mfa.listFactors({ userId })).data!.factors.filter((f) => f.status === 'verified').length).toBe(0);
});

test('a sign-in ended elsewhere gets a clean "sign in again" instead of an error', async ({ page }) => {
  await admin.from('org_controls').update({ require_mfa: true }).eq('organization_id', orgId);
  await signInWithPassword(page);
  await page.waitForURL(/\/mfa(\?|$)/);

  // End every session for this account from another client, as "sign out everywhere" would. The browser's
  // token stays valid until it expires, but the server no longer knows the session.
  const other = createClient(liveEnv().url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  expect((await other.auth.signInWithPassword({ email, password: liveEnv().password })).error).toBeNull();
  await other.auth.signOut({ scope: 'global' });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Your sign-in has ended' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.getByLabel('Work email')).toBeVisible();
});
