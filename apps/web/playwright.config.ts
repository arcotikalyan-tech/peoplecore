import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * Browser E2E tests against a live PeopleCore environment: needs apps/web/.env.local (Supabase keys and
 * DEMO_USER_PASSWORD) and a tenant seeded by `seed:demo`. Not part of `pnpm check`, which must run offline.
 *
 *   corepack pnpm --filter @peoplecore/web test:e2e
 */
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  workers: 1, // the journeys share live data and run in order
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL,
    // Uses the installed Google Chrome (separate temporary profile); set E2E_BROWSER_CHANNEL=chromium in CI.
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
    // No traces: they would record the typed demo password.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'next dev --port 3000',
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
