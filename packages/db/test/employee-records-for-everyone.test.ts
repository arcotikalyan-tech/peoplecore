import type { Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

/** The platform admin in these tests (an account with no organization). */
const admin = () => ctx.f.users.outsider;

beforeAll(async () => {
  await ctx.t.db.query('insert into platform_admins (user_id) values ($1)', [ctx.f.users.outsider]);
});

/** Switches the signed-in person inside a transaction (as PostgREST does per request). */
async function become(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

const roleId = async (tx: Transaction, org: string, key: string) =>
  (await tx.query<{ id: string }>('select id from roles where organization_id = $1 and key = $2', [org, key])).rows[0]!.id;

interface Rec { first_name: string; last_name: string | null; work_email: string; employment_type: string; status: string; joined_today: boolean; code_ok: boolean; history: number }

/** The person's record in the organization, read as the database owner. */
async function recordOf(tx: Transaction, org: string, user: string): Promise<Rec | undefined> {
  await tx.exec('reset role');
  const { rows } = await tx.query<Rec>(
    `select e.first_name, e.last_name, e.work_email, e.employment_type, e.status, e.date_of_joining = app.org_today(e.organization_id) as joined_today,
            e.employee_code ~ '^EMP[0-9]{5}$' as code_ok,
            (select count(*)::int from employment_records r where r.employee_id = e.id and r.change_reason = 'joining') as history
       from employees e where e.organization_id = $1 and e.user_id = $2`, [org, user]);
  await tx.exec('set local role authenticated');
  return rows[0];
}

describe('people added to an organization get an employee record', () => {
  it('an invited person gets one linked to their sign-in, named from their email, joining today', async () => {
    const { f, t } = ctx;
    const person = await t.createUser('asha.rao42@example.test');
    await t.asUser(f.users.hrA, async (tx) => {
      // Named, without the new argument, as the website called it before (PostgREST passes names).
      await tx.query('select add_member(p_org => $1, p_user_id => $2, p_role_ids => $3, p_employee_id => null)', [f.orgA, person, [await roleId(tx, f.orgA, 'employee')]]);
      expect(await recordOf(tx, f.orgA, person)).toEqual({
        first_name: 'Asha', last_name: 'Rao', work_email: 'asha.rao42@example.test', employment_type: 'permanent', status: 'active',
        joined_today: true, code_ok: true, history: 1,
      });
    });
  });

  it('an invitation can leave it out (an accountant, an auditor): no record, and the member is marked', async () => {
    const { f, t } = ctx;
    const person = await t.createUser('books@example.test');
    await t.asUser(f.users.hrA, async (tx) => {
      const member = (await tx.query<{ id: string }>('select add_member($1, $2, $3, null, true) as id', [f.orgA, person, [await roleId(tx, f.orgA, 'employee')]])).rows[0]!.id;
      expect(await recordOf(tx, f.orgA, person)).toBeUndefined();
      expect((await tx.query('select without_employee_record from organization_members where id = $1', [member])).rows[0]).toEqual({ without_employee_record: true });
    });
    // A record and "none" at once makes no sense.
    expect(await pgError(t.asUser(f.users.hrA, async (tx) =>
      tx.query('select add_member($1, $2, $3, $4, true)', [f.orgA, person, [await roleId(tx, f.orgA, 'employee')], f.employees.icA])))).toBe('22023');
  });

  it('a record HR added earlier with their work email is linked instead of a second one', async () => {
    const { f, t } = ctx;
    const person = await t.createUser('neel@example.test');
    await t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`select create_employee($1, 'Neel', 'permanent', '2026-01-05', p_last_name => 'Fernandes', p_work_email => 'Neel@example.test') as id`, [f.orgA])).rows[0]!.id;
      await tx.query('select add_member($1, $2, $3)', [f.orgA, person, [await roleId(tx, f.orgA, 'employee')]]);
      const linked = (await tx.query<{ id: string; first_name: string }>('select id, first_name from employees where organization_id = $1 and user_id = $2', [f.orgA, person])).rows;
      expect(linked).toEqual([{ id, first_name: 'Neel' }]);
    });
  });

  it('with the organization’s rule switched off, nobody gets one automatically', async () => {
    const { f, t } = ctx;
    const person = await t.createUser('temp@example.test');
    await t.asUser(f.users.ownerA, async (tx) => {
      await tx.query('update org_controls set auto_employee_record = false where organization_id = $1', [f.orgA]);
      await tx.query('select add_member($1, $2, $3)', [f.orgA, person, [await roleId(tx, f.orgA, 'employee')]]);
      expect(await recordOf(tx, f.orgA, person)).toBeUndefined();
    });
  });

  it('adding someone still works when the record can’t be made (the plan’s employee limit)', async () => {
    const { f, t } = ctx;
    const person = await t.createUser('one.more@example.test');
    await t.asUser(admin(), async (tx) => {
      // Demo Org B has one employee: a limit of one leaves no room.
      await tx.query(`select platform_set_subscription($1, 'starter', 'active', 'monthly', 1, null, null, null, null, null)`, [f.orgB]);
      await become(tx, f.users.ownerB);
      await tx.query('select add_member($1, $2, $3)', [f.orgB, person, [await roleId(tx, f.orgB, 'employee')]]);
      expect((await tx.query('select status from organization_members where organization_id = $1 and user_id = $2', [f.orgB, person])).rows).toEqual([{ status: 'invited' }]);
      expect(await recordOf(tx, f.orgB, person)).toBeUndefined();
    });
  });

  it('a new organization’s owner gets one, named from their sign-up request', async () => {
    const { t } = ctx;
    const owner = await t.createUser('founder.x@acme.example.test');
    await t.db.query(`insert into access_requests (company, contact_name, work_email) values ('Acme', 'Kalpana Iyer Shah', 'Founder.X@acme.example.test')`);
    await t.asUser(admin(), async (tx) => {
      const org = (await tx.query<{ id: string }>(`select platform_create_organization('Acme', 'acme-x', $1, 'starter') as id`, [owner])).rows[0]!.id;
      expect(await recordOf(tx, org, owner)).toMatchObject({ first_name: 'Kalpana', last_name: 'Iyer Shah', work_email: 'founder.x@acme.example.test', history: 1 });
    });
  });

  it('an owner added in the platform console gets one (a platform admin isn’t a member, so the function links it)', async () => {
    const { f, t } = ctx;
    await t.asUser(admin(), async (tx) => {
      await tx.query('select platform_add_owner($1, $2)', [f.orgB, f.users.hrA]);
      expect(await recordOf(tx, f.orgB, f.users.hrA)).toMatchObject({ first_name: 'Hra', work_email: 'hra@example.test', history: 1 });
    });
  });
});

