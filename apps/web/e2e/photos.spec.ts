import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Profile photos and the company logo on the demo tenant: an employee adds their own photo (shown on their profile
 * and in the header), the owner adds the logo (shown in the sidebar), and both are removed again.
 */
test.describe.configure({ mode: 'serial' });

// A 2×2 PNG: enough to be a real picture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDGgAQBIuAICn9tB4QAAAABJRU5ErkJggg==', 'base64');
const admin = adminClient();

test('an employee adds and removes their profile photo', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'My profile' }).click();
  await page.waitForURL(/\/app\/demo\/employees\/[0-9a-f-]{36}/);
  await page.waitForLoadState('networkidle');
  const form = page.getByRole('form', { name: 'Your profile photo' });
  await form.getByLabel('Your profile photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Photo saved.' })).toBeVisible();
  await expect(page.locator('header img').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' }).locator('img')).toBeVisible();

  // The ID card shows the photo too (the demo's card design includes one).
  const profile = page.url();
  await open(page, '/app/demo/idstudio');
  await expect(page.getByRole('region', { name: 'ID card for Dev Nair', exact: true }).getByRole('img', { name: 'Photo of Dev Nair' })).toBeVisible();
  await open(page, profile);

  // Not a picture: refused, whatever the file is called.
  await form.getByLabel('Your profile photo').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await form.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Use a JPEG or PNG picture.')).toBeVisible();

  await page.getByRole('form', { name: 'Remove photo' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' }).locator('img')).toHaveCount(0);
});

test('the owner adds the company logo; everyone sees it in the sidebar', async ({ page, browser }) => {
  await signIn(page, 'demo.owner');
  await open(page, '/app/demo/company');
  const form = page.getByRole('form', { name: 'Company logo' });
  await form.getByLabel('Company logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Logo saved.' })).toBeVisible();

  const colleague = await (await browser.newContext()).newPage();
  await signIn(colleague, 'demo.employee');
  await expect(colleague.getByRole('img', { name: /logo$/ }).first()).toBeVisible();

  await open(page, '/app/demo/company');
  await page.getByRole('form', { name: 'Remove logo' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Logo removed.' })).toBeVisible();
  const orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').single()).data!.id;
  expect((await admin.from('company_profiles').select('logo_path').eq('organization_id', orgId).single()).data!.logo_path).toBeNull();
});
