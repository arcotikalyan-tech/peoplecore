import { describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('suspended organizations', () => {
  it('members of a suspended organization lose all access but can see it is suspended', async () => {
    const { f, t } = ctx;
    await t.db.query(`update organizations set status = 'suspended' where id = $1`, [f.orgA]);
    try {
      await t.asUser(f.users.hrA, async (tx) => {
        expect((await tx.query('select 1 from employees')).rows).toHaveLength(0);
        expect((await tx.query('select 1 from departments')).rows).toHaveLength(0);
        expect((await tx.query('select 1 from organizations')).rows).toHaveLength(0);
        expect((await tx.query('select * from my_permissions($1)', [f.orgA])).rows).toHaveLength(0);
        const mine = await tx.query<{ slug: string; status: string }>('select slug, status from my_organizations()');
        expect(mine.rows).toEqual([{ slug: 'demo-a', status: 'suspended' }]);
      });
      // Other tenants are unaffected.
      await t.asUser(f.users.employeeB, async (tx) => {
        expect((await tx.query('select 1 from employees')).rows).toHaveLength(1);
      });
    } finally {
      await t.db.query(`update organizations set status = 'active' where id = $1`, [f.orgA]);
    }
  });

  it('only platform administrators can change status, through the RPC', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select set_organization_status($1, 'suspended')`, [f.orgA]))),
    ).toBe('42501');

    await t.db.query('insert into platform_admins (user_id) values ($1)', [f.users.outsider]);
    try {
      await t.asUser(f.users.outsider, async (tx) => {
        await tx.query(`select set_organization_status($1, 'suspended')`, [f.orgA]);
        const { rows } = await tx.query<{ status: string }>('select status from organizations where id = $1', [f.orgA]);
        expect(rows[0]!.status).toBe('suspended');
        // Platform admins cannot read tenant audit logs; check attribution with full access instead.
        await tx.exec('reset role');
        const audit = await tx.query<{ actor_user_id: string }>(
          `select actor_user_id from audit_events where entity_type = 'organizations' and entity_id = $1 order by id desc limit 1`,
          [f.orgA],
        );
        expect(audit.rows[0]!.actor_user_id).toBe(f.users.outsider);
      });
    } finally {
      await t.db.query('delete from platform_admins where user_id = $1', [f.users.outsider]);
    }
  });

  it('organization admins can rename their organization but not change status, URL or demo flag', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.ownerA, async (tx) => {
      const renamed = await tx.query(`update organizations set name = 'Renamed Org' where id = $1`, [f.orgA]);
      expect(renamed.affectedRows).toBe(1);
    });
    for (const change of [`status = 'suspended'`, `slug = 'stolen-slug'`, 'is_demo = false']) {
      expect(
        await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`update organizations set ${change} where id = $1`, [f.orgA]))),
        change,
      ).toBe('42501');
    }
  });
});

describe('last-owner protection', () => {
  const removeOwnRole = `delete from member_roles
     where member_id = (select id from organization_members where user_id = $2 and organization_id = $1)
       and role_id = (select id from roles where organization_id = $1 and key = 'owner')`;

  it('the only owner cannot remove their own owner role', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.ownerA, async (tx) => {
        await tx.query(removeOwnRole, [f.orgA, f.users.ownerA]);
        await tx.exec('set constraints all immediate'); // the check a commit would run
      })),
    ).toBe('22023');
  });

  it('ownership can be handed over: add a new owner, then step down', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.ownerA, async (tx) => {
      await tx.query(
        `insert into member_roles (organization_id, member_id, role_id)
         select $1, m.id, r.id from organization_members m, roles r
          where m.user_id = $2 and m.organization_id = $1 and r.organization_id = $1 and r.key = 'owner'`,
        [f.orgA, f.users.hrA],
      );
      await tx.query(removeOwnRole, [f.orgA, f.users.ownerA]);
      await tx.exec('set constraints all immediate');
    });
  });

  it('the only owner cannot be suspended', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.ownerA, async (tx) => {
        await tx.query(`update organization_members set status = 'suspended' where user_id = $1 and organization_id = $2`, [f.users.ownerA, f.orgA]);
        await tx.exec('set constraints all immediate');
      })),
    ).toBe('22023');
  });

  it('a time-boxed owner grant does not count as the permanent owner', async () => {
    const { f, t } = ctx;
    expect(
      await pgError(t.asUser(f.users.ownerA, async (tx) => {
        await tx.query(
          `insert into member_roles (organization_id, member_id, role_id, valid_until)
           select $1, m.id, r.id, now() + interval '1 day' from organization_members m, roles r
            where m.user_id = $2 and m.organization_id = $1 and r.organization_id = $1 and r.key = 'owner'`,
          [f.orgA, f.users.hrA],
        );
        await tx.query(removeOwnRole, [f.orgA, f.users.ownerA]);
        await tx.exec('set constraints all immediate');
      })),
    ).toBe('22023');
  });

  it('deleting a whole organization is not blocked', async () => {
    const { t } = ctx;
    const owner = await t.createUser('throwaway.owner@example.test');
    const { rows } = await t.db.query<{ id: string }>(`insert into organizations (name, slug) values ('Throwaway', 'throwaway-org') returning id`);
    const org = rows[0]!.id;
    const member = await t.db.query<{ id: string }>(
      `insert into organization_members (organization_id, user_id, status) values ($1, $2, 'active') returning id`, [org, owner]);
    await t.db.query(
      `insert into member_roles (organization_id, member_id, role_id) select $1, $2, id from roles where organization_id = $1 and key = 'owner'`,
      [org, member.rows[0]!.id],
    );
    await t.db.query('delete from organizations where id = $1', [org]);
    expect((await t.db.query('select 1 from organizations where id = $1', [org])).rows).toHaveLength(0);
  });
});
