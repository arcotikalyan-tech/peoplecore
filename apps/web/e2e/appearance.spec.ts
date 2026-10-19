import { expect } from '@playwright/test';
import { open, signIn, test } from './helpers';

/**
 * Appearance: "Auto" follows the local clock (light by day, dark at night); an explicit choice sticks across pages
 * and is applied before the first paint; the sidebar starts collapsed to icons and the menu button expands it.
 */
test('auto follows the clock; light and dark stick; the sidebar expands from the menu button', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T10:00:00'));
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light'); // 10 am, auto
  await expect(html).toHaveAttribute('data-scene', 'morning');

  await page.getByRole('button', { name: 'Appearance' }).click();
  const menu = page.getByRole('dialog', { name: 'Appearance' });
  await menu.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await menu.getByRole('radiogroup', { name: 'Weather' }).getByRole('radio', { name: 'Rain' }).click();
  await expect(html).toHaveAttribute('data-weather', 'rain');

  await open(page, '/app/demo/preferences');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Auto' }).click();
  await page.getByRole('radiogroup', { name: 'Weather' }).getByRole('radio', { name: 'Clear' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.clock.setFixedTime(new Date('2026-10-19T22:00:00'));
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark'); // 10 pm, auto
  await expect(html).toHaveAttribute('data-scene', 'night');

  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Leave' })).toHaveAttribute('title', 'Leave'); // icon rail
  await page.getByRole('button', { name: 'Expand menu' }).click();
  await expect(nav.getByRole('link', { name: 'Leave' })).not.toHaveAttribute('title', 'Leave');
  await page.getByRole('button', { name: 'Collapse menu' }).click();
});
