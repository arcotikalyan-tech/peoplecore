import type { Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

/** The platform admin in these tests (an account with no organization). */
const admin = () => ctx.f.users.outsider;

const roleId = async (tx: Transaction, org: string, key: string) =>
  (await tx.query<{ id: string }>('select id from roles where organization_id = $1 and key = $2', [org, key])).rows[0]!.id;

/** Reads as the database owner inside the same transaction, then switches back to the caller. */
async function superRead<T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T[]> {
  await tx.exec('reset role');
  const { rows } = await tx.query<T>(sql, params);
  await tx.exec('set local role authenticated');
  return rows;
}

/** Switches the signed-in person inside a transaction (as PostgREST does per request). */
async function become(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

/** The error code of a statement expected to fail, keeping the transaction usable. */
async function fails(tx: Transaction, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return (err as { code?: string }).code ?? 'no-code';
  }
  throw new Error(`expected to fail: ${sql}`);
}

const setPlan = (tx: Transaction, org: string, plan: string, opts: { limit?: number | null; status?: string; trialEnds?: string | null; notes?: string | null } = {}) =>
  tx.query('select platform_set_subscription($1, $2, $3, $4, $5, null, $6, null, null, $7)',
    [org, plan, opts.status ?? 'active', 'monthly', opts.limit ?? null, opts.trialEnds ?? null, opts.notes ?? null]);

beforeAll(async () => {
  await ctx.t.db.query('insert into platform_admins (user_id) values ($1)', [ctx.f.users.outsider]);
});

describe('plans', () => {
  it('everyone signed in reads the catalogue; only platform admins add or change plans, never a plan’s code', async () => {
    const { f, t } = ctx;
    const codes = await t.asUser(f.users.icA, async (tx) => (await tx.query<{ code: string }>('select code from platform_plans order by sort_order')).rows.map((r) => r.code));
    expect(codes).toEqual(['free', 'starter', 'growth', 'enterprise']);
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`insert into platform_plans (code, name) values ('x1', 'X one')`)))).toBe('42501');
    await t.asUser(f.users.ownerA, async (tx) => {
      await tx.query(`update platform_plans set price_per_employee = 1 where code = 'growth'`);
      expect((await tx.query<{ p: string }>(`select price_per_employee as p from platform_plans where code = 'growth'`)).rows[0]!.p).toBe('99.00');
    });
    await t.asUser(admin(), async (tx) => {
      await tx.query(`insert into platform_plans (code, name, price_per_employee, max_employees, modules) values ('pro', 'Pro', 79, 200, array['leave', 'payroll'])`);
      await tx.query(`update platform_plans set price_per_employee = 89, is_active = false where code = 'pro'`);
      const row = (await tx.query<{ price_per_employee: string; is_active: boolean; updated_by: string }>(`select price_per_employee, is_active, updated_by from platform_plans where code = 'pro'`)).rows[0]!;
      expect(row).toEqual({ price_per_employee: '89.00', is_active: false, updated_by: admin() });
    });
    expect(await pgError(t.asUser(admin(), (tx) => tx.query(`update platform_plans set code = 'growth2' where code = 'growth'`)))).toBe('42501');
  });
});

