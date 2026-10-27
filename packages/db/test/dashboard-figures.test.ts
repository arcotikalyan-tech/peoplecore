import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

const ALL = ['people', 'attendance', 'payroll', 'helpdesk', 'separations', 'learning', 'settlements'];
type Listed = { count: number; people: Array<{ name: string }> };
type Figures = {
  active_employees: number | null; headcount_trend: number[] | null; presence: { expected: number; at_work: number; half_days: number } | null;
  snapshot: { total: number; late: Listed; on_leave: Listed; absent: Listed } | null; tasks: number | null; open_tickets: number | null;
};
const names = (l: Listed) => ({ count: l.count, people: l.people.map((p) => p.name) });

describe('dashboard_figures: the dashboard counts in one request', () => {
  it('counts what each person may see, and only the sections asked for', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      // Today: Mira late, Lalit on leave, Pia on her weekly off, Ishan not in yet.
      await tx.query(`insert into attendance_days (organization_id, employee_id, work_date, status, punch_count, late_minutes) values
        ($1, $2, '2026-10-27', 'present', 1, 12), ($1, $3, '2026-10-27', 'on_leave', 0, 0), ($1, $4, '2026-10-27', 'weekly_off', 0, 0)`,
      [f.orgA, f.employees.managerA, f.employees.leadA, f.employees.peerA]);
      const figures = async (sections = ALL, me: string | null = null) =>
        (await tx.query<{ f: Figures }>('select dashboard_figures($1, $2, $3, $4, $5) as f',
          [f.orgA, me, '2026-10-27', sections, ['2023-12-31', '2026-10-27']])).rows[0]!.f;

      await as(tx, f.users.hrA); // the whole organization
      const hr = await figures();
      expect(hr.active_employees).toBe(4);
      expect(hr.headcount_trend).toEqual([0, 4]);
      expect(hr.presence).toEqual({ expected: 2, at_work: 1, half_days: 0 });
      expect(hr.snapshot!.total).toBe(4);
      expect(names(hr.snapshot!.late)).toEqual({ count: 1, people: ['Mira Demo'] });
      expect(names(hr.snapshot!.on_leave)).toEqual({ count: 1, people: ['Lalit Demo'] });
      expect(names(hr.snapshot!.absent)).toEqual({ count: 1, people: ['Ishan Demo'] }); // Pia is off, not absent
      expect(hr.open_tickets).toBe(0);

      // Sections not asked for are not counted at all.
      const none = await figures([]);
      expect([none.active_employees, none.headcount_trend, none.presence, none.snapshot, none.open_tickets, none.tasks]).toEqual([null, null, null, null, null, null]);

      await as(tx, f.users.managerA); // themselves and their reporting line (Lalit, Ishan)
      const manager = await figures(['attendance']);
      expect(manager.snapshot!.total).toBe(3);
      expect([manager.snapshot!.late.count, manager.snapshot!.on_leave.count, manager.snapshot!.absent.count]).toEqual([1, 1, 1]);

      await as(tx, f.users.icA); // only themselves
      const ic = await figures(['people', 'attendance']);
      expect(ic.active_employees).toBe(1);
      expect(names(ic.snapshot!.absent)).toEqual({ count: 1, people: ['Ishan Demo'] });

      await as(tx, f.users.employeeB); // another organization sees nothing
      const outsider = await figures();
      expect(outsider.active_employees).toBe(0);
      expect(outsider.snapshot!.total).toBe(0);
    });
  });
});

describe('attendance_week_counts: the attendance hub trends, counted in the database', () => {
  it('counts each day as the caller, with empty days as zero', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`insert into attendance_days (organization_id, employee_id, work_date, status, punch_count, late_minutes) values
        ($1, $2, '2026-10-26', 'present', 1, 5), ($1, $3, '2026-10-26', 'wfh', 1, 0), ($1, $4, '2026-10-26', 'absent', 0, 0),
        ($1, $2, '2026-10-27', 'on_leave', 0, 0)`, [f.orgA, f.employees.managerA, f.employees.icA, f.employees.peerA]);
      const week = async () => (await tx.query<{ work_date: string; at_work: number; late: number; on_leave: number; absent: number }>(
        `select work_date::text, at_work::int, late::int, on_leave::int, absent::int from attendance_week_counts($1, '2026-10-25', '2026-10-27')`, [f.orgA])).rows;

      await as(tx, f.users.hrA);
      expect(await week()).toEqual([
        { work_date: '2026-10-25', at_work: 0, late: 0, on_leave: 0, absent: 0 },
        { work_date: '2026-10-26', at_work: 2, late: 1, on_leave: 0, absent: 1 },
        { work_date: '2026-10-27', at_work: 0, late: 0, on_leave: 1, absent: 0 },
      ]);

      await as(tx, f.users.icA); // only their own day
      expect((await week())[1]).toEqual({ work_date: '2026-10-26', at_work: 1, late: 0, on_leave: 0, absent: 0 });

      await as(tx, f.users.employeeB); // another organization: every day empty
      expect((await week()).every((d) => d.at_work + d.late + d.on_leave + d.absent === 0)).toBe(true);
    });
  });
});
