import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Insurance on the demo tenant: HR sets up the group policy (hiding the policy number from employees), covers Dev,
 * sends only his addition in the endorsement (the rest stay pending) and keeps the CD account; Dev sees his cover
 * without the policy number. The policy, coverage, endorsement and CD entries are restored or removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let policyBefore: Record<string, unknown> | null = null;
let coverageBefore: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  policyBefore = (await admin.from('insurance_policies').select('*').eq('organization_id', orgId).maybeSingle()).data;
  coverageBefore = (await admin.from('insurance_coverage').select('*').eq('employee_id', devId).maybeSingle()).data;
});

test.afterAll(async () => {
  await admin.from('insurance_cd_entries').delete().eq('organization_id', orgId).like('reference', `%${run}%`);
  await admin.from('insurance_syncs').delete().eq('organization_id', orgId).gte('synced_at', startedAt);
  if (policyBefore) await admin.from('insurance_policies').upsert(policyBefore as never);
  else await admin.from('insurance_policies').delete().eq('organization_id', orgId);
  if (coverageBefore) await admin.from('insurance_coverage').upsert(coverageBefore as never);
  else await admin.from('insurance_coverage').delete().eq('employee_id', devId);
});

test('HR sets up the policy, covers an employee and locks the endorsement; the employee sees the cover', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/insurance');
  await expect(page.getByRole('heading', { level: 1, name: 'Insurance' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Policy' });
  await form.getByLabel('Insurer name').selectOption('Acko General Insurance');
  await form.getByLabel('Policy number').fill(`GHI-${run}`);
  await form.getByRole('checkbox').nth(1).uncheck(); // policy number: not shown to employees
  await form.getByRole('button', { name: /Key Benefits/ }).click();
  await form.getByLabel('Sum insured (₹)').fill('300000');
  await form.getByLabel('Cover type').selectOption('ESC');
  await form.getByRole('button', { name: 'Save policy' }).click();
  await expect(form.getByText('Policy saved.')).toBeVisible();

  await open(page, '/app/demo/insurance?tab=management&view=members');
  await page.getByRole('form', { name: 'Coverage for Dev Nair' }).getByRole('button', { name: 'Cover' }).click();
  await expect(page.getByRole('table', { name: 'Insured members' }).getByRole('row').filter({ hasText: 'Dev Nair' }).getByText('● Yes')).toBeVisible();

  await open(page, '/app/demo/insurance?tab=management&view=endorsement');
  const additions = page.getByRole('table', { name: 'Additions' });
  await expect(additions.getByText('Dev Nair').first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText(/Selected for this endorsement: 0 of \d+ additions/)).toBeVisible();
  await expect(page.getByRole('form', { name: 'Lock endorsement' }).getByRole('button', { name: 'Lock & mark synced' })).toBeDisabled();
  await additions.getByRole('checkbox', { name: 'Include Dev Nair (self)' }).check();
  await expect(page.getByText(/Selected for this endorsement: 1 of \d+ additions/)).toBeVisible();
  await page.getByRole('form', { name: 'Lock endorsement' }).getByRole('button', { name: 'Lock & mark synced' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Endorsement locked and marked synced: 1 addition, 0 deletions/ }).first()).toBeVisible();
  const sync = (await admin.from('insurance_syncs').select('roster, additions').eq('organization_id', orgId).gte('synced_at', startedAt).order('synced_at', { ascending: false }).limit(1).single()).data!;
  expect(sync.additions).toBe(1);
  expect(Object.keys(sync.roster as Record<string, unknown>)).toContain(devId);

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/insurance');
  await expect(dev.getByRole('heading', { level: 1, name: 'My Insurance' })).toBeVisible();
  await expect(dev.getByRole('table', { name: 'Insured members' }).getByText('Dev Nair')).toBeVisible();
  await expect(dev.getByText('₹3,00,000').first()).toBeVisible();
  await expect(dev.getByText(`GHI-${run}`)).toHaveCount(0);
});

test('HR keeps the CD account: settings, a deposit, an endorsement charge with an estimate, the balance and the alert', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/insurance?tab=management&view=cd');
  const settings = page.getByRole('form', { name: 'CD settings' });
  await settings.getByLabel('Annual premium per life (₹)').fill('3650');
  await settings.getByLabel('Warn when the balance falls below (₹)').fill('60000');
  await settings.getByRole('button', { name: 'Save CD settings' }).click();
  await expect.poll(async () => (await admin.from('insurance_policies').select('premium_per_life, cd_low_balance').eq('organization_id', orgId).single()).data)
    .toEqual({ premium_per_life: 3650, cd_low_balance: 60000 });

  const entry = page.getByRole('form', { name: 'Record a CD entry' });
  await entry.getByLabel('Amount (₹)').fill('50000');
  await entry.getByLabel('Reference').fill(`NEFT ${run}`);
  await entry.getByRole('button', { name: 'Record entry' }).click();
  const statement = page.getByRole('table', { name: 'CD statement' });
  await expect(statement.getByText(`NEFT ${run}`)).toBeVisible();

  await entry.getByLabel('Entry', { exact: true }).selectOption('endorsement');
  await entry.getByLabel('Lives').fill('1');
  await expect(entry.getByText(/^Estimate ≈ ₹[\d,]+ for 1 life/)).toBeVisible();
  await entry.getByLabel('Amount (₹)').fill('4200');
  await entry.getByLabel('Reference').fill(`DN ${run}`);
  await entry.getByRole('button', { name: 'Record entry' }).click();
  await expect(statement.getByText(`DN ${run}`)).toBeVisible();
  const mine = async () => (await admin.from('insurance_cd_entries').select('kind, amount').eq('organization_id', orgId).like('reference', `%${run}%`).order('created_at')).data;
  expect(await mine()).toEqual([{ kind: 'deposit', amount: 50000 }, { kind: 'endorsement', amount: -4200 }]);
  await expect(page.getByRole('alert').filter({ hasText: 'below your alert level' }).first()).toBeVisible();

  await page.getByRole('form', { name: /^Remove the .+ endorsement charge$/ }).getByRole('button', { name: 'Remove' }).click();
  await expect(statement.getByText(`DN ${run}`)).toHaveCount(0);
  expect(await mine()).toEqual([{ kind: 'deposit', amount: 50000 }]);
});
