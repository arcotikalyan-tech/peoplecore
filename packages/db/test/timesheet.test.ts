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

async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return { code: (err as { code?: string }).code, message: (err as Error).message };
  }
  throw new Error(`expected to fail: ${sql}`);
}

/** HR sets up a client (USD), an external project with a fee budget and a task, and adds Ishan and Pia as members. */
async function workspace(tx: Transaction, f: typeof ctx.f) {
  await tx.query(`insert into ts_members (organization_id, employee_id, rate) values ($1, $2, 1000), ($1, $3, 800)`, [f.orgA, f.employees.icA, f.employees.peerA]);
  const client = (await tx.query<{ id: string }>(`insert into ts_clients (organization_id, name, currency, rate) values ($1, 'Acme', 'USD', 50) returning id`, [f.orgA])).rows[0]!.id;
  const project = (await tx.query<{ id: string }>(`insert into ts_projects (organization_id, name, client_id, budget_type, budget_amount, manager_employee_id)
    values ($1, 'Nimbus', $2, 'fees', 10000, $3) returning id`, [f.orgA, client, f.employees.leadA])).rows[0]!.id;
  const task = (await tx.query<{ id: string }>(`insert into ts_tasks (organization_id, project_id, name, rate) values ($1, $2, 'Development', 60) returning id`, [f.orgA, project])).rows[0]!.id;
  await tx.query(`insert into ts_project_members (organization_id, project_id, employee_id) values ($1, $2, $3), ($1, $2, $4)`, [f.orgA, project, f.employees.icA, f.employees.peerA]);
  return { client, project, task };
}

const day = async (tx: Transaction, org: string, offset: number) =>
  (await tx.query<{ d: string }>(`select to_char(app.org_today($1) + $2::int, 'YYYY-MM-DD') as d`, [org, offset])).rows[0]!.d;

