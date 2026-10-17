import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';

export const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'example.test';

export function liveEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!url || !secretKey || !password) {
    throw new Error('E2E needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_USER_PASSWORD (apps/web/.env.local).');
  }
  return { url, secretKey, password };
}

/** Service-role client for ground truth and cleanup only. Never used to drive the UI. */
export function adminClient() {
  const { url, secretKey } = liveEnv();
  return createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signs in through the real login form, exactly as a person would. */
export async function signIn(page: Page, local: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(`${local}@${domain}`);
  await page.getByLabel('Password').fill(liveEnv().password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app(\/|$|\?)/);
}

/** Navigates and waits until client components are interactive. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

export async function expectNotFound(page: Page) {
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
}
