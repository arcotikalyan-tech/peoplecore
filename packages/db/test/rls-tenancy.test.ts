import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('tenant isolation', () => {
  it('every table in public has RLS enabled', async () => {
    const { rows } = await ctx.t.db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('a signed-in user with no membership sees no tenant data', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.outsider, async (tx) => {
      for (const table of ['organizations', 'employees', 'departments', 'roles', 'audit_events', 'employment_records']) {
        const { rows } = await tx.query(`select 1 from ${table}`);
        expect(rows, table).toHaveLength(0);
      }
    });
  });

  it('anonymous requests are denied outright', async () => {
    expect(await pgError(ctx.t.asAnon((tx) => tx.query('select * from employees')))).toBe('42501');
    expect(await pgError(ctx.t.asAnon((tx) => tx.query('select * from organizations')))).toBe('42501');
  });

  it('an owner sees only their own organization and its employees', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      const orgs = await tx.query<{ id: string }>('select id from organizations');
      expect(orgs.rows.map((r) => r.id)).toEqual([f.orgA]);
      const leaked = await tx.query('select 1 from employees where organization_id = $1 or id = $2', [f.orgB, f.employees.employeeB]);
      expect(leaked.rows).toHaveLength(0);
    });
  });

  it('cannot create employees in another tenant, via RPC or direct insert', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.ownerA, (tx) =>
        tx.query(`select create_employee($1, 'Mallory', 'permanent', '2026-01-01')`, [f.orgB]))),
    ).toBe('42501');
    expect(
      await pgError(ctx.t.asUser(f.users.ownerA, (tx) =>
        tx.query(`insert into employees (organization_id, employee_code, first_name, employment_type, date_of_joining)
                  values ($1, 'X-1', 'Mallory', 'permanent', '2026-01-01')`, [f.orgB]))),
    ).toBe('42501');
  });

  it('cannot update or re-home another tenant’s rows', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      const r = await tx.query(`update employees set first_name = 'pwned' where id = $1`, [f.employees.employeeB]);
      expect(r.affectedRows).toBe(0);
    });
    // Moving an own row into tenant B fails the WITH CHECK clause.
    expect(
      await pgError(ctx.t.asUser(f.users.ownerA, (tx) =>
        tx.query(`update departments set organization_id = $1 where id = $2`, [f.orgB, f.deptA]))),
    ).toBe('42501');
  });

  it('composite foreign keys block linking to another tenant’s department', async () => {
    const { f } = ctx;
    expect(
      await pgError(ctx.t.asUser(f.users.hrA, (tx) =>
        tx.query(`select create_employee($1, 'Cross', 'permanent', '2026-01-01', p_department_id => $2)`, [f.orgA, f.deptB]))),
    ).toBe('23503');
  });

  it('only platform admins can create organizations', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select create_organization('Rogue', 'rogue-org')`))),
    ).toBe('42501');

    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      await t.asUser(f.users.outsider, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(`select create_organization('New Co', 'new-co', $1) as id`, [f.users.ownerB]);
        const newOrg = rows[0]!.id;
        // Platform admins are not tenant members: they can see the org but not its internals.
        expect((await tx.query('select 1 from organizations where id = $1', [newOrg])).rows).toHaveLength(1);
        expect((await tx.query('select 1 from roles where organization_id = $1', [newOrg])).rows).toHaveLength(0);
        // The nominated owner holds the owner role.
        await tx.exec('reset role');
        const owner = await tx.query(
          `select 1 from member_roles mr join organization_members m on m.id = mr.member_id
             join roles r on r.id = mr.role_id
            where m.organization_id = $1 and m.user_id = $2 and r.key = 'owner'`, [newOrg, f.users.ownerB]);
        expect(owner.rows).toHaveLength(1);
      });
    } finally {
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
    }
  });
});
