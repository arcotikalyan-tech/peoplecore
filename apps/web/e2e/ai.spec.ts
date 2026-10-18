import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * AI assistants on the live demo tenant, answered by the test provider (start the dev server with
 * AI_PROVIDER=mock; it answers from the retrieved sources without a model). The owner turns assistants on; an
 * employee asks Ask HR a question answered by a knowledge-base article and one nothing answers; the owner sees
 * the month's use. Settings, the article and the runs are restored or removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5);
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let before: { enabled: boolean; monthly_token_budget: number; hourly_limit_per_user: number } | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  before = (await admin.from('ai_settings').select('enabled, monthly_token_budget, hourly_limit_per_user').eq('organization_id', orgId).maybeSingle()).data;
  await admin.from('kb_articles').insert({
    organization_id: orgId, title: `Cycle to work ${run}`, published: true, category: 'Benefits',
    body: `Employees who cycle to work get a bicycle allowance of Rs 500 a month, paid with salary. Claim it once under Expenses with a photo of the bicycle. Code ${run}.`,
  });
});

test.afterAll(async () => {
  await admin.from('kb_articles').delete().eq('organization_id', orgId).eq('title', `Cycle to work ${run}`);
  await admin.from('ai_runs').delete().eq('organization_id', orgId).gte('created_at', startedAt);
  if (before) await admin.from('ai_settings').update(before).eq('organization_id', orgId);
  else await admin.from('ai_settings').delete().eq('organization_id', orgId);
});

test('the owner turns assistants on', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/ai');
  await expect(page.getByText('Test provider (fixed answers, no model)')).toBeVisible();
  const form = page.getByRole('form', { name: 'AI settings' });
  await form.getByLabel('Monthly budget (tokens)').fill('nope');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Enter a budget')).toBeVisible();
  await form.getByLabel('Turn on AI assistants').check();
  await form.getByLabel('Monthly budget (tokens)').fill('2,000,000');
  await form.getByLabel('Requests per person per hour').fill('30');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved. AI assistants are on.')).toBeVisible();
});

test('an employee asks Ask HR: an answer with its source, and an honest “not found”', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Ask HR' }).click();
  await page.waitForURL(/\/assistant$/);

  const ask = page.getByRole('form', { name: 'Ask HR' });
  await ask.getByLabel('Your question').fill(`How much is the bicycle allowance (${run})? My phone is 9876543210.`);
  await ask.getByRole('button', { name: 'Ask' }).click();
  const answer = page.getByRole('region', { name: 'Answer from your policies' });
  await expect(answer).toContainText('Rs 500 a month');
  await expect(answer.getByRole('list', { name: 'Sources' }).getByRole('link', { name: `Knowledge base: Cycle to work ${run}` })).toBeVisible();
  await answer.getByRole('form', { name: 'Helpful' }).getByRole('button', { name: 'Yes' }).click();
  await expect(answer.getByText('Thanks for the feedback.')).toBeVisible();

  await ask.getByLabel('Your question').fill(`What about zorbing qx${run}?`);
  await ask.getByRole('button', { name: 'Ask' }).click();
  const none = page.getByRole('region', { name: 'Not in the policies' });
  await expect(none).toContainText('I couldn’t find this in the published policies');
  await expect(none.getByRole('link', { name: 'Raise a helpdesk ticket →' })).toBeVisible();

  const runs = (await admin.from('ai_runs').select('agent, status, redactions, helpful').eq('organization_id', orgId).gte('created_at', startedAt).order('created_at')).data ?? [];
  expect(runs).toEqual([
    { agent: 'policy_assistant', status: 'succeeded', redactions: { phone: 1 }, helpful: true },
    { agent: 'policy_assistant', status: 'succeeded', redactions: {}, helpful: null },
  ]);
});

test('the owner sees this month’s use; an employee can’t open the settings', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, 'demo.owner');
  await open(owner, '/app/demo/ai');
  const row = owner.getByRole('table', { name: 'AI use this month' }).getByRole('row', { name: /Ask HR \(policy assistant\)/ });
  await expect(row).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo');
  await expect(dev.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'AI assistants' })).toHaveCount(0);
  await open(dev, '/app/demo/ai'); // a streamed page: the not-found screen, whatever the status code
  await expect(dev.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
