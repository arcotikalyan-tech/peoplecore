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

const TODAY = '2026-11-02';
type Member = { name: string; direct: boolean; status: string | null; late: number; punches: unknown[]; leave: { what: string; status: string } | null;
  month: { present: number; expected: number; late: number; leave: number; absent: number } };
type Desks = {
  team: { reports: number; members: Member[]; away: Array<{ name: string; start: string; what: string; status: string }>;
    events: Array<{ kind: string; name: string; on: string; detail: string | null }>; reviews: Array<{ to_rate: number; not_started: number }> } | null;
  hr: { joining: number; probation_due: number; attendance_pending: number; no_manager: number; moves: Array<{ kind: string; name: string }> } | null;
  payroll: { period: string; run: unknown; joiners: number; no_salary: number; attendance_pending: number } | null;
  finance: { runs_to_approve: unknown[]; claims_to_pay: { count: number; amount: number }; invoices_overdue: number } | null;
  hiring: { open_jobs: number; openings: number; stages: Record<string, number>; interviews: unknown[] } | null;
  audit: { recent: Array<{ entity: string }> } | null;
  devices: Array<{ name: string; last_punch: string | null }> | null;
};

describe('dashboard_desks: each role’s desk in one request', () => {
  it('shows a manager their reporting line today, this month and what is coming up', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const { managerA: mira, leadA: lalit, icA: ishan } = f.employees;
      const type = (await tx.query<{ id: string; name: string }>('select id, name from leave_types where organization_id = $1 order by name limit 1', [f.orgA])).rows[0]!;
      // Lalit (reports to Mira) checked in late and is at lunch; he was absent yesterday, is on probation till the 20th
      // and asked to work from home next week. Ishan (reports to Lalit) is on leave and has a work anniversary soon.
      await tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, kind) values
        ($1, $2, '2026-11-02T04:10:00Z', 'web', 'test-in', 'in'), ($1, $2, '2026-11-02T07:30:00Z', 'web', 'test-lunch', 'lunch_start')`, [f.orgA, lalit]);
      // The punches recompute the day; set the figures this test reads.
      await tx.query(`insert into attendance_days (organization_id, employee_id, work_date, status, first_in, worked_minutes, punch_count, late_minutes) values
        ($1, $2, $3, 'present', '2026-11-02T04:10:00Z', 200, 1, 10), ($1, $2, '2026-11-01', 'absent', null, 0, 0, 0)
        on conflict (employee_id, work_date) do update set status = excluded.status, first_in = excluded.first_in, late_minutes = excluded.late_minutes`, [f.orgA, lalit, TODAY]);
      await tx.query(`update employees set probation_end_date = '2026-11-20' where id = $1`, [lalit]);
      await tx.query(`update employees set date_of_joining = '2023-11-10' where id = $1`, [ishan]);
      await tx.query(`insert into leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, days, status, requested_by)
        values ($1, $2, $3, '2026-11-02', '2026-11-04', 3, 'approved', $4)`, [f.orgA, ishan, type.id, f.users.icA]);
      await tx.query(`insert into attendance_requests (organization_id, employee_id, kind, start_date, end_date, reason, status, requested_by)
        values ($1, $2, 'wfh', '2026-11-09', '2026-11-09', 'Plumber visit', 'pending', $3)`, [f.orgA, lalit, f.users.leadA]);
      const cycle = (await tx.query<{ id: string }>(`insert into review_cycles (organization_id, name, period_start, period_end, status)
        values ($1, 'H2 2026', '2026-07-01', '2026-12-31', 'active') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into reviews (organization_id, cycle_id, employee_id, manager_employee_id, status) values
        ($1, $2, $3, $4, 'self_submitted'), ($1, $2, $5, $3, 'not_started')`, [f.orgA, cycle, lalit, mira, ishan]);

      const desks = async (sections: string[]) =>
        (await tx.query<{ d: Desks }>('select dashboard_desks($1, $2, $3) as d', [f.orgA, TODAY, sections])).rows[0]!.d;

      await as(tx, f.users.managerA);
      const d = await desks(['team']);
      expect([d.hr, d.payroll, d.finance, d.hiring, d.audit, d.devices]).toEqual([null, null, null, null, null, null]);
      const team = d.team!;
      expect(team.reports).toBe(1);
      expect(team.members.map((m) => [m.name, m.direct])).toEqual([['Lalit Demo', true], ['Ishan Demo', false]]); // not Mira, not Pia
      const [l, i] = team.members as [Member, Member];
      expect([l.status, l.late, l.punches.length, l.leave]).toEqual(['present', 10, 2, null]);
      expect(l.month).toEqual({ present: 1, expected: 2, late: 1, leave: 0, absent: 1 });
      expect([i.status, i.leave]).toEqual([null, { what: type.name, status: 'approved', half_day: false }]);
      expect(team.away.map((a) => [a.name, a.start, a.status])).toEqual([['Ishan Demo', '2026-11-02', 'approved'], ['Lalit Demo', '2026-11-09', 'pending']]);
      expect(team.events.map((e) => [e.kind, e.name, e.on, e.detail])).toEqual([
        ['anniversary', 'Ishan Demo', '2026-11-10', '3'], ['probation', 'Lalit Demo', '2026-11-20', null],
      ]);
      expect(team.reviews).toEqual([expect.objectContaining({ to_rate: 1, not_started: 0 })]); // Ishan's review is Lalit's

      // Someone with no reports has no team; someone with a report but only the Employee role can't read it, and is told why.
      await as(tx, f.users.icA);
      expect((await desks(['team'])).team).toMatchObject({ reports: 0, members: [] });
      await as(tx, f.users.leadA);
      expect((await desks(['team'])).team).toMatchObject({ reports: 1, members: [] });
      await as(tx, f.users.employeeB);
      expect((await desks(['team'])).team).toMatchObject({ reports: 0, members: [], away: [], events: [] });
    });
  });

  it('gives HR, payroll, finance, recruiters, auditors and device admins their own desks, read as themselves', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      // Nora joins on the 15th; Lalit's probation ends on the 20th; Ishan asked to work from home.
      await tx.query(`insert into employees (organization_id, employee_code, first_name, last_name, work_email, status, employment_type, date_of_joining, manager_employee_id)
        values ($1, 'A-009', 'Nora', 'Demo', 'nora@example.test', 'pre_joining', 'permanent', '2026-11-15', $2)`, [f.orgA, f.employees.peerA]);
      await tx.query(`update employees set probation_end_date = '2026-11-20' where id = $1`, [f.employees.leadA]);
      await tx.query(`insert into attendance_requests (organization_id, employee_id, kind, start_date, end_date, reason, status, requested_by)
        values ($1, $2, 'wfh', '2026-11-05', '2026-11-05', 'Plumber visit', 'pending', $3)`, [f.orgA, f.employees.icA, f.users.icA]);
      await tx.query(`insert into job_requisitions (organization_id, code, title, openings, status) values ($1, 'REQ-1', 'Accountant', 2, 'open')`, [f.orgA]);
      await tx.query(`insert into audit_events (organization_id, action, entity_type, metadata) values ($1, 'update', 'dashboard_test', '{}')`, [f.orgA]);
      const device = (await tx.query<{ id: string }>(`insert into biometric_devices (organization_id, serial_number, name) values ($1, 'ZK-001', 'Front door') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into attendance_punches (organization_id, employee_id, punched_at, method, source_key, device_id)
        values ($1, $2, '2026-11-02T03:55:00Z', 'biometric', 'zk-1', $3)`, [f.orgA, f.employees.peerA, device]);

      const desks = async (sections: string[]) =>
        (await tx.query<{ d: Desks }>('select dashboard_desks($1, $2, $3) as d', [f.orgA, TODAY, sections])).rows[0]!.d;
      const ALL = ['team', 'hr', 'payroll', 'finance', 'hiring', 'audit', 'devices'];

      await as(tx, f.users.hrA);
      const hr = (await desks(['hr'])).hr!;
      expect([hr.joining, hr.probation_due, hr.attendance_pending, hr.no_manager]).toEqual([1, 1, 1, 2]); // Mira and Pia have no manager
      expect(hr.moves.map((m) => [m.kind, m.name])).toEqual([['joining', 'Nora Demo'], ['probation', 'Lalit Demo']]);

      await as(tx, f.users.payrollA);
      const pay = (await desks(['payroll'])).payroll!;
      expect([pay.period, pay.run, pay.joiners, pay.attendance_pending]).toEqual(['2026-11-01', null, 1, 1]); // no payroll locked yet
      expect(pay.no_salary).toBe(4); // nobody has a salary; Nora hasn't joined

      await as(tx, f.users.ownerA);
      const owner = await desks(['finance', 'devices']);
      expect(owner.finance).toMatchObject({ runs_to_approve: [], claims_to_pay: { count: 0, amount: 0 }, invoices_overdue: 0 });
      expect(owner.devices!.map((x) => [x.name, x.last_punch !== null])).toEqual([['Front door', true]]);

      await as(tx, f.users.recruiterA);
      expect((await desks(['hiring'])).hiring).toMatchObject({ open_jobs: 1, openings: 2, stages: { applied: 0, screening: 0, interview: 0, offer: 0 }, interviews: [] });

      await as(tx, f.users.auditorA);
      expect((await desks(['audit'])).audit!.recent.map((r) => r.entity)).toContain('dashboard_test');

      // A manager asking for other desks reads only what they may: their own line, no audit log, no one else's punches.
      await as(tx, f.users.managerA);
      const manager = await desks(['hr', 'audit', 'devices']);
      expect([manager.hr!.joining, manager.hr!.attendance_pending]).toEqual([0, 1]); // Nora isn't in Mira's line; Ishan is
      expect([manager.audit!.recent, manager.devices!.map((x) => x.last_punch)]).toEqual([[], [null]]);

      // Another organization's member sees none of it.
      await as(tx, f.users.employeeB);
      const outsider = await desks(ALL);
      expect([outsider.hr!.joining, outsider.hr!.no_manager, outsider.hiring!.open_jobs, outsider.audit!.recent, outsider.devices]).toEqual([0, 0, 0, [], []]);
      expect(outsider.payroll!.no_salary).toBe(0);
    });
  });
});
