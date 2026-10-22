import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022000800: a public reply on a ticket emails the other side, when the organization switches it on. */
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

describe('helpdesk reply emails', () => {
  it('go to the requester or the assignee once switched on, never for internal notes', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      const cat = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 and name = 'IT and access'`, [f.orgA])).rows[0]!.id;
      await tx.query('update ticket_categories set default_assignee_id = $1 where id = $2', [f.employees.peerA, cat]);
      const emails = async () => (await tx.query<{ user_id: string; subject: string; body: string; link: string }>(
        `select user_id, subject, body, link from email_outbox where event = 'helpdesk_reply' order by created_at, to_email`)).rows;

      await as(tx, f.users.icA);
      const ticket = (await tx.query<{ id: string }>(`select raise_ticket($1, $2, 'VPN keeps dropping', 'Every 10 minutes since Monday.', 'high') as id`, [f.orgA, cat])).rows[0]!.id;
      await as(tx, f.users.peerA);
      await tx.query(`select comment_ticket($1, 'Which client version do you have?')`, [ticket]);
      await tx.exec('reset role');
      expect(await emails()).toEqual([]); // off until switched on

      expect((await failure(tx, `insert into notification_email_rules (organization_id, event, audience) values ($1, 'leave', 'ticket_parties')`, [f.orgA])).code)
        .toBe('23514'); // the people on a ticket are an audience for helpdesk replies only
      await tx.query(`insert into notification_email_rules (organization_id, event, audience) values ($1, 'helpdesk_reply', 'ticket_parties')`, [f.orgA]);

      await as(tx, f.users.peerA);
      await tx.query(`select comment_ticket($1, 'Please update to 5.2.')`, [ticket]);
      await tx.query(`select comment_ticket($1, 'Old client, known issue.', true)`, [ticket]); // internal: no email
      await as(tx, f.users.icA);
      await tx.query(`select comment_ticket($1, 'Updated; it still drops.')`, [ticket]);

      await tx.exec('reset role');
      const sent = await emails();
      expect(sent.map((e) => e.user_id)).toEqual([f.users.icA, f.users.peerA]);
      expect(sent[0]).toMatchObject({ subject: expect.stringMatching(/^Re: ticket #\d+ VPN keeps dropping$/), link: `/helpdesk/${ticket}` });
      expect(sent[0]!.body).toMatch(/^Pia Demo replied on ticket #\d+ “VPN keeps dropping”:\n\nPlease update to 5\.2\.$/);
      expect(sent[1]!.body).toContain('Ishan Demo replied');
      expect(sent.some((e) => e.body.includes('known issue'))).toBe(false);
    });
  });
});
