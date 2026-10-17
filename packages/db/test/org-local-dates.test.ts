import { describe, expect, it } from 'vitest';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

/**
 * At any UTC hour, at least one of these zones is on a different calendar day than UTC
 * (UTC+14 is ahead from 10:00 UTC, UTC−11 is behind until 11:00 UTC), so the UTC-vs-local mistake
 * is always exercised.
 */
const FAR_ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];

describe('"today" is the organization’s local date', () => {
  for (const zone of FAR_ZONES) {
    it(`an assignment effective today updates the current snapshot (${zone})`, async () => {
      const { f, t } = ctx;
      await t.db.query('update organizations set timezone = $1 where id = $2', [zone, f.orgA]);
      try {
        await t.asUser(f.users.hrA, async (tx) => {
          const today = (await tx.query<{ d: string }>(`select (now() at time zone $1)::date::text as d`, [zone])).rows[0]!.d;
          const id = (await tx.query<{ id: string }>(`select create_employee($1, 'Zoned', 'permanent', '2025-01-01') as id`, [f.orgA])).rows[0]!.id;
          await tx.query(`select change_employee_assignment($1, $2::date, 'transfer', p_department_id => $3)`, [id, today, f.deptA]);
          const { rows } = await tx.query<{ department_id: string }>('select department_id from employees where id = $1', [id]);
          expect(rows[0]!.department_id).toBe(f.deptA);
        });
      } finally {
        await t.db.query(`update organizations set timezone = 'Asia/Kolkata' where id = $1`, [f.orgA]);
      }
    });

    it(`someone joining today is active, tomorrow is pre-joining (${zone})`, async () => {
      const { f, t } = ctx;
      await t.db.query('update organizations set timezone = $1 where id = $2', [zone, f.orgA]);
      try {
        await t.asUser(f.users.hrA, async (tx) => {
          const today = (await tx.query<{ d: string }>(`select (now() at time zone $1)::date::text as d`, [zone])).rows[0]!.d;
          const status = async (offset: number) => {
            const id = (await tx.query<{ id: string }>(
              `select create_employee($1, 'Joiner', 'permanent', $2::date + $3::int) as id`, [f.orgA, today, offset])).rows[0]!.id;
            return (await tx.query<{ status: string }>('select status from employees where id = $1', [id])).rows[0]!.status;
          };
          expect(await status(0)).toBe('active');
          expect(await status(1)).toBe('pre_joining');
        });
      } finally {
        await t.db.query(`update organizations set timezone = 'Asia/Kolkata' where id = $1`, [f.orgA]);
      }
    });
  }
});
