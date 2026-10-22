import { expect } from '@playwright/test';
import { adminClient, expectNotFound, open, signIn, test } from './helpers';

/**
 * Organization setup on the demo tenant: the owner sees how much is done on the dashboard and in the sidebar, opens
 * the checklist, confirms a default ("Looks right") and marks an optional step "Not needed", and the percentage
 * moves; an employee sees none of it. The demo company's own marks are put back afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';
let saved: Array<{ step_key: string; status: string; note: string | null; done_at: string }> = [];

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  saved = (await admin.from('org_setup_steps').select('step_key, status, note, done_at').eq('organization_id', orgId)).data ?? [];
  // Weekly offs and approvals start from defaults and are never "done" by data alone: both start as to do here.
  await admin.from('org_setup_steps').delete().eq('organization_id', orgId).in('step_key', ['work_week', 'flows']);
});

test.afterAll(async () => {
  await admin.from('org_setup_steps').delete().eq('organization_id', orgId);
  if (saved.length) await admin.from('org_setup_steps').insert(saved.map((s) => ({ ...s, organization_id: orgId })));
});

test('the owner follows setup from the dashboard and finishes steps on the checklist', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo');
  const card = page.getByRole('region', { name: 'Organization setup' });
  await expect(card.getByText(/^\d+%/)).toBeVisible();
  await expect(card.getByRole('list', { name: 'Next setup steps' }).getByRole('listitem').first()).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: /Organization setup/ })).toBeVisible();

  await card.getByRole('link', { name: /^See all \d+ steps/ }).click();
  await page.waitForURL(/\/app\/demo\/setup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Organization setup' })).toBeVisible();
  const bar = page.getByRole('progressbar', { name: 'Setup progress' });
  const before = Number(await bar.getAttribute('aria-valuenow'));

  await expect(page.getByRole('listitem', { name: 'Weekly offs: to do' })).toBeVisible();
  await page.getByRole('form', { name: 'Looks right: Weekly offs' }).getByRole('button', { name: 'Looks right' }).click();
  await expect(page.getByRole('listitem', { name: 'Weekly offs: done' })).toBeVisible();
  await page.getByRole('form', { name: 'Not needed: Who approves what' }).getByRole('button', { name: 'Not needed' }).click();
  await expect(page.getByRole('listitem', { name: 'Who approves what: not needed' })).toBeVisible();
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(before);

  // Each step opens the page where it's done.
  await page.getByRole('link', { name: 'Review: Weekly offs' }).click();
  await page.waitForURL(/\/app\/demo\/attendance\?tab=rules&view=workweek$/);

  // Undo puts a step back on the list.
  await open(page, '/app/demo/setup');
  await page.getByRole('form', { name: 'Undo: Weekly offs' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('listitem', { name: 'Weekly offs: to do' })).toBeVisible();
});

test('employees see no setup card and can’t open the checklist', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Organization setup' })).toHaveCount(0);
  await open(page, '/app/demo/setup');
  await expectNotFound(page);
});
