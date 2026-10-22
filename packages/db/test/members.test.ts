import type { Transaction } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

const roleId = async (tx: Transaction, org: string, key: string) =>
  (await tx.query<{ id: string }>('select id from roles where organization_id = $1 and key = $2', [org, key])).rows[0]!.id;
const memberId = async (tx: Transaction, org: string, userId: string) =>
  (await tx.query<{ id: string }>('select id from organization_members where organization_id = $1 and user_id = $2', [org, userId])).rows[0]!.id;
const grantableKeys = async (tx: Transaction, org: string) =>
  (await tx.query<{ key: string }>('select key from grantable_roles($1) order by key', [org])).rows.map((r) => r.key);

describe('who can grant which roles', () => {
  it('HR can grant everyday roles only; owners can grant any role; employees none', async () => {
    const { f, t } = ctx;
    expect(await t.asUser(f.users.hrA, (tx) => grantableKeys(tx, f.orgA))).toEqual(['department_head', 'employee', 'manager', 'recruiter']);
    expect(await t.asUser(f.users.ownerA, (tx) => grantableKeys(tx, f.orgA))).toHaveLength(13);
    expect(await t.asUser(f.users.icA, (tx) => grantableKeys(tx, f.orgA))).toEqual([]);
    expect(await t.asUser(f.users.hrA, (tx) => grantableKeys(tx, f.orgB))).toEqual([]); // other tenant
  });
});

describe('adding members', () => {
  it('HR invites someone; they get access only after accepting', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      const roles = [await roleId(tx, f.orgA, 'employee'), await roleId(tx, f.orgA, 'manager')];
      await tx.query('select add_member($1, $2, $3)', [f.orgA, f.users.outsider, roles]);
      const { rows } = await tx.query<{ status: string }>('select status from organization_members where user_id = $1', [f.users.outsider]);
      expect(rows[0]!.status).toBe('invited');

      // Become the invitee inside the same transaction: no access while invited, full role access after accepting.
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [f.users.outsider]);
      expect((await tx.query('select * from my_permissions($1)', [f.orgA])).rows).toHaveLength(0);
      expect((await tx.query<{ accepted: number }>('select accept_invitations() as accepted')).rows[0]!.accepted).toBe(1);
      const grants = await tx.query<{ permission_key: string; scope: string }>('select * from my_permissions($1)', [f.orgA]);
      expect(grants.rows).toContainEqual({ permission_key: 'employee.read', scope: 'team' });
    });
  });

  it('HR cannot invite someone as HR admin, payroll admin, auditor or owner', async () => {
    const { f, t } = ctx;
    for (const key of ['hr_admin', 'payroll_admin', 'auditor', 'owner']) {
      expect(
        await pgError(t.asUser(f.users.hrA, async (tx) =>
          tx.query('select add_member($1, $2, $3)', [f.orgA, f.users.outsider, [await roleId(tx, f.orgA, key)]]))),
        key,
      ).toBe('42501');
    }
  });

  it('the owner can invite an HR admin', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.ownerA, async (tx) => {
      await tx.query('select add_member($1, $2, $3)', [f.orgA, f.users.outsider, [await roleId(tx, f.orgA, 'hr_admin')]]);
    });
  });

  it('can link the new member to an unlinked employee record, but never steal a linked one', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      const emp = (await tx.query<{ id: string }>(`select create_employee($1, 'Linkme', 'permanent', '2026-01-01') as id`, [f.orgA])).rows[0]!.id;
      await tx.query('select add_member($1, $2, $3, $4)', [f.orgA, f.users.outsider, [await roleId(tx, f.orgA, 'employee')], emp]);
      const { rows } = await tx.query<{ user_id: string }>('select user_id from employees where id = $1', [emp]);
      expect(rows[0]!.user_id).toBe(f.users.outsider);
    });
    expect(
      await pgError(t.asUser(f.users.hrA, async (tx) =>
        tx.query('select add_member($1, $2, $3, $4)', [f.orgA, f.users.outsider, [await roleId(tx, f.orgA, 'employee')], f.employees.icA]))),
    ).toBe('22023');
  });

  it('rejects an empty role list and duplicate memberships', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query('select add_member($1, $2, $3)', [f.orgA, f.users.outsider, []])))).toBe('22023');
    expect(
      await pgError(t.asUser(f.users.hrA, async (tx) =>
        tx.query('select add_member($1, $2, $3)', [f.orgA, f.users.icA, [await roleId(tx, f.orgA, 'employee')]]))),
    ).toBe('23505');
  });
});

