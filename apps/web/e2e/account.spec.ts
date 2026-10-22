import { expect, type Page } from '@playwright/test';
import { adminClient, domain, liveEnv, open, signIn, test } from './helpers';
import { linkFromLatestEmail, mailpitUrl } from './mailbox';

/**
 * Account basics on the demo tenant, with throwaway accounts (deleted afterwards): changing the password in Account
 * settings, HR linking a member to their employee record, and, against the local test inbox, "Forgot password?" and
 * a new employee who is invited as they're added and chooses a password before anything else.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const email = `e2e.account.${run}@${domain}`;
const hire = { first: 'Nila', last: `Hire${run}`, email: `e2e.hire.${run}@${domain}` };
const admin = adminClient();
const passwords = { current: liveEnv().password, changed: `Changed-${run}-pass-7`, reset: `Reset-${run}-pass-8` };
let orgId = '';
let userId = '';
const cleanup: { employees: string[]; users: string[] } = { employees: [], users: [] };

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: passwords.current, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the test account: ${error?.message}`);
  userId = data.user.id;
  cleanup.users.push(userId);
  const member = await admin.from('organization_members').insert({ organization_id: orgId, user_id: userId, status: 'active' }).select('id').single();
  const role = await admin.from('roles').select('id').eq('organization_id', orgId).eq('key', 'employee').single();
  await admin.from('member_roles').insert({ organization_id: orgId, member_id: member.data!.id, role_id: role.data!.id });
});

test.afterAll(async () => {
  if (cleanup.employees.length) await admin.from('employees').delete().in('id', cleanup.employees);
  for (const id of cleanup.users) {
    await admin.from('organization_members').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
});

async function signInAs(page: Page, address: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(address);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a person changes their password in Account settings; the old one stops working', async ({ page, browser }) => {
  await signInAs(page, email, passwords.current);
  await page.waitForURL(/\/app\/demo$/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Account settings' }).click();
  await page.waitForURL(/\/app\/demo\/preferences$/);
  await page.waitForLoadState('networkidle');

  const form = page.getByRole('form', { name: 'Change password' });
  const fill = async (current: string) => {
    await form.getByLabel('Current password').fill(current);
    await form.getByLabel(/^New password/).fill(passwords.changed);
    await form.getByLabel('Confirm new password').fill(passwords.changed);
    await form.getByRole('button', { name: 'Change password' }).click();
  };
  await fill('not-my-password');
  await expect(form.getByText('That isn’t your current password')).toBeVisible();
  await fill(passwords.current);
  await expect(form.getByText('Password changed. You’ve been signed out on your other devices.')).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await signInAs(other, email, passwords.current);
  await expect(other.getByText('Incorrect email or password.')).toBeVisible();
  await signInAs(other, email, passwords.changed);
  await other.waitForURL(/\/app\/demo$/);
});

test('HR links a member who has no employee record to theirs, so they can punch in', async ({ page }) => {
  const record = (await admin.from('employees').insert({
    organization_id: orgId, employee_code: `E2E${run.toUpperCase()}`, first_name: 'Linked', last_name: `Member${run}`,
    work_email: `e2e.other.${run}@${domain}`, status: 'active', employment_type: 'permanent', date_of_joining: '2026-10-01',
  }).select('id').single()).data!;
  cleanup.employees.push(record.id);

  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/members');
  const link = page.getByRole('form', { name: `Link ${email} to an employee record` });
  await link.getByLabel(`Employee record for ${email}`).selectOption(record.id);
  await link.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText(`Employee: Linked Member${run}`)).toBeVisible();
  expect((await admin.from('employees').select('user_id').eq('id', record.id).single()).data!.user_id).toBe(userId);
});

test('“Forgot password?” emails a link that works on another device', async ({ page, browser }) => {
  test.skip(!mailpitUrl, 'Needs the local Supabase test inbox (MAILPIT_URL)');
  const since = new Date(Date.now() - 1000);
  await open(page, '/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.waitForURL(/\/forgot-password$/);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(page.getByText('If that email has a PeopleCore account, a link to choose a new password is on its way.', { exact: false })).toBeVisible();

  const { link } = await linkFromLatestEmail(email, since, /\/auth\/v1\/verify/);
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(link);
  await phone.waitForURL(/\/set-password\?/);
  await expect(phone.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await phone.getByLabel(/^New password/).fill(passwords.reset);
  await phone.getByLabel('Confirm new password').fill(passwords.reset);
  await phone.getByRole('button', { name: 'Save new password' }).click();
  await phone.waitForURL(/\/app\/demo$/);
  await expect(phone.getByText('Password saved.', { exact: false })).toBeVisible();

  const later = await (await browser.newContext()).newPage();
  await signInAs(later, email, passwords.reset);
  await later.waitForURL(/\/app\/demo$/);
});

test('HR adds an employee and invites them; they choose a password before anything else', async ({ page, browser }) => {
  test.skip(!mailpitUrl, 'Needs the local Supabase test inbox (MAILPIT_URL)');
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees/new');
  await page.getByLabel('First name').fill(hire.first);
  await page.getByLabel('Last name').fill(hire.last);
  await page.getByLabel('Work email').fill(hire.email);
  await page.getByLabel('Date of joining').fill('2026-10-01');
  await expect(page.getByLabel('Invite them to sign in')).toBeChecked();
  const since = new Date(Date.now() - 1000);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await page.waitForURL(/\/app\/demo\/employees\/[0-9a-f-]{36}\?created=1$/);
  const employeeId = /employees\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  cleanup.employees.push(employeeId);
  await expect(page.getByText(`Employee added and invited: ${hire.email} gets an email to set a password.`)).toBeVisible();

  const { link } = await linkFromLatestEmail(hire.email, since, /\/auth\/callback\?token_hash=/);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await guest.waitForURL(/\/set-password\?next=/);
  await expect(guest.getByRole('heading', { name: 'Welcome to PeopleCore' })).toBeVisible();
  // Going around it leads straight back.
  await guest.goto('/app/demo/leave');
  await guest.waitForURL(/\/set-password\?next=/);
  await guest.getByLabel(/^New password/).fill(passwords.reset);
  await guest.getByLabel('Confirm new password').fill(passwords.reset);
  await guest.getByRole('button', { name: 'Set password and continue' }).click();
  await guest.waitForURL(/\/app\/demo(\/|$|\?)/);

  const { data: emp } = await admin.from('employees').select('user_id').eq('id', employeeId).single();
  expect(emp!.user_id).not.toBeNull();
  cleanup.users.push(emp!.user_id!);
  await open(guest, '/app/demo/attendance');
  await expect(guest.getByRole('button', { name: 'Check in' }).first()).toBeVisible();
});