describe('subscriptions', () => {
  it('only platform admins see and change them; owners see their own plan without the notes', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => setPlan(tx, f.orgA, 'starter')))).toBe('42501');
    await t.asUser(admin(), async (tx) => {
      await setPlan(tx, f.orgA, 'starter', { status: 'trialing', trialEnds: '2026-12-01', notes: 'Discount agreed on the call' });
      expect(await fails(tx, `select platform_set_subscription($1, 'starter', 'trialing', 'monthly', null, null, null, null, null, null)`, [f.orgA])).toBe('22023'); // a trial needs an end date
      const [audit] = await superRead<{ changes: Record<string, unknown> }>(tx,
        `select changes from audit_events where entity_type = 'organization_subscriptions' and organization_id = $1 order by id desc limit 1`, [f.orgA]);
      expect(audit!.changes.notes).toBe('[redacted]');
      expect(audit!.changes.plan_code).toBe('starter');
    });
    await t.asUser(admin(), async (tx) => {
      await setPlan(tx, f.orgA, 'starter', { notes: 'secret' });
      await become(tx, f.users.ownerA);
      const mine = (await tx.query<{ s: Record<string, unknown> }>('select my_subscription($1) as s', [f.orgA])).rows[0]!.s;
      expect(mine).toMatchObject({ plan: 'Starter', plan_code: 'starter', status: 'active', employee_limit: 50, employees: 4 });
      expect(mine).not.toHaveProperty('notes');
      expect((await tx.query('select * from organization_subscriptions')).rows).toEqual([]);
    });
    expect(await t.asUser(f.users.icA, async (tx) => (await tx.query<{ s: unknown }>('select my_subscription($1) as s', [f.orgA])).rows[0]!.s)).toBeNull();
  });

  it('the plan’s employee limit refuses new employees (people who left don’t count); its modules reach the page shell', async () => {
    const { f, t } = ctx;
    await t.asUser(admin(), async (tx) => {
      await setPlan(tx, f.orgB, 'free', { limit: 2 });
      await tx.exec('reset role');
      const insert = `insert into employees (organization_id, employee_code, first_name, last_name, employment_type, date_of_joining, status)
                      values ($1, $2, 'Test', 'Demo', 'permanent', '2026-01-01', $3)`;
      const add = (code: string, status = 'active') => tx.query(insert, [f.orgB, code, status]);
      await add('B-002');
      expect(await fails(tx, insert, [f.orgB, 'B-003', 'active'])).toBe('22023');
      await add('B-004', 'exited');
      await tx.query(`update employees set status = 'exited' where organization_id = $1 and employee_code = 'B-002'`, [f.orgB]);
      await add('B-005');
      expect(await fails(tx, `update employees set status = 'active' where organization_id = $1 and employee_code = 'B-004'`, [f.orgB])).toBe('22023');

      await become(tx, f.users.ownerB);
      const b = (await tx.query<{ b: { plan_modules: string[] | null } }>(`select my_org_context('demo-b') as b`)).rows[0]!.b;
      expect(b.plan_modules).toEqual(['attendance', 'leave', 'holidays', 'policies', 'knowledge', 'helpdesk']);
      const a = (await tx.query<{ b: { plan_modules: string[] | null } }>(`select my_org_context('demo-a') as b`)).rows[0]!.b;
      expect(a.plan_modules).toBeNull(); // not a member of org A
    });
  });
});

