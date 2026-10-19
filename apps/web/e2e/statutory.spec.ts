import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Compliance on the demo tenant: payroll sees the overview, the library and the regime map (Karnataka and Maharashtra
 * offices), turns on contract labour and sees the CLRA return become applicable, and records an old PF ECR as
 * filed with a proof file (from 2020, so its five-year retention has ended and the test can remove it); the employee
 * sees My Statutory. Scope, registrations and filings are restored afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';
let scopeBefore: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  scopeBefore = (await admin.from('statutory_scope').select('*').eq('organization_id', orgId).maybeSingle()).data;
});

test.afterAll(async () => {
  const { data } = await admin.from('statutory_filings').select('id, proof_path').eq('organization_id', orgId).lt('period_start', '2021-01-01');
  const paths = (data ?? []).map((r) => r.proof_path).filter((x): x is string => !!x);
  if (paths.length) await admin.storage.from('statutory-documents').remove(paths);
  await admin.from('statutory_filings').delete().eq('organization_id', orgId).lt('period_start', '2021-01-01');
  if (scopeBefore) await admin.from('statutory_scope').upsert(scopeBefore as never);
  else await admin.from('statutory_scope').delete().eq('organization_id', orgId);
});

test('payroll sees obligations, changes scope and records a filing with proof', async ({ page }) => {
  await signIn(page, 'demo.payroll');
  await open(page, '/app/demo/statutory');
  await expect(page.getByRole('heading', { level: 1, name: 'Compliance' })).toBeVisible();
  await expect(page.getByText('Applicable to you').first()).toBeVisible();

  await open(page, '/app/demo/statutory?tab=regime');
  const jurisdictions = page.getByRole('table', { name: 'Jurisdictions' });
  await expect(jurisdictions.getByText('Karnataka')).toBeVisible();
  await expect(jurisdictions.getByText('Maharashtra')).toBeVisible();

  await open(page, '/app/demo/statutory?tab=library&scope=mine&q=XXV');
  await expect(page.getByText('No forms match.')).toBeVisible();
  await open(page, '/app/demo/statutory?tab=engine');
  const scope = page.getByRole('form', { name: 'Scope' });
  await scope.getByLabel(/We engage contract labour/).check();
  await scope.getByRole('button', { name: 'Save scope' }).click();
  await expect(scope.getByText('Scope saved')).toBeVisible();
  await open(page, '/app/demo/statutory?tab=library&scope=mine&q=XXV');
  await expect(page.getByRole('table', { name: 'Statutory forms' }).getByText('Annual return by principal employer')).toBeVisible();

  await open(page, '/app/demo/statutory?tab=documents&period=2020-01');
  const row = page.getByRole('row').filter({ hasText: 'IN-P-01' });
  await row.getByText('Mark filed').click();
  const form = row.getByRole('form', { name: /Mark ECR Jan 2020 filed/ });
  await form.getByLabel('Filed on').fill('2020-02-06');
  await form.getByLabel('Acknowledgement / challan no.').fill('TRRN-0001');
  await form.getByLabel(/Proof/).setInputFiles({ name: 'ecr.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% test\n') });
  await form.getByRole('button', { name: 'Save as filed' }).click();
  await expect(page.getByText('ECR marked filed.')).toBeVisible();
  const filed = page.getByRole('row').filter({ hasText: 'IN-P-01' });
  await expect(filed.getByText('Filed', { exact: true })).toBeVisible();
  await expect(filed.getByText('TRRN-0001')).toBeVisible();
  await expect(filed.getByRole('link', { name: /ecr\.pdf/ })).toBeVisible();
});

test('an employee sees their own statutory details, not the compliance console', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/statutory');
  await expect(page.getByRole('heading', { level: 1, name: 'My Statutory' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents issued to you' })).toBeVisible();
  await expect(page.getByText('Engine Console')).toHaveCount(0);
});
