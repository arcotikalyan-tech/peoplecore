import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

async function visibleEmployeeCodes(userId: string): Promise<string[]> {
  return ctx.t.asUser(userId, async (tx) => {
    const { rows } = await tx.query<{ employee_code: string }>('select employee_code from employees order by employee_code');
    return rows.map((r) => r.employee_code);
  });
}

describe('permission scopes on employees', () => {
  it('org scope: HR, payroll and auditors see every employee in their org', async () => {
    for (const u of ['hrA', 'payrollA', 'auditorA', 'ownerA'] as const) {
      expect(await visibleEmployeeCodes(ctx.f.users[u]), u).toEqual(['A-001', 'A-002', 'A-003', 'A-004']);
    }
  });

  it('self scope: an employee sees only themselves', async () => {
    expect(await visibleEmployeeCodes(ctx.f.users.icA)).toEqual(['A-003']);
    expect(await visibleEmployeeCodes(ctx.f.users.peerA)).toEqual(['A-004']);
  });

  it('team scope: a manager sees direct and indirect reports, not peers', async () => {
    expect(await visibleEmployeeCodes(ctx.f.users.managerA)).toEqual(['A-001', 'A-002', 'A-003']);
  });

  it('recruiters get no employee rows until the restricted directory view exists', async () => {
    expect(await visibleEmployeeCodes(ctx.f.users.recruiterA)).toEqual([]);
  });

  it('employment history follows the same scope', async () => {
    await ctx.t.asUser(ctx.f.users.managerA, async (tx) => {
      const { rows } = await tx.query('select 1 from employment_records where employee_id = $1', [ctx.f.employees.peerA]);
      expect(rows).toHaveLength(0);
    });
  });
});

describe('write permissions', () => {
  it('read-only roles and employees cannot update employees', async () => {
    for (const u of ['auditorA', 'managerA', 'icA'] as const) {
      const affected = await ctx.t.asUser(ctx.f.users[u], async (tx) =>
        (await tx.query(`update employees set first_name = 'x' where id = $1`, [ctx.f.employees.icA])).affectedRows);
      expect(affected, u).toBe(0);
    }
  });

  it('payroll admins cannot create employees', async () => {
    expect(
      await pgError(ctx.t.asUser(ctx.f.users.payrollA, (tx) =>
        tx.query(`select create_employee($1, 'Nope', 'permanent', '2026-01-01')`, [ctx.f.orgA]))),
    ).toBe('42501');
  });

  it('nobody can hard-delete employees, not even the owner', async () => {
    expect(
      await pgError(ctx.t.asUser(ctx.f.users.ownerA, (tx) => tx.query('delete from employees where id = $1', [ctx.f.employees.icA]))),
    ).toBe('42501');
  });

  it('an employee cannot grant themselves a role', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.icA, (tx) =>
        tx.query(
          `insert into member_roles (organization_id, member_id, role_id)
           select $1, m.id, r.id from organization_members m, roles r
            where m.user_id = $2 and m.organization_id = $1 and r.organization_id = $1 and r.key = 'hr_admin'`,
          [f.orgA, f.users.icA],
        ))),
    ).toBe('42501');
  });

  it('HR admins cannot manage roles (owner-only) and nobody can edit the owner role', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.hrA, (tx) =>
        tx.query(`insert into roles (organization_id, key, name) values ($1, 'custom', 'Custom')`, [f.orgA]))),
    ).toBe('42501');
    expect(
      await pgError(ctx.t.asUser(f.users.ownerA, (tx) =>
        tx.query(
          `delete from role_permissions where role_id = (select id from roles where organization_id = $1 and key = 'owner')
           returning 1`, [f.orgA]).then((r) => { if (r.rows.length === 0) throw Object.assign(new Error('no rows'), { code: 'NOROWS' }); }))),
    ).toBe('NOROWS');
  });

  it('suspended members lose all access immediately', async () => {
    const { f, t } = ctx;
    await t.db.query(`update organization_members set status = 'suspended' where user_id = $1`, [f.users.hrA]);
    try {
      expect(await visibleEmployeeCodes(f.users.hrA)).toEqual([]);
    } finally {
      await t.db.query(`update organization_members set status = 'active' where user_id = $1`, [f.users.hrA]);
    }
  });

  it('expired time-boxed grants stop working', async () => {
    const { f, t } = ctx;
    await t.db.query(
      `update member_roles set valid_until = now() - interval '1 minute'
        where member_id = (select id from organization_members where user_id = $1)`, [f.users.auditorA]);
    try {
      expect(await visibleEmployeeCodes(f.users.auditorA)).toEqual([]);
    } finally {
      await t.db.query(`update member_roles set valid_until = null where member_id = (select id from organization_members where user_id = $1)`, [f.users.auditorA]);
    }
  });

  it('my_permissions returns only the caller’s grants', async () => {
    const rows = await ctx.t.asUser(ctx.f.users.icA, async (tx) =>
      (await tx.query<{ permission_key: string; scope: string }>('select * from my_permissions($1)', [ctx.f.orgA])).rows);
    expect(rows).toContainEqual({ permission_key: 'employee.read', scope: 'self' });
    expect(rows.find((r) => r.permission_key === 'employee.create')).toBeUndefined();
    const other = await ctx.t.asUser(ctx.f.users.icA, async (tx) =>
      (await tx.query('select * from my_permissions($1)', [ctx.f.orgB])).rows);
    expect(other).toEqual([]);
  });
});
