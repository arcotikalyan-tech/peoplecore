import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

/** Migration 20261022001200: organization setup progress for the people who run setup. */
const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

type Status = Record<string, unknown> & { marks: Record<string, string> };
const status = async (tx: Transaction, org: string) =>
  (await tx.query<{ s: Status | null }>('select org_setup_status($1) as s', [org])).rows[0]!.s;

describe('organization setup', () => {
  it('shows the people who run setup what the data already says, the same for each of them, and nobody else', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const first = (await status(tx, f.orgA))!;
      // The General shift and the standard leave types come with every new company: not "done" until changed or confirmed.
      expect(first).toMatchObject({ shifts_changed: false, leave_changed: false, employees: 4, signed_in: 4, managers: true, hr_team: true, bank: false, marks: {} });
      expect(first.members).toBeGreaterThan(1);

      await tx.exec('reset role');
      await tx.query(`update shifts set start_time = '10:00', end_time = '19:00' where organization_id = $1 and code = 'GEN'`, [f.orgA]);
      await tx.query(`insert into leave_types (organization_id, code, name) values ($1, 'ML', 'Maternity leave')`, [f.orgA]);
      await tx.query(`insert into holidays (organization_id, calendar_id, holiday_date, name)
        select $1, c.id, make_date(extract(year from current_date)::int, 12, 25), 'Christmas' from holiday_calendars c where c.organization_id = $1 limit 1`, [f.orgA]);
      await as(tx, f.users.hrA);
      await tx.query(`insert into org_setup_steps (organization_id, step_key, status) values ($1, 'work_week', 'done'), ($1, 'bank', 'skipped')`, [f.orgA]);
      const later = (await status(tx, f.orgA))!;
      expect(later).toMatchObject({ shifts_changed: true, leave_changed: true, holidays: true, marks: { work_week: 'done', bank: 'skipped' } });

      await as(tx, f.users.ownerA);
      expect(await status(tx, f.orgA)).toEqual(later);
      for (const outsider of [f.users.icA, f.users.payrollA, f.users.ownerB]) {
        await as(tx, outsider);
        expect(await status(tx, f.orgA)).toBeNull();
      }
    });
  });

  it('keeps only done or skipped marks, changed by the people who run setup', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query(`insert into org_setup_steps (organization_id, step_key, status) values ($1, 'shifts', 'maybe')`, [f.orgA])))).toBe('23514');
    expect(await pgError(t.asUser(f.users.icA, (tx) => tx.query(`insert into org_setup_steps (organization_id, step_key, status) values ($1, 'shifts', 'done')`, [f.orgA])))).toBe('42501');
  });
});