describe('people added earlier', () => {
  it('“Add their employee records” gives everyone without one a record, except those marked as not employees', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.ownerA, async (tx) => {
      const auditor = (await tx.query<{ id: string }>('select id from organization_members where organization_id = $1 and user_id = $2', [f.orgA, f.users.auditorA])).rows[0]!.id;
      await tx.query('select set_member_without_record($1, true)', [auditor]);
      // Owner, HR, payroll and the recruiter had no record; the auditor is left out.
      expect((await tx.query('select add_missing_employee_records($1) as n', [f.orgA])).rows[0]).toEqual({ n: 4 });
      for (const u of [f.users.ownerA, f.users.hrA, f.users.payrollA, f.users.recruiterA]) expect(await recordOf(tx, f.orgA, u)).toMatchObject({ history: 1 });
      expect(await recordOf(tx, f.orgA, f.users.auditorA)).toBeUndefined();
      // Running it again adds nobody.
      expect((await tx.query('select add_missing_employee_records($1) as n', [f.orgA])).rows[0]).toEqual({ n: 0 });
    });
  });

  it('it works even with the automatic rule off, and only for people who manage members and add employees', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.ownerA, async (tx) => {
      await tx.query('update org_controls set auto_employee_record = false where organization_id = $1', [f.orgA]);
      expect((await tx.query<{ n: number }>('select add_missing_employee_records($1) as n', [f.orgA])).rows[0]!.n).toBeGreaterThan(0);
    });
    for (const user of [f.users.icA, f.users.payrollA, f.users.ownerB]) {
      expect(await pgError(t.asUser(user, (tx) => tx.query('select add_missing_employee_records($1)', [f.orgA])))).toBe('42501');
    }
    expect(await pgError(t.asUser(f.users.icA, async (tx) =>
      tx.query('select set_member_without_record((select id from organization_members where organization_id = $1 and user_id = $2), true)', [f.orgA, f.users.auditorA])))).toBe('42501');
  });
});
