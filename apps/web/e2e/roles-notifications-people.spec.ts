import { expect, type Page } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Roles, notifications and people (Kredily second pass, batch 3) on the demo tenant: the new standard roles in
 * Settings › Roles; the owner switches on leave-application emails for HR and sees the queued email; HR keeps the
 * company PAN proof, records Dev Nair's experience before joining, adds Event leave, nudges people about unused leave
 * and previews the leave-year close. Everything created or changed here is put back afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let devUser = '';
let priorBefore: number | null = null;
let rulesBefore: Array<{ event: string; audience: string; enabled: boolean }> = [];

const section = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const dev = (await admin.from('employees').select('id, user_id, prior_experience_months').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!;
  devId = dev.id;
  devUser = dev.user_id!;
  priorBefore = dev.prior_experience_months;
  rulesBefore = (await admin.from('notification_email_rules').select('event, audience, enabled').eq('organization_id', orgId)).data ?? [];
});

test.afterAll(async () => {
  await admin.from('notification_email_rules').delete().eq('organization_id', orgId);
  if (rulesBefore.length) await admin.from('notification_email_rules').insert(rulesBefore.map((r) => ({ ...r, organization_id: orgId })));
  await admin.from('email_outbox').delete().eq('organization_id', orgId).gte('created_at', startedAt);
  const { data: leaves } = await admin.from('leave_requests').select('id').eq('employee_id', devId).ilike('reason', `%${run}%`);
  if (leaves?.length) await admin.from('leave_requests').delete().in('id', leaves.map((l) => l.id));
  const { data: docs } = await admin.from('company_documents').select('id, storage_path').eq('organization_id', orgId).gte('uploaded_at', startedAt);
  for (const d of docs ?? []) {
    await admin.storage.from('company-documents').remove([d.storage_path]);
    await admin.from('company_documents').delete().eq('id', d.id);
  }
  await admin.from('employees').update({ prior_experience_months: priorBefore }).eq('id', devId);
  const { data: evl } = await admin.from('leave_types').select('id').eq('organization_id', orgId).eq('category', 'event').gte('created_at', startedAt);
  for (const t of evl ?? []) {
    await admin.from('leave_policies').delete().eq('leave_type_id', t.id);
    await admin.from('leave_types').delete().eq('id', t.id);
  }
  await admin.from('leave_settings').update({ last_nudged_at: null }).eq('organization_id', orgId);
  await admin.from('notifications').delete().eq('organization_id', orgId).eq('kind', 'leave.nudge').gte('created_at', startedAt);
});

test('the new standard roles are there, with payroll access shown at a glance', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=roles');
  const roles = page.getByRole('list', { name: 'Roles' });
  await expect(roles.getByRole('listitem').filter({ hasText: 'HR executive' })).toContainText('No payroll');
  await expect(roles.getByRole('listitem').filter({ hasText: 'Finance administrator' })).toContainText('Payroll access');
  await expect(roles.getByRole('listitem').filter({ hasText: 'Partner (read-only)' })).toBeVisible();
  await expect(roles.getByRole('listitem').filter({ hasText: 'Attendance device admin' })).toBeVisible();
});

test('the owner emails HR about leave applications; the email waits in the outbox', async ({ page }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/settings?tab=notifications');
  const form = page.getByRole('form', { name: 'Email notifications' });
  await form.getByRole('checkbox', { name: 'Leave application: email hr administrators' }).check();
  await form.getByRole('button', { name: 'Save email notifications' }).click();
  await expect(page.getByText(/^Email notifications saved: \d+ switched on\.$/)).toBeVisible();

  const cl = (await admin.from('leave_types').select('id').eq('organization_id', orgId).eq('code', 'CL').single()).data!.id;
  await admin.from('leave_requests').insert({ organization_id: orgId, employee_id: devId, leave_type_id: cl, start_date: '2027-03-01', end_date: '2027-03-02', days: 2, reason: `E2E ${run}`, status: 'pending', requested_by: devUser });
  const { data: mail } = await admin.from('email_outbox').select('to_email, subject, status').eq('organization_id', orgId).eq('event', 'leave').gte('created_at', startedAt);
  expect(mail!.length).toBeGreaterThan(0);
  expect(mail!.every((m) => m.subject === 'Leave application: Dev Nair, 2 days of Casual leave' && m.status === 'queued')).toBe(true);

  await open(page, '/app/demo/settings?tab=notifications');
  await expect(page.getByRole('list', { name: 'Recent emails' }).getByText('Leave application: Dev Nair, 2 days of Casual leave').first()).toBeVisible();
});

