import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Policy drafts and the Employees overview's figures on the demo tenant. HR adds the starter policies as drafts,
 * can't publish one with [[parts]] still to fill in, fills them in and publishes; an employee sees the published policy
 * and never the drafts. The overview's figures open their lists. Drafts and the published policy are removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
const TITLE = 'Code of conduct';
let orgId = '';
let hadPolicy = false;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  hadPolicy = !!(await admin.from('policy_documents').select('id').eq('organization_id', orgId).eq('title', TITLE).maybeSingle()).data;
  await admin.from('policy_drafts').delete().eq('organization_id', orgId);
});

test.afterAll(async () => {
  await admin.from('policy_drafts').delete().eq('organization_id', orgId);
  if (!hadPolicy) {
    const ids = ((await admin.from('policy_documents').select('id').eq('organization_id', orgId).eq('title', TITLE)).data ?? []).map((p) => p.id);
    if (ids.length) {
      await admin.from('policy_acknowledgements').delete().in('policy_id', ids);
      await admin.from('policy_documents').delete().in('id', ids);
    }
  }
});

test('HR drafts from the starter policies and publishes one once it is filled in', async ({ page }) => {
  test.skip(hadPolicy, 'The demo tenant already has a published Code of conduct');
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/policies');
  const drafts = page.getByRole('region', { name: 'Drafts' });
  await drafts.getByRole('button', { name: /^Add \d+ starter policies$/ }).click();
  await expect(page.getByText(/11 starter policies added as drafts/)).toBeVisible();
  const list = drafts.getByRole('list', { name: 'Policy drafts' });
  await expect(list.getByRole('listitem')).toHaveCount(11);

  const item = list.getByRole('listitem').filter({ has: page.locator('summary').getByText(TITLE, { exact: true }) });
  await item.locator('summary').click();
  await item.getByRole('form', { name: `Publish ${TITLE}` }).getByRole('button', { name: 'Publish' }).click();
  await expect(item.getByRole('form', { name: `Publish ${TITLE}` }).getByRole('alert')).toContainText('Fill in the parts in double brackets first');

  const edit = item.getByRole('form', { name: `Edit draft ${TITLE}` });
  const body = edit.getByRole('textbox', { name: /Policy text/ });
  await body.fill((await body.inputValue()).replace('[[company name]]', 'PeopleCore Demo').replace('[[amount]]', '₹2,000'));
  await edit.getByRole('button', { name: 'Save draft' }).click();
  await expect(edit.getByRole('status')).toContainText('Draft saved');

  await item.getByRole('form', { name: `Publish ${TITLE}` }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(10);
});

test('an employee sees the published policy and no drafts', async ({ page }) => {
  test.skip(hadPolicy, 'The demo tenant already has a published Code of conduct');
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/policies');
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByText('PeopleCore Demo')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Drafts' })).toHaveCount(0);
  await expect(page.getByText('Expense and travel reimbursement')).toHaveCount(0); // still a draft
});

test('the overview’s figures open the lists behind them', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/employees');
  await page.getByRole('link', { name: /^Profile gaps:/ }).click();
  await expect(page).toHaveURL(/flag=incomplete/);
  await expect(page.getByText(/Showing people (with no PAN on file|without a department or designation)/)).toBeVisible();

  await open(page, '/app/demo/employees');
  await page.getByRole('link', { name: /^Notice:/ }).click();
  await expect(page).toHaveURL(/status=on_notice/);
  await open(page, '/app/demo/employees');
  await page.getByRole('link', { name: /^Headcount:/ }).click();
  await expect(page).toHaveURL(/tab=people/);
});
