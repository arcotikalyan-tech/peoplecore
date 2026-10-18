import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

interface Result { applied: number; activated: number; failures: Array<{ employee_id: string; step: string }> }
const runDaily = async () => (await ctx.t.db.query<{ r: Result }>('select worker_daily_core_hr() as r')).rows[0]!.r;

/** Creates an employee as HR (committed) and returns its id. */
async function hire(name: string, joiningOffsetDays: number, dept: string | null) {
  const { f, t } = ctx;
  await t.db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: f.users.hrA, role: 'authenticated', aal: 'aal2' })]);
  const { rows } = await t.db.query<{ id: string }>(
    `select create_employee($1, $2, 'permanent', app.org_today($1) + $3::int, p_department_id => $4) as id`,
    [f.orgA, name, joiningOffsetDays, dept]);
  return rows[0]!.id;
}

/** Moves an employee's open-ended future record to start yesterday (as if time had passed). */
async function makeDue(employee: string) {
  await ctx.t.db.query(
    `update employment_records set effective_to = app.org_today(organization_id) - 2
      where employee_id = $1 and effective_to is not null`, [employee]);
  await ctx.t.db.query(
    `update employment_records set effective_from = app.org_today(organization_id) - 1
      where employee_id = $1 and effective_to is null`, [employee]);
}

describe('worker_daily_core_hr', () => {
  it('applies a future-dated transfer once it is due, and only then', async () => {
    const { f, t } = ctx;
    const ops = (await t.db.query<{ id: string }>(`insert into departments (organization_id, code, name) values ($1, 'OPS2', 'Ops') returning id`, [f.orgA])).rows[0]!.id;
    const id = await hire('Future', -30, f.deptA);
    await t.db.query(`select change_employee_assignment($1, app.org_today($2) + 7, 'transfer', $3)`, [id, f.orgA, ops]);

    expect((await runDaily()).applied).toBe(0);
    expect((await t.db.query<{ d: string }>('select department_id as d from employees where id = $1', [id])).rows[0]!.d).toBe(f.deptA);

    await makeDue(id);
    expect((await runDaily()).applied).toBe(1);
    expect((await t.db.query<{ d: string }>('select department_id as d from employees where id = $1', [id])).rows[0]!.d).toBe(ops);
    expect((await runDaily()).applied).toBe(0); // idempotent
  });

  it('activates joiners on their joining date and emits employee.joined once', async () => {
    const { t } = ctx;
    const id = await hire('Joiner', 3, null);
    expect((await t.db.query<{ s: string }>('select status as s from employees where id = $1', [id])).rows[0]!.s).toBe('pre_joining');
    expect((await runDaily()).activated).toBe(0);

    await t.db.query(`update employees set date_of_joining = app.org_today(organization_id) where id = $1`, [id]);
    expect((await runDaily()).activated).toBe(1);
    expect((await t.db.query<{ s: string }>('select status as s from employees where id = $1', [id])).rows[0]!.s).toBe('active');
    expect((await runDaily()).activated).toBe(0);
    const events = await t.db.query(`select 1 from app.domain_events where event_type = 'employee.joined' and subject_id = $1`, [id]);
    expect(events.rows).toHaveLength(1);
    expect((await t.db.query(`select 1 from app.jobs where idempotency_key = $1`, [`event:employee.joined:${id}`])).rows).toHaveLength(1);
  });

  it('reports a record that can no longer apply, without blocking the others', async () => {
    const { f, t } = ctx;
    const gone = (await t.db.query<{ id: string }>(`insert into departments (organization_id, code, name) values ($1, 'GONE2', 'Gone') returning id`, [f.orgA])).rows[0]!.id;
    const ok = (await t.db.query<{ id: string }>(`insert into departments (organization_id, code, name) values ($1, 'OK2', 'Ok') returning id`, [f.orgA])).rows[0]!.id;
    const blocked = await hire('Blocked', -30, null);
    const fine = await hire('Fine', -30, null);
    await t.db.query(`select change_employee_assignment($1, app.org_today($2) + 7, 'transfer', $3)`, [blocked, f.orgA, gone]);
    await t.db.query(`select change_employee_assignment($1, app.org_today($2) + 7, 'transfer', $3)`, [fine, f.orgA, ok]);
    await t.db.query(`update departments set archived_at = now() where id = $1`, [gone]); // nobody uses it today
    await makeDue(blocked);
    await makeDue(fine);

    const result = await runDaily();
    expect(result.applied).toBe(1);
    expect(result.failures).toEqual([expect.objectContaining({ employee_id: blocked, step: 'assignment' })]);
    expect((await t.db.query<{ d: string }>('select department_id as d from employees where id = $1', [fine])).rows[0]!.d).toBe(ok);
  });

  it('is only callable by the service role', async () => {
    expect(await pgError(ctx.t.asUser(ctx.f.users.ownerA, (tx) => tx.query('select worker_daily_core_hr()')))).toBe('42501');
  });
});