test('HR keeps the company PAN proof, downloads it and removes it', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/company?tab=statutory');
  const form = page.getByRole('form', { name: 'Upload Company PAN' });
  await form.getByLabel('File').setInputFiles({ name: `pan-${run}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% E2E ${run}\n`) });
  await form.getByRole('button', { name: '📎 Upload' }).click();
  await expect(page.getByText(`pan-${run}.pdf uploaded.`)).toBeVisible();
  const link = page.getByRole('link', { name: `📎 pan-${run}.pdf` });
  const res = await page.request.get((await link.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  expect((await res.body()).toString('utf8')).toContain(`E2E ${run}`);
  await page.getByRole('form', { name: `Remove pan-${run}.pdf` }).getByRole('button', { name: 'Remove' }).click();
  await expect(link).toHaveCount(0);
  expect((await admin.from('company_documents').select('id').eq('organization_id', orgId).eq('file_name', `pan-${run}.pdf`)).data).toEqual([]);
});

test('HR records experience before joining and the total shows', async ({ page }) => {
  await admin.from('employees').update({ prior_experience_months: null }).eq('id', devId);
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${devId}?tab=work`);
  const basic = section(page, 'Basic Info');
  await basic.getByRole('button', { name: 'Edit' }).click();
  await basic.getByLabel('Experience before joining (years)').fill('3');
  await basic.getByLabel('and months').fill('4');
  await basic.getByRole('button', { name: 'Save work details' }).click();
  // A successful save closes the editor and shows the record again.
  await expect(section(page, 'Basic Info').getByText('3 yr 4 mo', { exact: true })).toBeVisible();
  expect((await admin.from('employees').select('prior_experience_months').eq('id', devId).single()).data!.prior_experience_months).toBe(40);
});

test('HR adds Event leave, nudges people about unused leave and previews the year end', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/leave?tab=rules');
  const standard = page.getByRole('group', { name: 'Add a standard leave type' });
  if (await standard.getByRole('button', { name: '＋ Event leave' }).count()) {
    await standard.getByRole('button', { name: '＋ Event leave' }).click();
  }
  // Once added, the button goes (with its message) and the rule is in the list instead.
  await expect.poll(async () => (await admin.from('leave_types').select('name').eq('organization_id', orgId).eq('category', 'event')).data!.length).toBeGreaterThan(0);
  await open(page, '/app/demo/leave?tab=rules');
  await expect(standard.getByRole('button', { name: '＋ Event leave' })).toHaveCount(0);

  await open(page, '/app/demo/leave');
  await page.getByRole('button', { name: '📣 Nudge employees' }).click();
  await expect(page.getByText(/nudged to plan leave|Nobody has much unused leave right now/)).toBeVisible();
  await page.getByRole('button', { name: '📣 Nudge employees' }).click();
  await expect(page.getByText(/^People were nudged on .+\. Nudge again after a week\.$/)).toBeVisible();

  await open(page, '/app/demo/leave?tab=accruals');
  const close = page.getByRole('region', { name: 'Close the leave cycle' });
  await expect(close.getByRole('button', { name: 'Close and carry forward now' })).toBeVisible();
  await expect(close.getByRole('table').or(close.getByText('No unused leave to carry forward.'))).toBeVisible();
});