describe('organizations', () => {
  it('a platform admin creates one with a plan and an owner, who is emailed; nobody else can', async () => {
    const { f, t } = ctx;
    const owner = await t.createUser('founder@acme.example.test');
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select platform_create_organization('Acme', 'acme', null, 'starter')`)))).toBe('42501');
    await t.asUser(admin(), async (tx) => {
      await tx.query(`update platform_plans set is_active = false where code = 'growth'`);
      expect(await fails(tx, `select platform_create_organization('Acme', 'acme', null, 'growth')`)).toBe('22023');
    });
    await t.asUser(admin(), async (tx) => {
      const org = (await tx.query<{ id: string }>(`select platform_create_organization(' Acme India ', 'Acme-India', $1, 'starter', null, 'billing@acme.example.test') as id`, [owner])).rows[0]!.id;
      const [row] = await superRead<{ slug: string; name: string; plan_code: string; status: string; days: number; billing_email: string }>(tx,
        `select o.slug, o.name, s.plan_code, s.status, s.trial_ends_at - (now() at time zone 'Asia/Kolkata')::date as days, s.billing_email
           from organizations o join organization_subscriptions s on s.organization_id = o.id where o.id = $1`, [org]);
      expect(row).toEqual({ slug: 'acme-india', name: 'Acme India', plan_code: 'starter', status: 'trialing', days: 14, billing_email: 'billing@acme.example.test' });
      const emails = await superRead<{ to_email: string; event: string; subject: string; body: string }>(tx, 'select to_email, event, subject, body from email_outbox where organization_id = $1', [org]);
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({ to_email: 'founder@acme.example.test', event: 'workspace_ready', subject: 'Your PeopleCore workspace for Acme India is ready' });
      expect(emails[0]!.body).toContain('Plan: Starter, free trial until');
      expect(emails[0]!.body).toContain('choose your password'); // never signed in yet
      const overview = (await tx.query<{ slug: string; plan_name: string; owner_emails: string[]; members: number }>('select slug, plan_name, owner_emails, members from platform_org_overview() where id = $1', [org])).rows[0];
      expect(overview).toEqual({ slug: 'acme-india', plan_name: 'Starter', owner_emails: ['founder@acme.example.test'], members: 1 });
    });
  });

  it('a platform admin edits the name, URL, time zone and country', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select platform_update_organization($1, 'X', 'demo-x', 'Asia/Kolkata', 'IN')`, [f.orgA])))).toBe('42501');
    await t.asUser(admin(), async (tx) => {
      await tx.query(`select platform_update_organization($1, 'Demo Org A Ltd', 'Demo-A-Ltd', 'Asia/Dubai', 'AE')`, [f.orgA]);
      expect((await tx.query('select name, slug, timezone, country_code from organizations where id = $1', [f.orgA])).rows[0])
        .toEqual({ name: 'Demo Org A Ltd', slug: 'demo-a-ltd', timezone: 'Asia/Dubai', country_code: 'AE' });
      expect(await fails(tx, `select platform_update_organization($1, 'Org A', 'demo-a', 'Mars/Base', 'IN')`, [f.orgA])).toBe('22023');
      expect(await fails(tx, `select platform_update_organization($1, 'Org A', 'demo-b', 'Asia/Kolkata', 'IN')`, [f.orgA])).toBe('23505');
    });
  });

  it('owners: added (and told) and removed by platform admins, never the last one', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query('select platform_add_owner($1, $2)', [f.orgB, f.users.ownerA])))).toBe('42501');
    await t.asUser(admin(), async (tx) => {
      expect(await fails(tx, 'select platform_remove_owner($1, $2)', [f.orgB, f.users.ownerB])).toBe('22023'); // the only owner
      await tx.query('select platform_add_owner($1, $2)', [f.orgB, f.users.hrA]); // someone from another organization
      expect(await fails(tx, 'select platform_add_owner($1, $2)', [f.orgB, f.users.hrA])).toBe('22023');
      const [email] = await superRead<{ to_email: string; subject: string }>(tx, `select to_email, subject from email_outbox where event = 'member_added' and organization_id = $1`, [f.orgB]);
      expect(email).toEqual({ to_email: 'hra@example.test', subject: 'You’re now an owner of Demo Org B on PeopleCore' });
      await tx.query('select platform_remove_owner($1, $2)', [f.orgB, f.users.ownerB]);
      const detail = (await tx.query<{ d: { owners: Array<{ email: string }> } }>('select platform_org_detail($1) as d', [f.orgB])).rows[0]!.d;
      expect(detail.owners.map((o) => o.email)).toEqual(['hra@example.test']);
    });
  });

  it('the overview, detail and activity log are for platform admins only', async () => {
    const { f, t } = ctx;
    await t.asUser(f.users.ownerA, async (tx) => {
      expect((await tx.query('select * from platform_org_overview()')).rows).toEqual([]);
      expect((await tx.query<{ d: unknown }>('select platform_org_detail($1) as d', [f.orgA])).rows[0]!.d).toBeNull();
      expect((await tx.query('select * from platform_activity()')).rows).toEqual([]);
    });
    await t.asUser(admin(), async (tx) => {
      await setPlan(tx, f.orgA, 'enterprise');
      const rows = (await tx.query<{ slug: string; employees: number; members: number }>('select slug, employees, members from platform_org_overview() order by slug')).rows;
      expect(rows).toEqual([{ slug: 'demo-a', employees: 4, members: 9 }, { slug: 'demo-b', employees: 1, members: 2 }]);
      const activity = (await tx.query<{ entity_type: string; organization_id: string }>('select entity_type, organization_id from platform_activity($1, 5)', [f.orgA])).rows;
      expect(activity[0]).toEqual({ entity_type: 'organization_subscriptions', organization_id: f.orgA });
    });
  });
});