describe('timesheet', () => {
  it('members log time under the rules; managers approve their reports; nobody approves their own', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const { project, task } = await workspace(tx, f);
      const yesterday = await day(tx, f.orgA, -1);

      await as(tx, f.users.icA);
      // 09:00–10:07 rounds to the nearest 15 minutes; the task's rate and the client's currency are fixed on the entry.
      const r = (await tx.query<{ v: { id: string; minutes: number } }>(`select ts_log_time($1, $2, $3, '09:00', '10:07', null, 'Build', true) as v`, [project, task, yesterday])).rows[0]!.v;
      expect(r.minutes).toBe(60);
      expect((await tx.query<{ rate: string; currency: string; status: string }>('select rate, currency, status from ts_entries where id = $1', [r.id])).rows[0])
        .toMatchObject({ rate: '60.00', currency: 'USD', status: 'pending' });
      // Overlap warns by default; future days are blocked.
      const warn = (await tx.query<{ v: { warning: string } }>(`select ts_log_time($1, $2, $3, '09:30', '10:00', null, null, true) as v`, [project, task, yesterday])).rows[0]!.v;
      expect(warn.warning).toContain('overlaps');
      expect((await failure(tx, `select ts_log_time($1, $2, $3, null, null, 60, null, true)`, [project, task, await day(tx, f.orgA, 2)])).message).toContain('future');
      // Not a workspace member.
      await as(tx, f.users.leadA);
      expect((await failure(tx, `select ts_log_time($1, null, $2, null, null, 60, null, true)`, [project, yesterday])).message).toContain('workspace members');

      // Pia can't see Ishan's entries; his manager can, and approves; Ishan can't approve his own.
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from ts_entries where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select ts_decide($1, $2)', [[r.id], 'approve'])).message).toContain('own time');
      await as(tx, f.users.leadA);
      expect((await failure(tx, 'select ts_decide($1, $2)', [[r.id], 'reject'])).message).toContain('reason');
      expect((await tx.query<{ n: number }>('select ts_decide($1, $2) as n', [[r.id], 'approve'])).rows[0]!.n).toBe(1);
      expect((await tx.query<{ status: string }>('select status from ts_entries where id = $1', [r.id])).rows[0]!.status).toBe('approved');
      // Approved entries are locked.
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select ts_delete_entry($1)', [r.id])).message).toContain('pending or rejected');

      // The other organization sees nothing.
      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from ts_entries')).rows).toHaveLength(0);
      expect((await tx.query('select 1 from ts_projects')).rows).toHaveLength(0);
    });
  });

  it('settings: manager then admin, billable cap, lock date and blocked days', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const { project, task } = await workspace(tx, f);
      const yesterday = await day(tx, f.orgA, -1);
      await tx.query(`insert into timesheet_settings (organization_id, approval_flow, max_billable, max_billable_hours, rounding)
        values ($1, 'manager_then_admin', 'day', 2, 0)`, [f.orgA]);

      await as(tx, f.users.icA);
      const id = (await tx.query<{ v: { id: string } }>(`select ts_log_time($1, $2, $3, null, null, 90, null, true) as v`, [project, task, yesterday])).rows[0]!.v.id;
      expect((await failure(tx, `select ts_log_time($1, $2, $3, null, null, 45, null, true)`, [project, task, yesterday])).message).toContain('billable limit');
      await tx.query(`select ts_log_time($1, $2, $3, null, null, 45, null, false)`, [project, task, yesterday]);

      await as(tx, f.users.leadA);
      await tx.query('select ts_decide($1, $2)', [[id], 'approve']);
      expect((await tx.query<{ status: string }>('select status from ts_entries where id = $1', [id])).rows[0]!.status).toBe('manager_approved');
      await as(tx, f.users.hrA);
      await tx.query('select ts_decide($1, $2)', [[id], 'approve']);
      expect((await tx.query<{ status: string }>('select status from ts_entries where id = $1', [id])).rows[0]!.status).toBe('approved');

      await tx.query(`update timesheet_settings set lock_before = app.org_today($1), restrict_days = '{future,weekend}' where organization_id = $1`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select ts_log_time($1, $2, $3, null, null, 30, null, false)`, [project, task, yesterday])).message).toContain('locked');
    });
  });

  it('timer, copying last week, invoices at the rate on the day, and reminders', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const { client, project, task } = await workspace(tx, f);
      const lastWeek = await day(tx, f.orgA, -8);

      await as(tx, f.users.icA);
      await tx.query(`select ts_start_timer($1, $2, 'Pairing', true)`, [project, task]);
      expect((await failure(tx, `select ts_start_timer($1, $2, null, true)`, [project, task])).message).toContain('already running');
      await tx.exec('reset role');
      await tx.query(`update ts_timers set started_at = now() - interval '50 minutes' where employee_id = $1`, [f.employees.icA]);
      await as(tx, f.users.icA);
      const stopped = (await tx.query<{ v: { id: string; minutes: number } }>('select ts_stop_timer($1) as v', [f.orgA])).rows[0]!.v;
      expect(stopped.minutes).toBeGreaterThanOrEqual(45);
      // Timer entries follow the timer-edit setting.
      await as(tx, f.users.hrA);
      await tx.query(`insert into timesheet_settings (organization_id, timer_edit) values ($1, '{admin}')`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select ts_delete_entry($1)', [stopped.id])).message).toContain('Timer entries');
      await as(tx, f.users.leadA);
      expect((await failure(tx, 'select ts_adjust_entry($1, 30, true, null)', [stopped.id])).message).toContain('Timer entries');
      await as(tx, f.users.icA);

      const old = (await tx.query<{ v: { id: string } }>(`select ts_log_time($1, $2, $3, null, null, 120, 'Old work', true) as v`, [project, task, lastWeek])).rows[0]!.v.id;
      const weekStart = await day(tx, f.orgA, -1);
      const copy = (await tx.query<{ v: { copied: number } }>('select ts_copy_last_week($1, $2) as v', [f.orgA, weekStart])).rows[0]!.v;
      expect(copy.copied).toBeGreaterThanOrEqual(0);

      // The rate changes after the log; the invoice keeps the rate on the entry.
      await as(tx, f.users.hrA);
      await tx.query('select ts_decide($1, $2)', [[old], 'approve']);
      await tx.query(`update ts_tasks set rate = 999 where id = $1`, [task]);
      const inv = (await tx.query<{ id: string }>('select ts_generate_invoice($1, $2, null, $3, $3) as id', [f.orgA, client, lastWeek])).rows[0]!.id;
      expect((await tx.query<{ number: string; total: string; currency: string; minutes: number }>('select number, total, currency, minutes from ts_invoices where id = $1', [inv])).rows[0])
        .toMatchObject({ number: 'INV-0001', total: '120.00', currency: 'USD', minutes: 120 });
      expect((await failure(tx, 'select ts_generate_invoice($1, $2, null, $3, $3)', [f.orgA, client, lastWeek])).message).toContain('No approved billable time');
      await tx.query(`select ts_set_invoice_status($1, 'void')`, [inv]);
      expect((await tx.query('select 1 from ts_entries where invoice_id = $1', [inv])).rows).toHaveLength(0);
      // Employees can't invoice.
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select ts_generate_invoice($1, $2, null, $3, $3)', [f.orgA, client, lastWeek])).code).toBe('42501');

      await tx.exec('reset role');
      const reminded = (await tx.query<{ v: { missing: number; weekly: number } }>('select worker_timesheet_reminders() as v')).rows[0]!.v;
      expect(reminded).toHaveProperty('missing');
    });
  });

  it('a timer that runs past midnight keeps all its time: before midnight on its day, the rest on the next', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const { project, task } = await workspace(tx, f);
      await as(tx, f.users.icA);
      await tx.query(`select ts_start_timer($1, $2, 'Late release', false)`, [project, task]);
      await tx.exec('reset role');
      // Started at 23:30 yesterday, the organization's time; stopped now.
      await tx.query(`update ts_timers set started_at = ((app.org_today($2) - 1) + time '23:30') at time zone 'Asia/Kolkata' where employee_id = $1`, [f.employees.icA, f.orgA]);
      await as(tx, f.users.icA);
      const stopped = (await tx.query<{ v: { minutes: number } }>('select ts_stop_timer($1) as v', [f.orgA])).rows[0]!.v;
      await tx.exec('reset role');
      const entries = (await tx.query<{ day: string; start: string; end: string; minutes: number }>(
        `select (work_date - app.org_today($2))::int::text as day, start_time::text as start, end_time::text as end, minutes
           from ts_entries where employee_id = $1 and description = 'Late release' order by work_date`, [f.employees.icA, f.orgA])).rows;
      expect(entries[0]).toMatchObject({ day: '-1', start: '23:30:00', end: '23:59:00', minutes: 30 });
      expect(entries[1]).toMatchObject({ day: '0', start: '00:00:00' });
      expect(stopped.minutes).toBe(30 + entries[1]!.minutes);
    });
  });
});

