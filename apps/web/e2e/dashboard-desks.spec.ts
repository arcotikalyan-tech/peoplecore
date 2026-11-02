import { expect, type Page } from '@playwright/test';
import { open, signIn, test } from './helpers';

/** Each role's desk on the dashboard: a manager sees their team, HR people operations, payroll the next run. */

const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name });

test('a manager’s dashboard is their team: who is in today, who is away, what is coming up', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, '/app/demo');
  const figures = region(page, 'Key figures');
  await expect(figures.getByText('Checked in', { exact: true })).toBeVisible();
  await expect(figures.getByText('Not checked in', { exact: true })).toBeVisible();
  await expect(figures.getByText('Attrition (30d)')).toHaveCount(0); // organization-wide figures are HR's

  const today = region(page, 'My team today');
  const dev = today.getByRole('row').filter({ hasText: 'Dev Nair' });
  await expect(dev).toBeVisible(); // Dev reports to Rohan
  await expect(dev.getByRole('cell').nth(1)).not.toBeEmpty();
  await expect(today.getByRole('row').filter({ hasText: 'Rohan Iyer' })).toHaveCount(0); // not the manager himself
  await expect(region(page, 'Away in the next two weeks')).toBeVisible();
  await expect(region(page, 'Coming up in your team')).toBeVisible();
  await expect(region(page, /^Team this month/).getByRole('row').filter({ hasText: 'Dev Nair' })).toBeVisible();

  await dev.getByRole('link', { name: /Dev Nair/ }).click();
  await page.waitForURL(/\/employees\/[^/]+\?tab=attendance$/);
});

test('HR gets people operations and payroll gets the next run, besides the organization’s figures', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo');
  await expect(region(page, 'Key figures').getByText('Headcount', { exact: true })).toBeVisible();
  const ops = region(page, 'People operations');
  await expect(ops.getByRole('link', { name: /Leave requests waiting/ })).toBeVisible();
  await expect(ops.getByRole('link', { name: /Probation ending in 30 days/ })).toBeVisible();
  await expect(region(page, 'Joining, confirming and leaving')).toBeVisible();
  await expect(region(page, /^Payroll ·/)).toHaveCount(0); // HR doesn't run payroll

  const payroll = await (await browser.newContext()).newPage();
  await signIn(payroll, 'demo.payroll');
  await open(payroll, '/app/demo');
  const run = region(payroll, /^Payroll ·/);
  await expect(run.getByRole('list', { name: 'Payroll run' })).toBeVisible();
  await expect(run.getByRole('link', { name: /People with no salary/ })).toBeVisible();
  await expect(region(payroll, 'Money going out').getByRole('link', { name: /Expense claims to reimburse/ })).toBeVisible();
  await expect(region(payroll, 'People operations')).toHaveCount(0);
});

test('an employee’s dashboard has no team or role desks', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  await expect(region(page, 'Key figures').getByText('Days present')).toBeVisible();
  for (const name of ['My team today', 'People operations', 'Money going out', 'Your team']) await expect(region(page, name)).toHaveCount(0);
});
