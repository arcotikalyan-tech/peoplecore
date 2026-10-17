import { describe, expect, it } from 'vitest';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

async function tablesWhere(role: string, privileges: string): Promise<string[]> {
  const { rows } = await ctx.t.db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege($1, c.oid, $2)
      order by 1`,
    [role, privileges],
  );
  return rows.map((r) => r.relname);
}

describe('table privileges (least privilege, independent of Supabase defaults)', () => {
  it('anonymous users hold no privileges on any table', async () => {
    expect(await tablesWhere('anon', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')).toEqual([]);
  });

  it('signed-in users never hold privileges that bypass RLS', async () => {
    expect(await tablesWhere('authenticated', 'TRUNCATE,REFERENCES,TRIGGER')).toEqual([]);
  });

  it('signed-in users can read every table (RLS then filters rows)', async () => {
    const all = await ctx.t.db.query<{ relname: string }>(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(await tablesWhere('authenticated', 'SELECT')).toEqual(all.rows.map((r) => r.relname));
  });

  it('anonymous users cannot execute any API function', async () => {
    const { rows } = await ctx.t.db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('append-only and never-deleted tables cannot be deleted from by signed-in users', async () => {
    const deletable = await tablesWhere('authenticated', 'DELETE');
    for (const table of ['audit_events', 'employees', 'employment_records', 'organizations', 'permissions', 'platform_admins']) {
      expect(deletable, table).not.toContain(table);
    }
  });
});
