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

  // Tables whose sensitive text is read only through functions, not the table: grievance texts (each handler's read
  // is audited, migration 20261018002400: the case table grants its non-text columns, the notes table nothing) and
  // why someone left (migration 20261018002800: reason and exit interview, for the employee and HR only).
  // Adding a table here needs the same review.
  const READ_THROUGH_AUDITED_FUNCTIONS = ['grievance_notes', 'grievances', 'separations'];

  it('signed-in users can read every table (RLS then filters rows), except the audited-read ones', async () => {
    const all = await ctx.t.db.query<{ relname: string }>(
      `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(await tablesWhere('authenticated', 'SELECT'))
      .toEqual(all.rows.map((r) => r.relname).filter((t) => !READ_THROUGH_AUDITED_FUNCTIONS.includes(t)));
  });

  it('grievance descriptions, outcomes and messages are not readable through the tables', async () => {
    const { rows } = await ctx.t.db.query<{ col: string; ok: boolean }>(
      `select c.col, has_column_privilege('authenticated', 'public.grievances', c.col, 'SELECT') as ok
         from unnest(array['description', 'outcome', 'subject']) c(col)`,
    );
    expect(rows).toEqual([{ col: 'description', ok: false }, { col: 'outcome', ok: false }, { col: 'subject', ok: true }]);
    expect(await tablesWhere('authenticated', 'SELECT,INSERT,UPDATE,DELETE').then((t) => t.includes('grievance_notes'))).toBe(false);
  });

  it('anonymous users can execute only the reviewed careers-page functions', async () => {
    // The one public use case (migration 20261018001400, docs/07-threat-model.md T17): list published
    // openings and apply with consent. Adding anything here needs the same review.
    const { rows } = await ctx.t.db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['public_job_postings', 'submit_public_application']);
  });

  it('anonymous users can read or write no table', async () => {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(await tablesWhere('anon', privilege), privilege).toEqual([]);
    }
  });

  it('append-only and never-deleted tables cannot be deleted from by signed-in users', async () => {
    const deletable = await tablesWhere('authenticated', 'DELETE');
    for (const table of ['audit_events', 'employees', 'employment_records', 'organizations', 'permissions', 'platform_admins']) {
      expect(deletable, table).not.toContain(table);
    }
  });
});
