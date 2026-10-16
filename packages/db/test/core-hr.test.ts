import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('create_employee', () => {
  it('generates sequential codes per org and opens a joining record', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const ids: string[] = [];
      for (const name of ['Tara', 'Uday']) {
        const { rows } = await tx.query<{ id: string }>(
          `select create_employee($1, $2, 'contract', '2026-02-01', p_department_id => $3) as id`, [f.orgA, name, f.deptA]);
        ids.push(rows[0]!.id);
      }
      const emps = await tx.query<{ employee_code: string }>(
        'select employee_code from employees where id = any($1) order by employee_code', [ids]);
      expect(emps.rows.map((r) => r.employee_code)).toEqual(['EMP00001', 'EMP00002']);

      const hist = await tx.query<{ change_reason: string; effective_from: Date; effective_to: Date | null }>(
        'select change_reason, effective_from, effective_to from employment_records where employee_id = $1', [ids[0]]);
      expect(hist.rows).toHaveLength(1);
      expect(hist.rows[0]).toMatchObject({ change_reason: 'joining', effective_to: null });
    });
  });

  it('marks future joiners as pre_joining', async () => {
    await ctx.t.asUser(ctx.f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(
        `select create_employee($1, 'Future', 'intern', current_date + 30) as id`, [ctx.f.orgA])).rows[0]!.id;
      const { rows } = await tx.query<{ status: string }>('select status from employees where id = $1', [id]);
      expect(rows[0]!.status).toBe('pre_joining');
    });
  });

  it('rejects duplicate work emails case-insensitively within an org, but not across orgs', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.hrA, (tx) =>
        tx.query(`select create_employee($1, 'Dup', 'permanent', '2026-01-01', p_work_email => 'MIRA@example.test')`, [f.orgA]))),
    ).toBe('23505');
    await ctx.t.asUser(f.users.ownerB, (tx) =>
      tx.query(`select create_employee($1, 'Mira', 'permanent', '2026-01-01', p_work_email => 'mira@example.test')`, [f.orgB]));
  });
});

describe('change_employee_assignment', () => {
  it('closes the open record the day before and opens a new one', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(
        `select create_employee($1, 'Vik', 'permanent', '2025-01-01') as id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select change_employee_assignment($1, '2025-06-01', 'transfer', $2, null, null, $3)`,
        [id, f.deptA, f.employees.managerA]);

      const { rows } = await tx.query<{ from: string; to: string | null; reason: string }>(
        `select effective_from::text as from, effective_to::text as to, change_reason as reason
           from employment_records where employee_id = $1 order by effective_from`, [id]);
      expect(rows).toEqual([
        { from: '2025-01-01', to: '2025-05-31', reason: 'joining' },
        { from: '2025-06-01', to: null, reason: 'transfer' },
      ]);
      const snap = await tx.query<{ department_id: string; manager_employee_id: string }>(
        'select department_id, manager_employee_id from employees where id = $1', [id]);
      expect(snap.rows[0]).toEqual({ department_id: f.deptA, manager_employee_id: f.employees.managerA });
    });
  });

  it('rejects effective dates on or before the current record start', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.hrA, async (tx) => {
        const id = (await tx.query<{ id: string }>(`select create_employee($1, 'Wen', 'permanent', '2025-01-01') as id`, [f.orgA])).rows[0]!.id;
        await tx.query(`select change_employee_assignment($1, '2025-01-01', 'transfer', null, null, null, null)`, [id]);
      })),
    ).toBe('22023');
  });

  it('the database itself refuses overlapping history', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.hrA, (tx) =>
        tx.query(`insert into employment_records (organization_id, employee_id, effective_from, employment_type, change_reason)
                  values ($1, $2, '2024-06-01', 'permanent', 'correction')`, [f.orgA, f.employees.icA]).then(() =>
          tx.query(`insert into employment_records (organization_id, employee_id, effective_from, employment_type, change_reason)
                    values ($1, $2, '2024-07-01', 'permanent', 'correction')`, [f.orgA, f.employees.icA])))),
    ).toBe('23P01');
  });

  it('requires employee.update', async () => {
    expect(
      await pgError(ctx.t.asUser(ctx.f.users.managerA, (tx) =>
        tx.query(`select change_employee_assignment($1, current_date, 'transfer', null, null, null, null)`, [ctx.f.employees.leadA]))),
    ).toBe('42501');
  });
});
