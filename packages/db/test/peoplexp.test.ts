import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

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

const badge = async (tx: Transaction, org: string, name: string) =>
  (await tx.query<{ id: string }>('select id from pxp_badges where organization_id = $1 and name = $2', [org, name])).rows[0]!.id;
const balance = async (tx: Transaction, employee: string) =>
  Number((await tx.query<{ b: string }>('select coalesce(sum(delta), 0) as b from pxp_ledger where employee_id = $1', [employee])).rows[0]!.b);

describe('PeopleXP', () => {
  it('recognition credits points; high-value badges wait for approval; limits apply; nobody recognises themselves', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const thanks = await badge(tx, f.orgA, 'Thank you');
      const big = await badge(tx, f.orgA, 'Above and beyond');
      const r = (await tx.query<{ v: { status: string } }>(`select pxp_recognize($1, $2, $3, 'Great demo yesterday') as v`, [f.orgA, [f.employees.peerA], thanks])).rows[0]!.v;
      expect(r.status).toBe('approved');
      expect((await failure(tx, `select pxp_recognize($1, $2, $3, 'Me again')`, [f.orgA, [f.employees.icA], thanks])).message).toContain('yourself');

      const pending = (await tx.query<{ v: { id: string; status: string } }>(`select pxp_recognize($1, $2, $3, 'Saved the launch') as v`, [f.orgA, [f.employees.peerA], big])).rows[0]!.v;
      expect(pending.status).toBe('pending');

      await as(tx, f.users.peerA);
      expect(await balance(tx, f.employees.peerA)).toBe(10);
      // The pending one isn't on the feed for others yet; the approved one is.
      await as(tx, f.users.leadA);
      expect((await tx.query(`select 1 from pxp_posts where kind = 'recognition'`)).rows).toHaveLength(1);

      // Pending: the giver, the recipient and admins see it; other colleagues don't.
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from pxp_recognitions where id = $1', [pending.id])).rows).toHaveLength(1);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from pxp_recognitions where id = $1', [pending.id])).rows).toHaveLength(1);
      await as(tx, f.users.leadA);
      expect((await tx.query('select 1 from pxp_recognitions where id = $1', [pending.id])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from pxp_recognition_recipients where recognition_id = $1', [pending.id])).rows).toHaveLength(0);
      expect((await tx.query(`select 1 from pxp_recognitions where status = 'approved'`)).rows).toHaveLength(1);
      await as(tx, f.users.hrA);
      expect((await tx.query('select 1 from pxp_recognitions')).rows).toHaveLength(2);
      await tx.query('select pxp_decide($1, true)', [pending.id]);
      await as(tx, f.users.peerA);
      expect(await balance(tx, f.employees.peerA)).toBe(110);
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from notifications where user_id = $1 and kind = 'peoplexp.recognized'`, [f.users.peerA])).rows).toHaveLength(2);

      // Daily limit.
      await as(tx, f.users.hrA);
      await tx.query(`insert into pxp_settings (organization_id, daily_recognition_limit) values ($1, 2)`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select pxp_recognize($1, $2, $3, 'Third today')`, [f.orgA, [f.employees.leadA], thanks])).message).toContain('limit of 2');
    });
  });

  it('rewards are redeemed from the balance; cancelling refunds; the ledger is append-only', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const reward = (await tx.query<{ id: string }>(`insert into pxp_rewards (organization_id, name, cost, stock) values ($1, 'Extra day off', 50, 1) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select pxp_adjust($1, 60, 'Welcome bonus')`, [f.employees.icA]);
      expect((await failure(tx, `select pxp_adjust($1, 60, 'x')`, [f.employees.managerA])).message).toContain('reason');

      await as(tx, f.users.icA);
      const d = (await tx.query<{ id: string }>('select pxp_redeem($1) as id', [reward])).rows[0]!.id;
      expect(await balance(tx, f.employees.icA)).toBe(10);
      expect((await failure(tx, 'select pxp_redeem($1)', [reward])).message).toMatch(/more points|out of stock/);
      expect((await failure(tx, 'delete from pxp_ledger where employee_id = $1', [f.employees.icA])).code).toBe('42501');

      await as(tx, f.users.hrA);
      await tx.query(`select pxp_fulfil($1, 'cancelled', 'Out this month')`, [d]);
      await as(tx, f.users.icA);
      expect(await balance(tx, f.employees.icA)).toBe(60);
      // Others can't see someone's wallet.
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from pxp_ledger where employee_id = $1', [f.employees.icA])).rows).toHaveLength(0);
    });
  });

  it('feed audiences, pulse privacy and nominations', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      // Ishan's team post: his manager (Lalit) sees it; Pia (another team) doesn't.
      await tx.query(`insert into pxp_posts (organization_id, author_employee_id, body, audience) values ($1, $2, 'Team lunch Friday', 'team')`, [f.orgA, f.employees.icA]);
      expect((await failure(tx, `insert into pxp_posts (organization_id, author_employee_id, body, kind) values ($1, $2, 'Policy', 'announcement')`, [f.orgA, f.employees.icA])).code).toBe('42501');
      await tx.query(`select pxp_checkin($1, 2::smallint)`, [f.orgA]);
      const value = (await tx.query<{ id: string }>(`select id from pxp_values where organization_id = $1 and name = 'Teamwork'`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into pxp_nominations (organization_id, nominee_employee_id, nominator_employee_id, value_id, month, reason)
        values ($1, $2, $3, $4, date_trunc('month', current_date), 'Covered for me during release week')`, [f.orgA, f.employees.peerA, f.employees.icA, value]);

      await as(tx, f.users.leadA);
      expect((await tx.query(`select 1 from pxp_posts where body = 'Team lunch Friday'`)).rows).toHaveLength(1);
      expect((await tx.query('select 1 from pxp_pulse')).rows).toHaveLength(0);
      expect((await tx.query('select 1 from pxp_nominations')).rows).toHaveLength(0);
      await as(tx, f.users.peerA);
      expect((await tx.query(`select 1 from pxp_posts where body = 'Team lunch Friday'`)).rows).toHaveLength(0);

      // One answer isn't enough to show in the summary.
      await as(tx, f.users.hrA);
      expect((await tx.query(`select * from pxp_pulse_summary($1, current_date - 7, current_date + 1)`, [f.orgA])).rows).toHaveLength(0);
      await as(tx, f.users.icA);
      expect((await failure(tx, `select * from pxp_pulse_summary($1, current_date - 7, current_date + 1)`, [f.orgA])).code).toBe('42501');

      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from pxp_posts')).rows).toHaveLength(0);
    });
  });
});
