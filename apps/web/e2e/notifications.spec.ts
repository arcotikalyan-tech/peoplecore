import { expect } from '@playwright/test';
import { adminClient, domain, open, signIn, test } from './helpers';

/**
 * Notifications are read once they've been seen, not by a button: the list on screen for a moment marks them, and
 * nothing else does. (The phone's Inbox does the same from the same rule, @peoplecore/shared/notifications.)
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let userId = '';

async function notify(title: string, link?: string) {
  const { data, error } = await admin.from('notifications')
    .insert({ organization_id: orgId, user_id: userId, kind: 'test.seen', title: `${title} ${run}`, link: link ?? null }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}
const readAt = async (id: string) => (await admin.from('notifications').select('read_at').eq('id', id).single()).data?.read_at ?? null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  userId = data.users.find((u) => u.email === `demo.employee@${domain}`)!.id;
});

test.afterAll(async () => {
  await admin.from('notifications').delete().eq('organization_id', orgId).eq('kind', 'test.seen').like('title', `%${run}`);
});

test('another page leaves them unread; the Inbox marks them read, they look read at once, and a later one stays unread', async ({ page }) => {
  const first = await notify('Your request was approved');
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  const badge = page.getByRole('link', { name: /^Inbox, \d+ unread$/ });
  await expect(badge).toBeVisible();
  await page.waitForTimeout(2500); // longer than the moment that counts as seen, on a page that doesn't show them
  expect(await readAt(first)).toBeNull();

  await badge.click();
  const list = page.getByRole('list', { name: 'Notifications' });
  const row = list.getByRole('listitem').filter({ hasText: `Your request was approved ${run}` });
  await expect(row).toBeVisible();
  await expect.poll(() => readAt(first), { timeout: 20_000 }).not.toBeNull();
  await expect(badge).toHaveCount(0); // the count goes with them
  await expect(row).not.toHaveAttribute('data-new', 'true'); // looks read without leaving the page
  await expect(page.getByText('All caught up')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);

  // Arrives after the list was read: not on screen yet, so not seen.
  const later = await notify('Your payslip is ready');
  await page.waitForTimeout(2500);
  expect(await readAt(later)).toBeNull();
  await open(page, '/app/demo/inbox');
  await expect(list.getByRole('listitem').filter({ hasText: `Your payslip is ready ${run}` })).toBeVisible();
  await expect.poll(() => readAt(later), { timeout: 20_000 }).not.toBeNull();
  await page.reload();
  await expect(row).not.toHaveAttribute('data-new', 'true');
});

test('opening one straight away still counts as having seen them', async ({ page }) => {
  await signIn(page, 'demo.employee');
  const quick = await notify('Your leave was approved', '/leave');
  await page.goto('/app/demo/inbox');
  await page.getByRole('link', { name: `Your leave was approved ${run}` }).click();
  await page.waitForURL(/\/app\/demo\/leave/);
  await expect.poll(() => readAt(quick), { timeout: 20_000 }).not.toBeNull();
});
