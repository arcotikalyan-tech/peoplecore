import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '../../../supabase/migrations');

export interface TestDatabase {
  /** Superuser connection (bypasses RLS). Use only for fixtures. */
  db: PGlite;
  /** Run `fn` as an authenticated Supabase user inside a transaction that is always rolled back. */
  asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Run `fn` as the anonymous role inside a rolled-back transaction. */
  asAnon<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  createUser(email: string): Promise<string>;
  close(): Promise<void>;
}

class Rollback extends Error {}

/** Fresh in-memory Postgres with the Supabase shim and every migration applied, in order. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create({ extensions: { btree_gist, pg_trgm } });
  // Hosted Supabase runs in UTC; PGlite would otherwise follow this machine's time zone, which hid a
  // UTC-vs-local-date bug (see migration 20261018000100).
  await db.exec(`set timezone = 'UTC'`);
  await db.exec(await readFile(join(here, 'supabase-shim.sql'), 'utf8'));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await db.exec(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }

  async function scoped<T>(role: 'authenticated' | 'anon', sub: string | null, fn: (tx: Transaction) => Promise<T>) {
    let result: T | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
        await tx.exec(`set local role ${role}`);
        result = await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return result as T;
  }

  return {
    db,
    asUser: (userId, fn) => scoped('authenticated', userId, fn),
    asAnon: (fn) => scoped('anon', null, fn),
    async createUser(email) {
      const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
      return rows[0]!.id;
    },
    close: () => db.close(),
  };
}
