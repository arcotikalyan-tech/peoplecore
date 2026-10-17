import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/harness.ts';
import { generateDatabaseTypes } from '../src/gen-types.ts';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
}, 60_000);
afterAll(async () => t?.close());

describe('database.types.ts', () => {
  it('matches the migrations (run `corepack pnpm --filter @peoplecore/db gen:types` if this fails)', async () => {
    const committed = await readFile(new URL('../src/database.types.ts', import.meta.url), 'utf8');
    expect(committed).toBe(await generateDatabaseTypes(t.db));
  });
});
