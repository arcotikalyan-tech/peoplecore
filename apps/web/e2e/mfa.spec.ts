import { expect } from '@playwright/test';
import { totp } from '../scripts/lib/totp';
import { adminClient, domain, liveEnv, open, test } from './helpers';

/**
 * A brand-new HR administrator must set up two-step verification before any HR data is reachable.
 * Uses a throwaway account (deleted afterwards, with its authenticator).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const email = `e2e.admin.${run}@${domain}`;
const admin = adminClient();
let userId = '';

test.beforeAll(async () => {
  const orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: liveEnv().password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the test account: ${error?.message}`);
  userId = data.user.id;
  const member = await admin.from('organization_members').insert({ organization_id: orgId, user_id: userId, status: 'active' }).select('id').single();
  const role = await admin.from('roles').select('id').eq('organization_id', orgId).eq('key', 'hr_admin').single();
  await admin.from('member_roles').insert({ organization_id: orgId, member_id: member.data!.id, role_id: role.data!.id });
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test('a new HR admin sets up two-step verification before seeing any HR data', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(liveEnv().password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/mfa\?next=/);
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();

  // Going around it leads straight back.
  await page.goto('/app/demo/employees');
  await expect(page).toHaveURL(/\/mfa\?next=%2Fapp%2Fdemo$/);

  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();

  // A wrong code is refused with a clear message.
  await page.getByLabel('Authentication code').fill('000000');
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await expect(page.getByText('That code didn’t work.', { exact: false })).toBeVisible();

  await page.getByLabel('Authentication code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.waitForURL(/\/app\/demo$/);

  await open(page, '/app/demo/members');
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  expect(data!.factors.filter((f) => f.status === 'verified')).toHaveLength(1);
});
