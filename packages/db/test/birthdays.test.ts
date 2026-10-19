import { describe, expect, it } from 'vitest';
import { useDatabase } from './setup.ts';

/** Migration 20261019000500: colleagues see upcoming birthdays (day and month only), never other organizations'. */
const ctx = useDatabase();

describe('upcoming birthdays', () => {
  it('lists colleagues’ next birthdays without the year; other organizations see nothing', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      await t.db.query(`insert into employee_personal (organization_id, employee_id, date_of_birth)
                        values ($1, $2, (app.org_today($1) + 3 - interval '30 years')::date)`, [f.orgA, f.employees.peerA]);
      await t.db.query(`insert into employee_personal (organization_id, employee_id, date_of_birth)
                        values ($1, $2, (app.org_today($1) + 200 - interval '25 years')::date)`, [f.orgA, f.employees.leadA]);
      await t.db.exec('commit');
    } catch (e) {
      await t.db.exec('rollback');
      throw e;
    }
    try {
      await t.asUser(f.users.icA, async (tx) => {
        const rows = (await tx.query<Record<string, unknown>>('select * from upcoming_birthdays($1, 30)', [f.orgA])).rows;
        expect(rows.map((r) => r.employee_id)).toEqual([f.employees.peerA]);
        expect(Object.keys(rows[0]!).sort()).toEqual(['employee_id', 'name', 'next_birthday']);
        const today = (await tx.query<{ d: string }>(`select to_char(app.org_today($1) + 3, 'YYYY-MM-DD') as d`, [f.orgA])).rows[0]!.d;
        expect(String((rows[0]!.next_birthday as Date).toISOString?.() ?? rows[0]!.next_birthday).slice(0, 10)).toBe(today);
      });
      await t.asUser(f.users.employeeB, async (tx) => {
        expect((await tx.query('select * from upcoming_birthdays($1, 366)', [f.orgA])).rows).toHaveLength(0);
      });
    } finally {
      await t.db.query('delete from employee_personal where employee_id in ($1, $2)', [f.employees.peerA, f.employees.leadA]);
    }
  });
});
