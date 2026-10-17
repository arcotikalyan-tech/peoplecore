// Writes src/database.types.ts from the migrations (see src/gen-types.ts).
import { writeFile } from 'node:fs/promises';
import { createTestDatabase } from '../src/harness.ts';
import { generateDatabaseTypes } from '../src/gen-types.ts';

const t = await createTestDatabase();
try {
  const target = new URL('../src/database.types.ts', import.meta.url);
  await writeFile(target, await generateDatabaseTypes(t.db));
  console.warn(`wrote ${target.pathname}`);
} finally {
  await t.close();
}
