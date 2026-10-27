import { expect, type Page } from '@playwright/test';
import { open, signIn, test } from './helpers';

/**
 * A click never looks ignored: while the server is slow (held back here on purpose), a loading bar runs across the
 * top for links, filters and server actions, and the button that was pressed is dimmed until the answer arrives.
 * Read-only: nothing is changed.
 */
const bar = (page: Page) => page.getByRole('progressbar', { name: 'Loading', exact: true });
const slow = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a sidebar link shows the loading bar until the page arrives', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  await page.route(/\/app\/demo\/holidays/, async (route) => { await slow(1500); await route.continue(); });
  await page.getByRole('link', { name: 'Holidays', exact: true }).first().click();
  await expect(bar(page)).toBeVisible();
  await page.waitForURL(/\/app\/demo\/holidays/);
  await expect(bar(page)).toBeHidden();
});

test('a filter form marks the page busy and dims its button', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/leave?tab=requests');
  await page.route(/\/app\/demo\/leave\?.*status=/, async (route) => { await slow(1500); await route.continue(); });
  const filter = page.getByRole('form', { name: 'Filter requests' });
  await filter.getByLabel('Status').selectOption('approved');
  // The browser loads the next page itself, so read the state in the same tick as the click.
  const state = await filter.getByRole('button', { name: 'Filter' }).evaluate((b: HTMLButtonElement) => {
    b.click();
    return { busy: b.hasAttribute('data-busy'), navigating: document.documentElement.hasAttribute('data-navigating') };
  });
  expect(state).toEqual({ busy: true, navigating: true });
  await page.waitForURL(/status=approved/);
  await expect(bar(page)).toBeHidden();
});

test('a server action shows the bar until it answers', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && (await route.request().headerValue('next-action'))) await slow(1500);
    await route.continue();
  });
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('textbox', { name: 'Search' }).fill('Nair');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toBeHidden({ timeout: 10_000 });
});
