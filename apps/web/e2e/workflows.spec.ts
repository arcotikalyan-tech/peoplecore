import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Workflow builder on the live demo tenant: HR builds a workflow for approved leave (notify the manager, give the
 * employee a task), sees a validation message for an empty step, saves it switched off, then adds a wait step,
 * which saves version 2. Running is covered by the database tests (it happens in the worker). Removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const name = `Leave cover check ${run}`;
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
});

test.afterAll(async () => {
  await admin.from('workflow_definitions').update({ current_version_id: null }).eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('workflow_definitions').delete().eq('organization_id', orgId).like('name', `%${run}%`);
});

test('HR builds a workflow, fixes a step, and saves a new version', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/workflows');
  await page.getByRole('link', { name: 'New workflow' }).click();
  const form = page.getByRole('form', { name: 'New workflow' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Starts when').selectOption('leave.approved');
  const first = form.getByRole('listitem', { name: 'Step 1: Notify someone' });
  await first.getByLabel('Who').selectOption('manager');
  await form.getByLabel('Add a step').selectOption('task');
  await form.getByRole('button', { name: 'Add step' }).click();
  const second = form.getByRole('listitem', { name: 'Step 2: Create a task' });
  await second.getByLabel('Assign to').selectOption('employee');
  await second.getByLabel('Task').fill('Hand over your open work before your leave');
  await second.getByLabel('Due in (days)').fill('1');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Step 1: give it a title (up to 150 characters).')).toBeVisible();

  await first.getByLabel('Message title').fill('{{employee}} is on leave: check cover');
  await form.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({ hasText: 'Saved. It’s switched off until you turn it on.' })).toBeVisible();
  await expect(page.getByText('Version 1')).toBeVisible();

  const edit = page.getByRole('form', { name: 'Edit workflow' });
  await expect(edit.getByLabel('Starts when')).toBeDisabled();
  await edit.getByLabel('Add a step').selectOption('wait');
  await edit.getByRole('button', { name: 'Add step' }).click();
  await edit.getByRole('listitem', { name: 'Step 3: Wait' }).getByLabel('Days').fill('2');
  await edit.getByRole('button', { name: 'Move step 3 up' }).click();
  await expect(edit.getByRole('listitem', { name: 'Step 2: Wait' })).toBeVisible();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByText('Version 2')).toBeVisible();

  const def = (await admin.from('workflow_definitions').select('id, is_active, current_version_id').eq('organization_id', orgId).eq('name', name).single()).data!;
  expect(def.is_active).toBe(false);
  const ver = (await admin.from('workflow_versions').select('version, steps').eq('id', def.current_version_id!).single()).data!;
  expect(ver.version).toBe(2);
  expect((ver.steps as Array<{ type: string }>).map((s) => s.type)).toEqual(['notify', 'wait', 'task']);
  await expect(page.getByRole('table', { name: 'Runs' }).getByText('No runs yet.')).toBeVisible();
});