describe('changing roles and status', () => {
  it('HR promotes an employee to manager; the new access applies immediately', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      const member = await memberId(tx, f.orgA, f.users.leadA);
      await tx.query('select set_member_roles($1, $2)', [member, [await roleId(tx, f.orgA, 'employee'), await roleId(tx, f.orgA, 'manager')]]);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [f.users.leadA]);
      const visible = await tx.query('select 1 from employees');
      expect(visible.rows).toHaveLength(2); // themselves + their report (icA)
    });
  });

  it('HR cannot change the roles of an owner or payroll admin, in either direction', async () => {
    const { f, t } = ctx;
    for (const target of [f.users.ownerA, f.users.payrollA]) {
      expect(
        await pgError(t.asUser(f.users.hrA, async (tx) =>
          tx.query('select set_member_roles($1, $2)', [await memberId(tx, f.orgA, target), [await roleId(tx, f.orgA, 'employee')]]))),
      ).toBe('42501');
    }
  });

  it('HR cannot escalate anyone (including themselves) to HR admin via role edits', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.hrA, async (tx) =>
        tx.query('select set_member_roles($1, $2)', [await memberId(tx, f.orgA, f.users.icA), [await roleId(tx, f.orgA, 'hr_admin')]]))),
    ).toBe('42501');
  });

  it('HR can suspend an ordinary member but not an owner or payroll admin', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.hrA, async (tx) => {
      const suspend = (u: string) =>
        tx.query(`update organization_members set status = 'suspended' where organization_id = $1 and user_id = $2`, [f.orgA, u]);
      expect((await suspend(f.users.peerA)).affectedRows).toBe(1);
      expect((await suspend(f.users.ownerA)).affectedRows).toBe(0);
      expect((await suspend(f.users.payrollA)).affectedRows).toBe(0);
    });
  });

  it('only the status of a membership can be edited', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.hrA, (tx) =>
        tx.query('update organization_members set user_id = $1 where organization_id = $2 and user_id = $3', [f.users.hrA, f.orgA, f.users.peerA]))),
    ).toBe('42501');
  });

  it('a member needs at least one role', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.hrA, async (tx) => tx.query('select set_member_roles($1, $2)', [await memberId(tx, f.orgA, f.users.peerA), []]))),
    ).toBe('22023');
  });
});

describe('member list', () => {
  it('HR sees members with emails and roles; others are refused', async () => {
    const { f, t } = ctx;
    const rows = await t.asUser(f.users.hrA, async (tx) =>
      (await tx.query<{ email: string; status: string; role_ids: string[]; employee_name: string | null }>('select * from org_members($1)', [f.orgA])).rows);
    expect(rows.map((r) => r.email)).toContain('ownera@example.test');
    expect(rows.find((r) => r.email === 'managera@example.test')).toMatchObject({ status: 'active', employee_name: 'Mira Demo' });
    expect(rows.find((r) => r.email === 'managera@example.test')!.role_ids).toHaveLength(2);
    expect(await pgError(t.asUser(f.users.icA, (tx) => tx.query('select * from org_members($1)', [f.orgA])))).toBe('42501');
    expect(await pgError(t.asUser(f.users.hrA, (tx) => tx.query('select * from org_members($1)', [f.orgB])))).toBe('42501');
  });
});
