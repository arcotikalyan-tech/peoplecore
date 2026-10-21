import { expect } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

/**
 * Settings on the demo tenant (as the owner): the setup wizard, switching a module off and on, controls,
 * notification categories, a custom role in the capability matrix, and a support access window. Everything
 * changed here is restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let controlsBefore: { block_self_edit: boolean; salary_history_visible: boolean; birthdays_visible: boolean } | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  controlsBefore = (await admin.from('org_controls').select('block_self_edit, salary_history_visible, birthdays_visible').eq('organization_id', orgId).single()).data;
});

test.afterAll(async () => {
  await admin.from('org_modules').delete().eq('organization_id', orgId);
  await admin.from('notification_settings').delete().eq('organization_id', orgId);
  if (controlsBefore) await admin.from('org_controls').update(controlsBefore).eq('organization_id', orgId);
  await admin.from('roles').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('support_access_windows').delete().eq('organization_id', orgId).gte('starts_at', startedAt);
});

test('the owner reviews setup, switches a module off and on, and sets controls and notifications', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=setup');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toBeVisible();

  await open(page, '/app/demo/settings?tab=modules');
  const modules = page.getByRole('form', { name: 'Modules' });
  await modules.getByLabel('Loans').uncheck();
  await modules.getByRole('button', { name: 'Save modules' }).click();
  await expect(modules.getByText('Saved. 1 module switched off.')).toBeVisible();
  await open(page, '/app/demo/loans');
  await expectNotFound(page);
  await open(page, '/app/demo/settings?tab=modules');
  await page.getByRole('form', { name: 'Modules' }).getByLabel('Loans').check();
  await page.getByRole('form', { name: 'Modules' }).getByRole('button', { name: 'Save modules' }).click();
  await expect(page.getByText('Saved. 0 modules switched off.')).toBeVisible();
  await open(page, '/app/demo/loans');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await open(page, '/app/demo/settings?tab=controls');
  const controls = page.getByRole('form', { name: 'Controls' });
  await controls.getByLabel('Show upcoming birthdays on the dashboard').uncheck();
  await controls.getByRole('button', { name: 'Save controls' }).click();
  await expect(controls.getByText('Controls saved.')).toBeVisible();
  await open(page, '/app/demo');
  await expect(page.getByText('🎂 Upcoming Birthdays')).toHaveCount(0);

  await open(page, '/app/demo/settings?tab=notifications');
  const notes = page.getByRole('form', { name: 'Notification categories' });
  await notes.getByLabel('Loans').uncheck();
  await notes.getByRole('button', { name: 'Save notifications' }).click();
  await expect(notes.getByText('Notification settings saved.')).toBeVisible();
});

test('the owner creates a custom role, grants a permission, and opens and closes support access', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=roles');
  const role = page.getByRole('form', { name: 'New role' });
  await role.getByLabel('Role name').fill(`Finance desk ${run}`);
  await role.getByRole('button', { name: '＋ Create role' }).click();
  await expect(role.getByText(`Role Finance desk ${run} created.`, { exact: false })).toBeVisible();
  // The scope select saves on change, which needs the page hydrated after the reload.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('combobox', { name: `Finance desk ${run}: expense.manage` }).selectOption('org');
  await expect.poll(async () => (await admin.from('role_permissions').select('scope, roles!inner(name)').eq('organization_id', orgId)
    .eq('permission_key', 'expense.manage').eq('roles.name', `Finance desk ${run}`)).data?.[0]?.scope).toBe('org');

  await open(page, '/app/demo/settings?tab=support');
  const support = page.getByRole('form', { name: 'Open support access' });
  await support.getByLabel('What support is helping with').fill(`Payroll setup ${run}`);
  await support.getByRole('button', { name: 'Open support access' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Support access is open for 24 hours.' }).first()).toBeVisible();
  await page.getByRole('form', { name: 'Close support access' }).getByRole('button', { name: 'Close support access now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Support access closed.' }).first()).toBeVisible();
});
