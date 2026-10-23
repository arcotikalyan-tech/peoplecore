import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261023000100: phones register for push notifications; each new notification is queued for the worker. */
const ctx = useDatabase();

const TOKEN_A = 'fcm-token-ica-phone-0001';
const TOKEN_B = 'fcm-token-employeeb-phone-0002';

async function as(tx: Transaction, user: string, aal: 'aal1' | 'aal2' = 'aal2') {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal })]);
  await tx.exec('set local role authenticated');
}

/** The error code of a statement expected to fail; the transaction carries on. */
async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<string | undefined> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return (err as { code?: string }).code;
  }
  throw new Error(`expected to fail: ${sql}`);
}

const devices = (tx: Transaction) =>
  tx.query<{ token: string; user_id: string }>('select token, user_id from app.push_devices order by token').then((r) => r.rows);

describe('push notifications', () => {
  it('register only the signed-in person’s phone, with two-step where their organization asks for it', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.query(`select register_push_device($1, 'android')`, [TOKEN_A]);
      expect(await failure(tx, `select register_push_device('short', 'android')`)).toBe('22023');
      expect(await failure(tx, `select register_push_device($1, 'windows')`, [TOKEN_A])).toBe('22023');
      // The phones themselves are out of reach (private schema); only the functions touch them.
      expect(await failure(tx, 'select * from app.push_devices')).toBe('42501');
      expect(await failure(tx, 'select * from worker_claim_pushes(10)')).toBe('42501');

      // Organization A asks for two-step: a password-only session can't register. B doesn't ask.
      await as(tx, f.users.icA, 'aal1');
      expect(await failure(tx, `select register_push_device($1, 'android')`, [`${TOKEN_A}-x`])).toBe('42501');
      await as(tx, f.users.employeeB, 'aal1');
      await tx.query(`select register_push_device($1, 'android')`, [TOKEN_B]);

      // Someone else can't remove icA's phone; icA can.
      await tx.query('select unregister_push_device($1)', [TOKEN_A]);
      await tx.exec('reset role');
      expect(await devices(tx)).toEqual([
        { token: TOKEN_B, user_id: f.users.employeeB },
        { token: TOKEN_A, user_id: f.users.icA },
      ]);
      await as(tx, f.users.icA);
      await tx.query('select unregister_push_device($1)', [TOKEN_A]);
      await tx.exec('reset role');
      expect((await devices(tx)).map((d) => d.token)).toEqual([TOKEN_B]);

      // A phone that changes hands moves to whoever signs in on it.
      await as(tx, f.users.icA);
      await tx.query(`select register_push_device($1, 'android')`, [TOKEN_B]);
      await tx.exec('reset role');
      expect(await devices(tx)).toEqual([{ token: TOKEN_B, user_id: f.users.icA }]);
    });
  });

  it('queue each new notification for people with a phone; the worker sends, retries and forgets dead phones', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.query(`select register_push_device($1, 'android')`, [TOKEN_A]);
      await tx.query(`select register_push_device($1, 'android')`, [`${TOKEN_A}-tablet`]);
      await tx.exec('reset role');
      await tx.query(`select app.notify($1, $2, 'payroll.payslip', 'Your payslip for Oct 2026 is ready', null, '/payslips')`, [f.orgA, f.users.icA]);
      await tx.query(`select app.notify($1, $2, 'leave.nudge', 'You have 4 days of leave to use')`, [f.orgA, f.users.icA]);
      await tx.query(`select app.notify($1, $2, 'leave.nudge', 'No phone, no push')`, [f.orgA, f.users.peerA]);
      // Read on the website before it went out: not pushed.
      await tx.query(`update notifications set read_at = now() where user_id = $1 and kind = 'leave.nudge'`, [f.users.icA]);

      await tx.exec('set local role service_role');
      const batch = (await tx.query<{ id: string; tokens: string[]; title: string; link: string | null; kind: string; org_slug: string; org_name: string }>(
        'select id, tokens, title, link, kind, org_slug, org_name from worker_claim_pushes(10)')).rows;
      expect(batch).toHaveLength(1);
      expect(batch[0]).toMatchObject({ title: 'Your payslip for Oct 2026 is ready', link: '/payslips', kind: 'payroll.payslip', org_slug: 'demo-a', org_name: 'Demo Org A' });
      expect([...batch[0]!.tokens].sort()).toEqual([TOKEN_A, `${TOKEN_A}-tablet`]);
      expect((await tx.query('select * from worker_claim_pushes(10)')).rows).toHaveLength(0); // claimed once

      // A failure is tried again; the tablet that was uninstalled is forgotten.
      await tx.query('select worker_push_result($1, false, $2, $3)', [batch[0]!.id, 'FCM 503', [`${TOKEN_A}-tablet`]]);
      const again = (await tx.query<{ id: string; tokens: string[] }>('select id, tokens from worker_claim_pushes(10)')).rows;
      expect(again).toEqual([{ id: batch[0]!.id, tokens: [TOKEN_A] }]);
      await tx.query('select worker_push_result($1, true)', [batch[0]!.id]);
      await tx.exec('reset role');
      const states = (await tx.query<{ title: string; status: string; attempts: number }>(
        `select n.title, x.status, x.attempts from app.push_outbox x join notifications n on n.id = x.notification_id order by n.title`)).rows;
      expect(states).toEqual([
        { title: 'You have 4 days of leave to use', status: 'skipped', attempts: 0 },
        { title: 'Your payslip for Oct 2026 is ready', status: 'sent', attempts: 2 },
      ]);

      // Pushes nobody could send within a day expire.
      await tx.query(`select app.notify($1, $2, 'leave.nudge', 'Old news')`, [f.orgA, f.users.icA]);
      await tx.query(`update app.push_outbox set created_at = now() - interval '25 hours' where status = 'queued'`);
      await tx.exec('set local role service_role');
      expect((await tx.query('select * from worker_claim_pushes(10)')).rows).toHaveLength(0);
      await tx.exec('reset role');
      expect((await tx.query<{ status: string }>(`select x.status from app.push_outbox x join notifications n on n.id = x.notification_id where n.title = 'Old news'`)).rows)
        .toEqual([{ status: 'expired' }]);
    });
  });
});
