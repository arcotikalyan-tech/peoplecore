import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Insights and role dashboards on the demo tenant. HR sees organization-wide reports and asks the reporting
 * copilot (test provider: AI_PROVIDER=mock), which answers from the headcount query and shows it; the manager's
 * figures cover only their reporting line; employees get no Insights. Dashboards show what is waiting for
 * each person. AI settings are restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let before: { enabled: boolean; monthly_token_budget: number; hourly_limit_per_user: number } | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  before = (await admin.from('ai_settings').select('enabled, monthly_token_budget, hourly_limit_per_user').eq('organization_id', orgId).maybeSingle()).data;
  await admin.from('ai_settings').upsert({ organization_id: orgId, enabled: true, monthly_token_budget: 2_000_000, hourly_limit_per_user: 30 }, { onConflict: 'organization_id' });
});

test.afterAll(async () => {
  await admin.from('ai_runs').delete().eq('organization_id', orgId).gte('created_at', startedAt);
  if (before) await admin.from('ai_settings').update(before).eq('organization_id', orgId);
  else await admin.from('ai_settings').delete().eq('organization_id', orgId);
});

const activeCount = async () =>
  (await admin.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['active', 'on_notice'])).count!;

test('HR sees organization-wide reports and asks the copilot', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo');
  await expect(page.getByRole('region', { name: 'Needs your attention' }).getByText('Exits in progress')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Insights' }).click();
  await page.waitForURL(/\/insights$/);
  await expect(page.getByText('Workforce figures for the whole organization')).toBeVisible();
  const total = await activeCount();
  await expect(page.getByText(`${total} employed today`)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Joiners and leavers by month' }).getByRole('row')).toHaveCount(13); // header + 12 months

  const ask = page.getByRole('form', { name: 'Ask about your data' });
  await ask.getByLabel('Question').fill('How many people are in each department?');
  await ask.getByRole('button', { name: 'Ask' }).click();
  const answer = page.getByRole('region', { name: 'Answer from your data' });
  await expect(answer).toContainText(`${total} people are employed (the whole organization).`);
  await expect(answer.getByRole('list', { name: 'Figures' }).or(answer.getByLabel('Figures'))).toBeVisible();
  await answer.getByText('How this was worked out').click();
  await expect(answer.getByRole('list', { name: 'Queries' })).toContainText('Headcount (groupBy department)');
  await expect(answer.getByText('Not found in the data')).toHaveCount(0);
});

test('a manager’s figures cover only their reporting line', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, '/app/demo/insights');
  await expect(page.getByText('Workforce figures for your reporting line')).toBeVisible();
  const ask = page.getByRole('form', { name: 'Ask about your data' });
  await ask.getByLabel('Question').fill('Headcount by department in my teams?');
  await ask.getByRole('button', { name: 'Ask' }).click();
  const answer = page.getByRole('region', { name: 'Answer from your data' });
  await expect(answer).toContainText('(only the people in your reporting line)');
  await expect(answer).toContainText('Covers only the people in your reporting line.');
});

test('employees get no Insights; their dashboard shows what is waiting for them', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  const cards = page.getByRole('region', { name: 'Needs your attention' });
  await expect(cards.getByText('Waiting for your approval')).toBeVisible();
  await expect(cards.getByText('Your open tasks')).toBeVisible();
  await expect(cards.getByText('Exits in progress')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Insights' })).toHaveCount(0);
  await open(page, '/app/demo/insights');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
