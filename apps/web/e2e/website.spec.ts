import { expect } from '@playwright/test';
import { adminClient, domain, open, test } from './helpers';

/** The public website: the home page, sign in and sign up from the header, and a sign-up request reaching the platform. */
const run = Date.now().toString(36).slice(-5);
const email = `owner.${run}@${domain}`;
const admin = adminClient();

test.afterAll(async () => {
  await admin.from('access_requests').delete().eq('work_email', email);
});

test('the home page leads to sign in and sign up from the header', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByRole('heading', { level: 1, name: /Every part of HR/ })).toBeVisible();
  const header = page.getByRole('banner');
  await header.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign up for PeopleCore' })).toBeVisible();
});

test('the header opens every page of the website', async ({ page }) => {
  await open(page, '/');
  for (const [link, heading] of [['Features', /module by module/], ['Compliance', /on one calendar/], ['Security', /Salaries are private/], ['About', /respects/]] as const) {
    await page.getByRole('banner').getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('a company signs up and the request is recorded once', async ({ page }) => {
  await open(page, '/signup');
  const form = page.getByRole('form', { name: 'Sign up' });
  await form.getByRole('button', { name: 'Sign up' }).click();
  await expect(form.getByText('Enter your company name.')).toBeVisible();
  await form.locator('input[name="company"]').fill(`Acme ${run}`);
  await form.locator('input[name="name"]').fill('Asha Rao');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('select[name="headcount"]').selectOption('26-100');
  await form.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText(`Thanks, Asha! We’ve got your request and will email ${email}`)).toBeVisible();
  const { data } = await admin.from('access_requests').select('company, status').eq('work_email', email);
  expect(data).toEqual([{ company: `Acme ${run}`, status: 'new' }]);
});
