import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';
import type { Fixture } from './fixtures.ts';

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

/** HR gets an employee record (so they can be named); Pia sits on an internal committee with grievance.read. */
async function setup(tx: Transaction, f: Fixture) {
  await tx.exec('reset role');
  const hrEmp = (await tx.query<{ id: string }>(
    `insert into employees (organization_id, employee_code, first_name, last_name, work_email, user_id, status, employment_type, date_of_joining)
     values ($1, 'A-900', 'Hari', 'Demo', 'hari@example.test', $2, 'active', 'permanent', '2024-01-01') returning id`, [f.orgA, f.users.hrA])).rows[0]!.id;
  const role = (await tx.query<{ id: string }>(
    `insert into roles (organization_id, key, name) values ($1, 'ic_member', 'Internal committee') returning id`, [f.orgA])).rows[0]!.id;
  await tx.query(`insert into role_permissions (organization_id, role_id, permission_key, scope) values ($1, $2, 'grievance.read', 'org')`, [f.orgA, role]);
  await tx.query(`insert into member_roles (organization_id, member_id, role_id)
                  select $1, id, $2 from organization_members where organization_id = $1 and user_id = $3`, [f.orgA, role, f.users.peerA]);
  return hrEmp;
}

const visible = async (tx: Transaction) => (await tx.query('select id from grievances')).rows.length;
const notified = async (tx: Transaction, kind: string) => (await tx.query('select 1 from notifications where kind = $1', [kind])).rows.length;

