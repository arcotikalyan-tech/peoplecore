import { afterAll, beforeAll } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/harness.ts';
import { buildFixture, type Fixture } from './fixtures.ts';

/** Per-file database: migrations + fixture. Each test runs in a rolled-back transaction via asUser. */
export function useDatabase() {
  const ctx = {} as { t: TestDatabase; f: Fixture };
  beforeAll(async () => {
    ctx.t = await createTestDatabase();
    ctx.f = await buildFixture(ctx.t);
  }, 60_000);
  afterAll(async () => ctx.t?.close());
  return ctx;
}

/** Postgres error code from a rejected query, for asserting *why* something failed. */
export async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code ?? `no-code: ${(err as Error).message}`;
  }
  throw new Error('expected query to fail');
}
