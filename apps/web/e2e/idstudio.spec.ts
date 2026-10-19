import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * ID Studio on the demo tenant: HR designs a card in three steps, makes it the default and opens the print sheet;
 * Dev sees his own card with it. The previous default is restored and the design removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let defaultBefore: string | null = null;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  defaultBefore = (await admin.from('id_card_designs').select('id').eq('organization_id', orgId).eq('is_default', true).maybeSingle()).data?.id ?? null;
});

test.afterAll(async () => {
  await admin.from('id_card_designs').delete().eq('organization_id', orgId).like('name', `%${run}%`);
  if (defaultBefore) await admin.from('id_card_designs').update({ is_default: true }).eq('id', defaultBefore);
});

test('HR designs a card in three steps and prints; the employee sees their card', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/idstudio');
  await expect(page.getByRole('heading', { level: 1, name: 'ID Studio' })).toBeVisible();
  const create = page.getByRole('form', { name: 'New design' });
  await create.getByLabel('Design name').fill(`Head office ${run}`);
  await create.getByText('Bold', { exact: true }).click();
  await create.getByRole('button', { name: 'Create design' }).click();
  await page.waitForURL(/tab=fields&design=/);

  const fields = page.getByRole('form', { name: 'Fields and layout' });
  await fields.getByLabel('Work email').check();
  await fields.getByLabel('Orientation').selectOption('landscape');
  await fields.getByRole('button', { name: 'Save fields' }).click();
  await expect(fields.getByText('Fields and layout saved.')).toBeVisible();

  await open(page, `${new URL(page.url()).pathname}?tab=advanced&design=${new URL(page.url()).searchParams.get('design')}`);
  const adv = page.getByRole('form', { name: 'Advanced' });
  await adv.getByLabel('Back of the card').fill(`Return to reception ${run}`);
  await adv.getByRole('button', { name: 'Save design' }).click();
  await expect(adv.getByText('Design saved.')).toBeVisible();
  await expect(page.getByRole('region', { name: /^ID card for / }).first()).toBeVisible();

  await open(page, '/app/demo/idstudio');
  const make = page.getByRole('form', { name: `Make Head office ${run} the default` });
  if (await make.count()) {
    await make.getByRole('button', { name: 'Make default' }).click();
    await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem').filter({ hasText: `Head office ${run}` }).getByText('Default', { exact: true })).toBeVisible();
  }
  await open(page, '/app/demo/idstudio/print');
  await expect(page.getByRole('region', { name: 'ID card for Dev Nair', exact: true })).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/idstudio');
  await expect(dev.getByRole('heading', { level: 1, name: 'My ID Card' })).toBeVisible();
  await expect(dev.getByRole('region', { name: 'ID card for Dev Nair', exact: true })).toBeVisible();
  await expect(dev.getByText(`Return to reception ${run}`)).toBeVisible();
  await expect(dev.getByRole('img', { name: 'QR code' })).toBeVisible();
});
