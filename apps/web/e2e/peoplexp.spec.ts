import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * PeopleXP on the demo tenant: Dev posts, checks in and recognises a colleague (posted at once) and another with a
 * high-value badge (waits for HR); HR approves it, adds a reward and gives Dev points; Dev redeems and HR fulfils.
 * Posts, recognitions, rewards and redemptions created here are removed afterwards (the points ledger keeps its rows).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let devId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
});

test.afterAll(async () => {
  const rewards = (await admin.from('pxp_rewards').select('id').eq('organization_id', orgId).like('name', `%${run}%`)).data ?? [];
  if (rewards.length) await admin.from('pxp_redemptions').delete().in('reward_id', rewards.map((r) => r.id));
  await admin.from('pxp_rewards').delete().in('id', rewards.map((r) => r.id));
  await admin.from('pxp_posts').delete().eq('organization_id', orgId).like('body', `%${run}%`);
  await admin.from('pxp_pulse').delete().eq('employee_id', devId);
});

test('recognition, approval, points and a reward', async ({ page, browser }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/peoplexp');
  await expect(page.getByRole('heading', { level: 1, name: 'People Experience' })).toBeVisible();

  const post = page.getByRole('form', { name: 'New post' });
  await post.locator('textarea[name="body"]').fill(`Shipped the release ${run}`);
  await post.getByRole('button', { name: '➤ Post' }).click();
  await expect(page.getByText(`Shipped the release ${run}`)).toBeVisible();

  await page.getByRole('form', { name: 'Pulse check-in' }).getByRole('button', { name: /Good/ }).click();
  await expect(page.getByText('Thanks for checking in.')).toBeVisible();

  const rec = page.getByRole('form', { name: 'Recognize' });
  await rec.getByRole('button', { name: /^Rohan/ }).first().click();
  await rec.getByLabel(/Thank you/).check();
  await rec.locator('textarea[name="message"]').fill(`Thanks for the review ${run}`);
  await rec.getByRole('button', { name: '🏅 Recognize' }).click();
  await expect(rec.getByText('Recognition posted 🎉')).toBeVisible();

  await rec.getByRole('button', { name: /^Rohan/ }).first().click();
  await rec.getByLabel(/Above and beyond/).check();
  await rec.locator('textarea[name="message"]').fill(`Saved the launch ${run}`);
  await rec.getByRole('button', { name: '🏅 Recognize' }).click();
  await expect(rec.getByText(/Sent for approval/)).toBeVisible();

  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/peoplexp?tab=recognition');
  const approvals = hr.getByRole('table', { name: 'Recognitions awaiting approval' });
  await approvals.getByRole('row').filter({ hasText: `Saved the launch ${run}` }).getByRole('button', { name: 'Approve' }).click();
  await expect(hr.getByText('Approved and posted.')).toBeVisible();

  await open(hr, '/app/demo/peoplexp?tab=settings&view=rewards');
  const reward = hr.getByRole('form', { name: 'New reward' });
  await reward.locator('input[name="name"]').fill(`Coffee voucher ${run}`);
  await reward.locator('input[name="cost"]').fill('20');
  await reward.getByRole('button', { name: '＋ Add reward' }).click();
  await expect(reward.getByText('Reward saved.')).toBeVisible();
  await open(hr, '/app/demo/peoplexp?tab=settings&view=points');
  const adjust = hr.getByRole('form', { name: 'Adjust points' });
  await adjust.locator('select[name="employeeId"]').selectOption({ label: 'Dev Nair' });
  await adjust.locator('input[name="delta"]').fill('50');
  await adjust.locator('input[name="note"]').fill(`Welcome bonus ${run}`);
  await adjust.getByRole('button', { name: 'Adjust' }).click();
  await expect(adjust.getByText('Points adjusted.')).toBeVisible();

  await open(page, '/app/demo/peoplexp?tab=rewards');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('form', { name: `Redeem Coffee voucher ${run}` }).getByRole('button', { name: 'Redeem' }).click();
  await expect(page.getByText('Reward requested — HR will be in touch.')).toBeVisible();

  await open(hr, '/app/demo/peoplexp?tab=rewards');
  await hr.getByRole('form', { name: `Fulfil Coffee voucher ${run} for Dev Nair` }).getByRole('button', { name: 'Fulfilled' }).click();
  await expect(hr.getByText('Marked fulfilled.')).toBeVisible();
  await hr.context().close();
});
