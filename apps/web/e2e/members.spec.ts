import { expect } from '@playwright/test';
import { adminClient, domain, expectNotFound, liveEnv, open, signIn, test } from './helpers';

/**
 * Member administration on the live demo tenant. Uses throwaway sign-in accounts created for this run
 * (*existing* accounts, so no invitation email is sent) and deleted afterwards, with the employee records added for them.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const local = `e2e.member.${run}`;
const email = `${local}@${domain}`;
const unrecorded = `e2e.norecord.${run}@${domain}`;
const admin = adminClient();
let orgId = '';
let userId = '';
let unrecordedId = '';

async function createAccount(address: string) {
  const { data, error } = await admin.auth.admin.createUser({ email: address, password: liveEnv().password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the test account: ${error?.message}`);
  return data.user.id;
}

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  userId = await createAccount(email);
  unrecordedId = await createAccount(unrecorded);
});

test.afterAll(async () => {
  await admin.from('employees').delete().eq('organization_id', orgId).in('work_email', [email, unrecorded]);
  for (const id of [userId, unrecordedId]) if (id) await admin.auth.admin.deleteUser(id); // memberships cascade
});

async function recordUser(address: string) {
  return (await admin.from('employees').select('user_id').eq('organization_id', orgId).eq('work_email', address).maybeSingle()).data;
}

async function memberRoleKeys(): Promise<string[]> {
  const member = await admin.from('organization_members').select('id').eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
  if (!member.data) return [];
  const [grants, roles] = await Promise.all([
    admin.from('member_roles').select('role_id').eq('member_id', member.data.id),
    admin.from('roles').select('id, key').eq('organization_id', orgId),
  ]);
  return grants.data!.map((g) => roles.data!.find((r) => r.id === g.role_id)!.key).sort();
}

test('HR invites someone with their employee record, re-roles, suspends and removes them, and cannot touch the owner', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/members');

  // HR is only offered everyday roles; Employee is pre-selected.
  const invite = hr.locator('form').filter({ has: hr.getByRole('button', { name: 'Send invitation' }) });
  await expect(invite.getByRole('checkbox', { name: /^HR administrator/ })).toHaveCount(0);
  await expect(invite.getByRole('checkbox', { name: /^Organization owner/ })).toHaveCount(0);
  await expect(invite.getByRole('checkbox', { name: /^Employee/ })).toBeChecked();

  // A new record is the default (Settings › Controls adds one for everyone): without a first name nothing is sent.
  await invite.getByLabel('Work email').fill(email);
  await expect(invite.getByRole('checkbox', { name: /^Add their employee record/ })).toBeChecked();
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(invite.getByText('First name is required')).toBeVisible();
  expect(await memberRoleKeys()).toEqual([]);
  expect(await recordUser(email)).toBeNull();

  await invite.getByLabel('First name').fill('E2E');
  await invite.getByLabel('Last name').fill(`Member ${run}`);
  await invite.getByRole('checkbox', { name: /^Reporting manager/ }).check();
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(hr.getByText(`${email} already has a PeopleCore sign-in and was added.`, { exact: false })).toBeVisible();
  await expect(hr.getByText('Their employee record is added under Employees.', { exact: false })).toBeVisible();

  const row = hr.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Invited', { exact: true })).toBeVisible();
  await expect(row.getByText(`Employee: E2E Member ${run}`)).toBeVisible();
  expect(await memberRoleKeys()).toEqual(['employee', 'manager']);
  expect((await recordUser(email))?.user_id).toBe(userId);

  // The owner's row offers HR no actions at all.
  const ownerRow = hr.getByRole('row').filter({ hasText: 'demo.owner@' });
  await expect(ownerRow.getByText('Managed by an owner')).toBeVisible();
  await expect(ownerRow.getByRole('button')).toHaveCount(0);

  // The invitee signs in: the invitation is accepted and they land in the organization.
  const member = await (await browser.newContext()).newPage();
  await signIn(member, local);
  await member.waitForURL(/\/app\/demo$/);
  await expect(member.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
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

test('someone with the Employee role but no record is flagged under Employees, and adding the record links their sign-in', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/members');
  const invite = hr.locator('form').filter({ has: hr.getByRole('button', { name: 'Send invitation' }) });
  await invite.getByLabel('Work email').fill(unrecorded);
  // Unticking leaves the record out and marks them as not an employee (an accountant, an auditor); Undo takes it back.
  await invite.getByRole('checkbox', { name: /^Add their employee record/ }).uncheck();
  await expect(invite.getByText('No employee record: they can sign in with their roles', { exact: false })).toBeVisible();
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(hr.getByText(`${unrecorded} already has a PeopleCore sign-in and was added. Access starts the next time they open PeopleCore. They have no employee record.`)).toBeVisible();
  const row = hr.getByRole('row').filter({ hasText: unrecorded });
  await expect(row.getByText('Not an employee: no employee record.')).toBeVisible();
  await row.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByText('No employee record: they can’t punch in, apply for leave or be paid.', { exact: false })).toBeVisible();

  await open(hr, '/app/demo/employees');
  await expect(hr.getByText(/the Employee role but no employee record/)).toBeVisible();
  await hr.getByRole('link', { name: `Add record for ${unrecorded}` }).click();
  await hr.waitForURL(/\/employees\/new\?workEmail=/);
  await expect(hr.getByLabel('Work email')).toHaveValue(unrecorded);
  await hr.getByLabel('First name').fill('E2E');
  await hr.getByLabel('Last name').fill(`Unrecorded ${run}`);
  await hr.getByLabel('Date of joining').fill('2026-01-05');
  await hr.getByRole('button', { name: 'Create employee' }).click();
  await hr.waitForURL(/\/employees\/[0-9a-f-]{36}\?created=1/);
  await expect(hr.getByText(`Employee added and linked to their existing sign-in (${unrecorded}).`)).toBeVisible();
  expect((await recordUser(unrecorded))?.user_id).toBe(unrecordedId);

  await open(hr, '/app/demo/employees');
  await expect(hr.getByRole('link', { name: `Add record for ${unrecorded}` })).toHaveCount(0);
  await open(hr, '/app/demo/members');
  await expect(hr.getByRole('row').filter({ hasText: unrecorded }).getByText(`Employee: E2E Unrecorded ${run}`)).toBeVisible();
});
