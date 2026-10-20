import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Hiring OS on the demo tenant: HR sees the hub, plans headcount for Engineering, creates a talent pool and adds a
 * candidate, edits an email template with a live preview, records spend and saves the automations; an employee has
 * no Hiring OS. Plans, pools, templates and spend created here are removed afterwards; automations are restored.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let settingsBefore: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  settingsBefore = (await admin.from('recruitment_settings').select('*').eq('organization_id', orgId).maybeSingle()).data;
});

test.afterAll(async () => {
  await admin.from('hiring_plans').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('talent_pools').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('recruiting_email_templates').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  await admin.from('recruiting_spend').delete().eq('organization_id', orgId).like('note', `%${run}%`);
  if (settingsBefore) await admin.from('recruitment_settings').upsert(settingsBefore as never);
  else await admin.from('recruitment_settings').delete().eq('organization_id', orgId);
});

test('HR plans, pools, templates, spend and automations', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/recruitment');
  await expect(page.getByRole('heading', { level: 1, name: 'Hiring OS' })).toBeVisible();
  await expect(page.getByText('Needs action')).toBeVisible();

  await open(page, '/app/demo/recruitment?tab=recruitment&view=plan');
  const plan = page.getByRole('form', { name: 'New hiring plan' });
  await plan.locator('input[name="name"]').fill(`Plan ${run}`);
  await plan.getByLabel('Headcount for Engineering').fill('3');
  await plan.getByRole('button', { name: '＋ New plan' }).click();
  await expect(plan.getByText(`Plan ${run} created.`)).toBeVisible();
  await expect(page.getByRole('table', { name: `Plan Plan ${run}` }).getByText('Engineering')).toBeVisible();

  await open(page, '/app/demo/recruitment?tab=outreach&view=pools');
  const pool = page.getByRole('form', { name: 'New pool' });
  await pool.locator('input[name="name"]').fill(`Pool ${run}`);
  await pool.getByRole('button', { name: '＋ New pool' }).click();
  await expect(pool.getByText(`Pool ${run} created.`)).toBeVisible();
  const add = page.getByRole('form', { name: 'Add candidates to a pool' });
  await add.getByLabel('Pool').selectOption({ label: `Pool ${run}` });
  const first = add.getByRole('checkbox').first();
  if (await first.count()) {
    await first.check();
    await add.getByRole('button', { name: 'Add to pool' }).click();
    await expect(add.getByText('1 candidate added to the pool.')).toBeVisible();
  }

  await open(page, '/app/demo/recruitment?tab=outreach&view=templates');
  const tpl = page.getByRole('form', { name: 'New template' });
  await tpl.locator('input[name="name"]').fill(`Nudge ${run}`);
  await tpl.locator('input[name="subject"]').fill('Hello {{candidate_first_name}}');
  await tpl.locator('textarea[name="body"]').fill('Thanks for applying to {{company}}.');
  await expect(tpl.getByLabel('Preview').getByText('Hello Asha')).toBeVisible();
  await tpl.getByRole('button', { name: '＋ Add template' }).click();
  await expect(tpl.getByText(`Nudge ${run} added.`)).toBeVisible();

  await open(page, '/app/demo/recruitment?tab=insights');
  const spend = page.getByRole('form', { name: 'Add spend' });
  await spend.getByLabel('Source').selectOption('job_board');
  await spend.locator('input[name="amount"]').fill('12000');
  await spend.getByLabel('Note').fill(`Board ${run}`);
  await spend.getByRole('button', { name: '＋ Add spend' }).click();
  await expect(spend.getByText('Spend recorded.')).toBeVisible();

  await open(page, '/app/demo/recruitment?tab=settings&view=automations');
  const auto = page.getByRole('form', { name: 'Automations' });
  await auto.getByLabel('Stalled after (days)').fill('10');
  await auto.getByRole('button', { name: 'Save automations' }).click();
  await expect(auto.getByText('Automations saved.')).toBeVisible();
  await open(page, '/app/demo/recruitment?tab=settings');
  await expect(page.getByRole('table', { name: 'Recruitment team' })).toBeVisible();
});

test('employees have no Hiring OS', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await page.goto('/app/demo/recruitment');
  await expect(page.getByRole('heading', { level: 1, name: 'Hiring OS' })).toHaveCount(0);
});
