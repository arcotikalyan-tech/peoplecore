import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

/** Runs a statement expected to fail inside a savepoint, so the surrounding transaction stays usable. */
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

const dept = async (tx: Transaction, org: string, code: string, parent: string | null = null) =>
  (await tx.query<{ id: string }>(
    'insert into departments (organization_id, code, name, parent_id) values ($1, $2, $3, $4) returning id',
    [org, code, `Dept ${code}`, parent])).rows[0]!.id;

describe('editing structure', () => {
  it('HR renames items; the change is audited', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`update departments set name = 'Platform Engineering', code = 'PLAT' where id = $1`, [f.deptA]);
      const { rows } = await tx.query<{ action: string }>(
        `select action from audit_events where entity_id = $1 and action = 'update'`, [f.deptA]);
      expect(rows).toHaveLength(1);
    });
  });

  it('employees and managers cannot edit or archive structure', async () => {
    const { f } = ctx;
    for (const user of [f.users.icA, f.users.managerA]) {
      await ctx.t.asUser(user, async (tx) => {
        const res = await tx.query(`update departments set archived_at = now() where id = $1`, [f.deptA]);
        expect(res.affectedRows).toBe(0);
      });
    }
  });
});

describe('archiving', () => {
  it('refuses while current employees use the item, and allows it once they have moved', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query('update employees set department_id = $1 where id = $2', [f.deptA, f.employees.icA]);
      expect((await failure(tx, 'update departments set archived_at = now() where id = $1', [f.deptA])).message)
        .toBe('This department is still used by 1 current employee. Move them first, then archive it.');

      await tx.query('update employees set department_id = null where id = $1', [f.employees.icA]);
      await tx.query('update departments set archived_at = now() where id = $1', [f.deptA]);
    });
  });

  it('ignores exited employees', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const desig = (await tx.query<{ id: string }>(
        `insert into designations (organization_id, title) values ($1, 'Analyst') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`update employees set designation_id = $1, status = 'exited', date_of_exit = '2026-01-31' where id = $2`,
        [desig, f.employees.peerA]);
      await tx.query('update designations set archived_at = now() where id = $1', [desig]);
    });
  });

  it('refuses a department with active sub-departments', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const parent = await dept(tx, f.orgA, 'OPS');
      await dept(tx, f.orgA, 'OPS-IN', parent);
      expect((await failure(tx, 'update departments set archived_at = now() where id = $1', [parent])).message)
        .toBe('This department has active sub-departments. Move or archive them first.');
    });
  });

  it('archived items can be restored', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = await dept(tx, f.orgA, 'TMP');
      await tx.query('update departments set archived_at = now() where id = $1', [id]);
      await tx.query('update departments set archived_at = null where id = $1', [id]);
    });
  });
});

describe('department tree', () => {
  it('refuses an archived parent, on create, re-parent and restore', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const old = await dept(tx, f.orgA, 'OLD');
      const child = await dept(tx, f.orgA, 'CHILD', old);
      await tx.query('update departments set archived_at = now() where id = $1', [child]);
      await tx.query('update departments set archived_at = now() where id = $1', [old]);

      const expected = 'The parent department is archived. Choose another parent or restore it first.';
      expect((await failure(tx, `insert into departments (organization_id, code, name, parent_id) values ($1, 'NEW', 'New', $2)`, [f.orgA, old])).message).toBe(expected);
      expect((await failure(tx, 'update departments set parent_id = $1 where id = $2', [old, f.deptA])).message).toBe(expected);
      expect((await failure(tx, 'update departments set archived_at = null where id = $1', [child])).message).toBe(expected);
    });
  });

  it('refuses cycles', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const a = await dept(tx, f.orgA, 'TA');
      const b = await dept(tx, f.orgA, 'TB', a);
      const c = await dept(tx, f.orgA, 'TC', b);
      expect((await failure(tx, 'update departments set parent_id = $1 where id = $2', [c, a])).message)
        .toBe('A department can’t sit under one of its own sub-departments.');
      expect((await failure(tx, 'update departments set parent_id = id where id = $1', [a])).code).toBe('22023');
    });
  });
});

describe('employees and archived items', () => {
  it('cannot be placed in an archived item, through the table or the RPCs', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = await dept(tx, f.orgA, 'GONE');
      await tx.query('update departments set archived_at = now() where id = $1', [id]);

      const expected = 'The selected department is archived.';
      expect((await failure(tx, 'update employees set department_id = $1 where id = $2', [id, f.employees.icA])).message).toBe(expected);
      expect((await failure(tx, `select create_employee($1, 'Nia', 'permanent', '2026-01-05', p_department_id => $2)`, [f.orgA, id])).message).toBe(expected);
      expect((await failure(tx, `select change_employee_assignment($1, current_date, 'transfer', $2, null, null, null)`, [f.employees.icA, id])).message).toBe(expected);
    });
  });

  it('existing placements are untouched by unrelated edits', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = await dept(tx, f.orgA, 'LEGACY');
      await tx.query(`update employees set department_id = $1, status = 'exited', date_of_exit = '2026-02-28' where id = $2`,
        [id, f.employees.leadA]);
      await tx.query('update departments set archived_at = now() where id = $1', [id]);
      // An exited employee in an archived department can still be edited.
      await tx.query(`update employees set work_phone = '+91 98450 00000' where id = $1`, [f.employees.leadA]);
    });
  });
});

describe('structure_usage', () => {
  it('counts current employees per item, limited to what the caller can see', async () => {
    const { f } = ctx;
    // asUser rolls back, so each viewer gets the setup (as HR) and the read (as themselves) in one transaction,
    // switching identity the way the harness sets it per request.
    const usage = async (user: string) =>
      ctx.t.asUser(f.users.hrA, async (tx) => {
        await tx.query('update employees set department_id = $1 where id = any($2)', [f.deptA, [f.employees.leadA, f.employees.icA]]);
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
        const { rows } = await tx.query<{ current_employees: number }>(
          `select current_employees::int from structure_usage($1) where kind = 'department' and item_id = $2`, [f.orgA, f.deptA]);
        return rows[0]?.current_employees ?? 0;
      });
    expect(await usage(f.users.hrA)).toBe(2);
    expect(await usage(f.users.leadA)).toBe(1); // sees only their own record and their report
    expect(await usage(f.users.peerA)).toBe(0);
  });
});
