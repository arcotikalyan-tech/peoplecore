import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Letters (Kredily's Letter Studio) on the demo tenant: HR adds a signatory and assigns it to the Employment Letter;
 * the employee requests that letter; HR generates it from the request (filling the reason), previews, releases;
 * the employee opens it. HR also generates letters for two people at once and discards the drafts. Cleaned up after.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let devId = '';
let template: { id: string; signatory_id: string | null } | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  template = (await admin.from('letter_templates').select('id, signatory_id').eq('organization_id', orgId).eq('letter_type', 'Employment Letter').single()).data;
  await admin.from('letter_requests').update({ status: 'withdrawn' }).eq('employee_id', devId).eq('status', 'pending');
});

test.afterAll(async () => {
  if (template) await admin.from('letter_templates').update({ signatory_id: template.signatory_id }).eq('id', template.id);
  const reqs = (await admin.from('letter_requests').select('id').eq('organization_id', orgId).ilike('reason', `%${run}%`)).data ?? [];
  const letters = (await admin.from('letters').select('id').eq('organization_id', orgId).ilike('body', `%${run}%`)).data ?? [];
  await admin.from('letter_requests').update({ letter_id: null }).in('id', reqs.map((r) => r.id));
  await admin.from('letters').delete().in('id', letters.map((l) => l.id));
  await admin.from('letter_requests').delete().in('id', reqs.map((r) => r.id));
  await admin.from('letter_signatories').delete().eq('organization_id', orgId).ilike('name', `%${run}%`);
});

test('HR adds a signatory and assigns it to the Employment Letter', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/letters?tab=settings&view=signatories');
  const add = page.getByRole('form', { name: 'Add signatory' });
  await add.getByRole('textbox', { name: 'Name', exact: true }).fill(`Asha Signatory ${run}`);
  await add.getByRole('textbox', { name: 'Designation' }).fill('Head of People');
  await add.getByRole('button', { name: '＋ Add Signatory' }).click();
  await expect(page.getByRole('list', { name: 'Signatories' }).getByText(`Asha Signatory ${run}`)).toBeVisible();

  await open(page, '/app/demo/letters?tab=settings&view=setup');
  await page.getByRole('link', { name: 'Edit Employment Letter' }).click();
  const form = page.getByRole('form', { name: 'Letter template' });
  await form.getByLabel('Authorized signatory', { exact: true }).selectOption({ label: `Asha Signatory ${run} · Head of People` });
  await expect(page.getByRole('region', { name: 'Preview' }).getByText(`Asha Signatory ${run}`)).toBeVisible();
  await expect(form.getByText('All tags valid')).toBeVisible();
  await form.getByRole('button', { name: 'Save template' }).click();
  await expect(form.getByText('Template saved.')).toBeVisible();
});

test('the employee requests a letter; HR generates and releases it; the employee opens it', async ({ page, browser }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/letters');
  const req = page.getByRole('form', { name: 'Request a letter' });
  await req.getByLabel('Letter').selectOption({ label: 'Employment Letter' });
  await req.getByLabel('Reason').fill(`Visa ${run}`);
  await req.getByRole('button', { name: 'Request' }).click();
  await expect(req.getByText('Request sent. HR has been notified.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'My letter requests' }).getByText('pending').first()).toBeVisible();

  const ctx = await browser.newContext();
  const hr = await ctx.newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, '/app/demo/letters?tab=requests');
  await hr.getByRole('link', { name: 'Generate Employment Letter for Dev Nair' }).click();
  const details = hr.getByRole('form', { name: 'Letter details' });
  await details.getByRole('textbox', { name: 'Reason' }).fill(`visa application ${run}`);
  await expect(hr.getByRole('region', { name: 'Preview' }).getByText(`visa application ${run}`, { exact: false })).toBeVisible();
  await details.getByRole('button', { name: 'Generate 1 letter' }).click();
  await hr.getByRole('button', { name: 'Release 1 letter' }).click();
  await expect(hr.getByText('Released 1 letter.', { exact: false })).toBeVisible();
  await ctx.close();

  await open(page, '/app/demo/letters');
  await page.getByRole('link', { name: 'Open Employment Letter' }).first().click();
  const letter = page.getByRole('article', { name: 'Letter' });
  await expect(letter.getByText(`visa application ${run}`, { exact: false })).toBeVisible();
  await expect(letter.getByText('Dev Nair', { exact: false }).first()).toBeVisible();
  await expect(letter.getByText(`Asha Signatory ${run}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
});

test('HR generates letters for two people at once and discards the drafts', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/letters?tab=generate');
  const pick = page.getByRole('form', { name: 'Generate a letter' });
  await pick.getByLabel('Letter Type').selectOption('Confirmation Letter');
  await pick.getByRole('checkbox').nth(0).check();
  await pick.getByRole('checkbox').nth(1).check();
  await pick.getByRole('button', { name: 'Continue →' }).click();
  const details = page.getByRole('form', { name: 'Letter details' });
  // Typing before the page's scripts take over is reset to the template, so wait for them and check the text stuck.
  await page.waitForLoadState('networkidle');
  const body = `Date: {{ date }}\n\nDear {{ first name }}, this is batch ${run}.\n\nFor {{ company name }}`;
  await details.getByLabel('Template editor').fill(body);
  await expect(details.getByLabel('Template editor')).toHaveValue(body);
  await details.getByRole('button', { name: 'Generate 2 letters' }).click();
  const drafts = page.getByRole('list', { name: 'Drafts' });
  await expect(drafts.getByRole('listitem')).toHaveCount(2);
  await drafts.getByRole('button', { name: 'Discard' }).first().click();
  await expect(page.getByText('Draft discarded.')).toBeVisible();
  expect((await admin.from('letters').select('id').eq('organization_id', orgId).ilike('body', `%batch ${run}%`)).data).toHaveLength(1);
});
