import { expect, test } from '@playwright/test';
import { adminClient, domain, expectNotFound, liveEnv, open, signIn } from './helpers';

/**
 * Member administration on the live demo tenant. Uses a throwaway sign-in account created for this run
 * (an *existing* account, so no invitation email is sent) and deleted afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const local = `e2e.member.${run}`;
const email = `${local}@${domain}`;
const admin = adminClient();
let orgId = '';
let userId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: liveEnv().password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the test account: ${error?.message}`);
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId); // memberships cascade
});

async function memberRoleKeys(): Promise<string[]> {
  const member = await admin.from('organization_members').select('id').eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
  if (!member.data) return [];
  const [grants, roles] = await Promise.all([
    admin.from('member_roles').select('role_id').eq('member_id', member.data.id),
    admin.from('roles').select('id, key').eq('organization_id', orgId),
  ]);
  return grants.data!.map((g) => roles.data!.find((r) => r.id === g.role_id)!.key).sort();
}

test('HR invites, re-roles, suspends and removes a member, and cannot touch the owner', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/members');

  // HR is only offered everyday roles; Employee is pre-selected.
  const invite = hr.locator('form').filter({ has: hr.getByRole('button', { name: 'Send invitation' }) });
  await expect(invite.getByRole('checkbox', { name: /^HR administrator/ })).toHaveCount(0);
  await expect(invite.getByRole('checkbox', { name: /^Organization owner/ })).toHaveCount(0);
  await expect(invite.getByRole('checkbox', { name: /^Employee/ })).toBeChecked();

  await invite.getByLabel('Work email').fill(email);
  await invite.getByRole('checkbox', { name: /^Reporting manager/ }).check();
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(hr.getByText(`${email} already has a PeopleCore sign-in and was added.`, { exact: false })).toBeVisible();

  const row = hr.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Invited', { exact: true })).toBeVisible();
  expect(await memberRoleKeys()).toEqual(['employee', 'manager']);

  // The owner's row offers HR no actions at all.
  const ownerRow = hr.getByRole('row').filter({ hasText: 'demo.owner@' });
  await expect(ownerRow.getByText('Managed by an owner')).toBeVisible();
  await expect(ownerRow.getByRole('button')).toHaveCount(0);

  // The invitee signs in: the invitation is accepted and they land in the organization.
  const member = await (await browser.newContext()).newPage();
  await signIn(member, local);
  await member.waitForURL(/\/app\/demo$/);
  await expect(member.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await hr.reload();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  // HR removes the manager role.
  await row.getByRole('button', { name: 'Edit roles' }).click();
  await row.getByRole('checkbox', { name: /^Reporting manager/ }).uncheck();
  await row.getByRole('button', { name: 'Save roles' }).click();
  await expect(row.getByText('Reporting manager')).toHaveCount(0);
  expect(await memberRoleKeys()).toEqual(['employee']);

  // HR suspends the member: their access stops at once.
  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
  await member.goto('/app/demo');
  await expectNotFound(member);

  // HR removes the member.
  await row.getByRole('button', { name: 'Remove' }).click();
  await row.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(hr.getByRole('row').filter({ hasText: email })).toHaveCount(0);
  expect(await memberRoleKeys()).toEqual([]);
});