describe('grievances', () => {
  it('are seen only by the reporter, case managers not named in them, and chosen investigators', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const hrEmp = await setup(tx, f);

      await as(tx, f.users.icA);
      expect((await failure(tx, `select raise_grievance($1, 'bullying', 'Criticism', 'Too short')`, [f.orgA])).message).toBe('Describe what happened in a few sentences.');
      expect((await failure(tx, `select raise_grievance($1, 'bullying', 'Criticism', 'This keeps happening every single week.', null, $2)`,
        [f.orgA, [f.employees.icA]])).message).toBe('You can’t name yourself.');
      expect((await failure(tx, `select raise_grievance($1, 'bullying', 'Criticism', 'This keeps happening every single week.', null, $2)`,
        [f.orgA, [f.employees.employeeB]])).message).toBe('Choose people from your organization.');
      const id = (await tx.query<{ id: string }>(
        `select raise_grievance($1, 'bullying', 'Repeated public criticism', 'My lead criticises me in front of the team every week.', current_date - 3, $2) as id`,
        [f.orgA, [f.employees.leadA, hrEmp]])).rows[0]!.id;
      expect(await visible(tx)).toBe(1);
      expect((await failure(tx, 'select description from grievances')).code).toBe('42501'); // only through grievance_case
      expect((await failure(tx, 'select * from grievance_notes')).code).toBe('42501');
      expect((await tx.query<{ my_role: string; description: string }>('select my_role, description from grievance_case($1)', [id])).rows)
        .toEqual([{ my_role: 'reporter', description: 'My lead criticises me in front of the team every week.' }]);

      for (const user of [f.users.hrA, f.users.leadA, f.users.managerA, f.users.peerA, f.users.auditorA]) { // named, or no access
        await as(tx, user);
        expect(await visible(tx), user).toBe(0);
        expect((await tx.query('select * from grievance_case($1)', [id])).rows, user).toHaveLength(0);
        expect((await tx.query('select * from grievance_thread($1)', [id])).rows, user).toHaveLength(0);
      }
      await as(tx, f.users.hrA);
      expect(await notified(tx, 'grievance.new')).toBe(0); // named: not told

      await as(tx, f.users.ownerA);
      expect(await notified(tx, 'grievance.new')).toBe(1);
      expect((await tx.query<{ my_role: string }>('select my_role from grievance_case($1)', [id])).rows[0]!.my_role).toBe('manager');
      expect((await failure(tx, 'select set_grievance_access($1, $2, true)', [id, f.users.hrA])).message).toBe('Someone named in the case can’t investigate it.');
      expect((await failure(tx, 'select set_grievance_access($1, $2, true)', [id, f.users.icA])).message).toBe('The person who raised it can’t investigate it.');
      expect((await failure(tx, 'select set_grievance_access($1, $2, true)', [id, f.users.managerA])).message).toBe('Choose someone with access to grievances.');
      expect((await tx.query<{ name: string }>('select name from grievance_investigator_options($1)', [f.orgA])).rows.map((r) => r.name))
        .toContain('Pia Demo');
      await tx.query('select set_grievance_access($1, $2, true)', [id, f.users.peerA]);

      await as(tx, f.users.peerA); // investigator
      expect(await notified(tx, 'grievance.assigned')).toBe(1);
      expect((await tx.query<{ my_role: string }>('select my_role from grievance_case($1)', [id])).rows[0]!.my_role).toBe('investigator');
      await tx.query(`select add_grievance_note($1, 'Spoke to two witnesses; both confirm.', true)`, [id]);
      await tx.query(`select add_grievance_note($1, 'We have started looking into this and will update you within a week.')`, [id]);
      await tx.query(`select update_grievance($1, 'investigating')`, [id]);
      expect((await failure(tx, 'select set_grievance_access($1, $2, true)', [id, f.users.ownerA])).code).toBe('42501');
      expect((await tx.query<{ kind: string; name: string }>('select kind, name from grievance_people($1)', [id])).rows).toEqual([
        { kind: 'investigator', name: 'Pia Demo' }, { kind: 'named', name: 'Hari Demo' }, { kind: 'named', name: 'Lalit Demo' },
      ]);

      await as(tx, f.users.icA);
      expect((await tx.query<{ body: string }>('select body from grievance_thread($1)', [id])).rows.map((r) => r.body))
        .toEqual(['We have started looking into this and will update you within a week.']);
      expect((await tx.query<{ kind: string }>('select kind from grievance_people($1)', [id])).rows.map((r) => r.kind)).toEqual(['named', 'named']);
      expect(await notified(tx, 'grievance.message') + await notified(tx, 'grievance.update')).toBe(2);
      expect((await failure(tx, `select add_grievance_note($1, 'secret', true)`, [id])).code).toBe('42501');
      await tx.query(`select add_grievance_note($1, 'Thank you. It happened again yesterday.')`, [id]);
      expect((await failure(tx, `select update_grievance($1, 'resolved', 'Done')`, [id])).code).toBe('42501');

      await as(tx, f.users.ownerA);
      expect(await notified(tx, 'grievance.message')).toBe(1);
      expect((await failure(tx, `select update_grievance($1, 'resolved')`, [id])).message).toBe('Write the outcome to share with the person who raised it.');
      await tx.query(`select update_grievance($1, 'resolved', 'The lead has been coached and moved to another team.')`, [id]);
      await tx.query('select add_grievance_respondent($1, $2)', [id, f.employees.peerA]); // conflict found: Pia steps out
      await as(tx, f.users.peerA);
      expect(await visible(tx)).toBe(0);

      await as(tx, f.users.icA);
      expect((await failure(tx, 'select withdraw_grievance($1)', [id])).message).toBe('This case can no longer be withdrawn.');
      expect((await tx.query<{ outcome: string; status: string }>('select outcome, status from grievance_case($1)', [id])).rows[0])
        .toEqual({ outcome: 'The lead has been coached and moved to another team.', status: 'resolved' });

      await as(tx, f.users.ownerA);
      await tx.query(`select update_grievance($1, 'closed')`, [id]);
      expect((await failure(tx, `select add_grievance_note($1, 'One more thing')`, [id])).message).toBe('This case is closed.');

      await as(tx, f.users.auditorA); // the trail without the substance
      const trail = (await tx.query<{ action: string; actor_user_id: string; changes: Record<string, unknown> | null }>(
        `select action, actor_user_id, changes from audit_events where entity_type = 'grievances' and entity_id = $1 order by id`, [id])).rows;
      expect(trail[0]!.changes).toMatchObject({ reporter_id: '[redacted]', subject: '[redacted]', description: '[redacted]' });
      const views = trail.filter((t) => t.action === 'view').map((t) => t.actor_user_id);
      expect(new Set(views)).toEqual(new Set([f.users.ownerA, f.users.peerA])); // handlers' reads recorded; the reporter's not

      await as(tx, f.users.employeeB);
      expect(await visible(tx)).toBe(0);
      expect((await failure(tx, `select raise_grievance($1, 'other', 'Hello', 'Trying to file in another organization.')`, [f.orgA])).code).toBe('42501');
    });
  });

  it('can be withdrawn by the reporter before they are resolved; handlers are told', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const id = (await tx.query<{ id: string }>(
        `select raise_grievance($1, 'pay', 'Overtime not paid', 'My overtime for August has not been paid yet.') as id`, [f.orgA])).rows[0]!.id;
      expect((await failure(tx, 'select update_grievance($1, $2)', [id, 'in_review'])).code).toBe('42501');
      await tx.query(`select withdraw_grievance($1, 'Payroll fixed it in September.')`, [id]);
      expect((await tx.query<{ status: string }>('select status from grievances where id = $1', [id])).rows[0]!.status).toBe('withdrawn');
      expect((await tx.query<{ body: string }>('select body from grievance_thread($1)', [id])).rows.map((r) => r.body))
        .toEqual(['Withdrawn: Payroll fixed it in September.']);
      expect((await failure(tx, `select add_grievance_note($1, 'Actually…')`, [id])).message).toBe('This case is closed.');
      await as(tx, f.users.hrA);
      expect(await notified(tx, 'grievance.update')).toBe(1);
      expect((await failure(tx, `select update_grievance($1, 'in_review')`, [id])).message).toBe('This case is closed.');
    });
  });
});