describe('people added to an organization are emailed', () => {
  it('add_member emails the new member; the helper can’t be used to email anyone else', async () => {
    const { f, t } = ctx;
    const person = await t.createUser('new.joiner@example.test');
    await t.asUser(f.users.hrA, async (tx) => {
      await tx.query('select add_member($1, $2, $3)', [f.orgA, person, [await roleId(tx, f.orgA, 'employee')]]);
      const emails = await superRead<{ to_email: string; event: string; subject: string; body: string; link: string }>(tx,
        `select to_email, event, subject, body, link from email_outbox where event = 'member_added'`);
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({ to_email: 'new.joiner@example.test', subject: 'You’ve been added to Demo Org A on PeopleCore', link: '/' });
      expect(emails[0]!.body).toContain('as Employee');

      const peer = (await tx.query<{ id: string }>('select id from organization_members where user_id = $1', [f.users.peerA])).rows[0]!.id;
      await tx.query('select app.email_added_member($1)', [peer]); // not someone they just added
      expect(await superRead(tx, `select 1 from email_outbox where event = 'member_added' and to_email = 'peera@example.test'`)).toEqual([]);
    });
  });
});

describe('platform administrators', () => {
  it('are added (existing accounts only, and told) and removed by other platform admins, never themselves', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select platform_add_admin('hra@example.test')`)))).toBe('42501');
    expect(await t.asUser(f.users.ownerA, async (tx) => (await tx.query('select * from platform_admin_list()')).rows)).toEqual([]);
    await t.asUser(admin(), async (tx) => {
      expect(await fails(tx, `select platform_add_admin('nobody@example.test')`)).toBe('22023');
      await tx.query(`select platform_add_admin(' HRA@example.test ')`);
      expect(await fails(tx, `select platform_add_admin('hra@example.test')`)).toBe('22023');
      expect((await tx.query<{ email: string }>('select email from platform_admin_list()')).rows.map((r) => r.email).sort()).toEqual(['hra@example.test', 'outsider@example.test']);
      const [email] = await superRead<{ organization_id: string | null; to_email: string; link: string }>(tx, `select organization_id, to_email, link from email_outbox where event = 'platform_admin_added'`);
      expect(email).toEqual({ organization_id: null, to_email: 'hra@example.test', link: '/platform' });
      expect(await fails(tx, 'select platform_remove_admin($1)', [admin()])).toBe('22023');
      await tx.query('select platform_remove_admin($1)', [f.users.hrA]);
      const log = (await tx.query<{ action: string }>(`select action from platform_activity() where entity_type = 'platform_admins'`)).rows.map((r) => r.action);
      expect(log).toEqual(['delete', 'insert']);
    });
  });

  it('the default plan for new organizations is a platform setting', async () => {
    const { f, t } = ctx;
    expect(await pgError(t.asUser(f.users.ownerA, (tx) => tx.query(`select set_platform_default_plan('growth')`)))).toBe('42501');
    await t.asUser(admin(), async (tx) => {
      expect(await fails(tx, `select set_platform_default_plan('nope')`)).toBe('22023');
      await tx.query(`select set_platform_default_plan('growth')`);
      expect((await tx.query<{ d: string }>('select default_plan_code as d from platform_settings')).rows[0]!.d).toBe('growth');
    });
  });
});
