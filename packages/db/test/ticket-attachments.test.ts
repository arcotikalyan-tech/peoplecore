import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

/** Migration 20261022000700: files on helpdesk tickets, under the same rules as replies. */
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

const sha = 'a'.repeat(64);
const add = `select add_ticket_attachment($1, gen_random_uuid(), $2, 'application/pdf', 1200, '${sha}', $3)`;

describe('ticket attachments', () => {
  it('the requester and agents add files; requesters never see internal ones; others see nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.exec('reset role');
      const it_ = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 and name = 'IT and access'`, [f.orgA])).rows[0]!.id;
      await tx.query('update ticket_categories set default_assignee_id = $1 where id = $2', [f.employees.peerA, it_]);

      await as(tx, f.users.icA);
      const ticket = (await tx.query<{ id: string }>(`select raise_ticket($1, $2, 'VPN keeps dropping', 'Every 10 minutes since Monday.', 'high') as id`, [f.orgA, it_])).rows[0]!.id;
      await tx.query(add, [ticket, 'error-screenshot.pdf', false]);
      expect((await failure(tx, add, [ticket, 'secret.pdf', true])).message).toBe('Only agents can add internal files.');
      expect((await failure(tx, `insert into ticket_attachments (id, organization_id, ticket_id, name, content_type, size_bytes, sha256)
        values (gen_random_uuid(), $1, $2, 'x.pdf', 'application/pdf', 1, '${sha}')`, [f.orgA, ticket])).code).toBe('42501'); // writes only through the functions

      await as(tx, f.users.peerA); // the assignee
      await tx.query(add, [ticket, 'vpn-logs.pdf', true]);
      await tx.query(add, [ticket, 'vpn-guide.pdf', false]);
      expect((await tx.query<{ name: string }>('select name from ticket_files($1)', [ticket])).rows.map((r) => r.name)).toEqual(['error-screenshot.pdf', 'vpn-logs.pdf', 'vpn-guide.pdf']);
      await tx.exec('reset role');
      expect((await tx.query(`select 1 from notifications where user_id = $1 and kind = 'helpdesk.reply' and title like 'File added%'`, [f.users.icA])).rows).toHaveLength(1); // the guide, not the internal log

      await as(tx, f.users.icA);
      const mine = (await tx.query<{ id: string; name: string; mine: boolean }>('select id, name, mine from ticket_files($1)', [ticket])).rows;
      expect(mine.map((r) => r.name)).toEqual(['error-screenshot.pdf', 'vpn-guide.pdf']);
      expect((await tx.query<{ name: string }>('select name from ticket_attachments order by created_at')).rows.map((r) => r.name)).toEqual(['error-screenshot.pdf', 'vpn-guide.pdf']);
      expect((await tx.query<{ path: string }>('select path from ticket_file($1)', [mine[0]!.id])).rows[0]!.path).toBe(`${f.orgA}/${ticket}/${mine[0]!.id}`);
      // Someone else's file on their own ticket: the requester may not remove it.
      expect((await failure(tx, 'select remove_ticket_attachment($1)', [mine[1]!.id])).code).toBe('42501');
      expect((await tx.query<{ p: string }>('select remove_ticket_attachment($1) as p', [mine[0]!.id])).rows[0]!.p).toBe(`${f.orgA}/${ticket}/${mine[0]!.id}`);

      await as(tx, f.users.leadA); // neither requester nor agent
      expect((await tx.query('select * from ticket_files($1)', [ticket])).rows).toHaveLength(0);
      expect((await tx.query('select 1 from ticket_attachments')).rows).toHaveLength(0);
      expect((await failure(tx, add, [ticket, 'x.pdf', false])).code).toBe('42501');

      await as(tx, f.users.peerA);
      const logs = (await tx.query<{ id: string }>(`select id from ticket_files($1) where name = 'vpn-logs.pdf'`, [ticket])).rows[0]!.id;
      await as(tx, f.users.icA);
      expect((await tx.query('select * from ticket_file($1)', [logs])).rows).toHaveLength(0); // internal: no download link either
      await tx.query(`select update_ticket($1, 'closed')`, [ticket]);
      expect((await failure(tx, add, [ticket, 'late.pdf', false])).message).toBe('This ticket is closed. Raise a new one.');
    });
  });

  it('a ticket takes at most ten files', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const cat = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 limit 1`, [f.orgA])).rows[0]!.id;
      const ticket = (await tx.query<{ id: string }>(`select raise_ticket($1, $2, 'Payslip question', 'Where is my March payslip?') as id`, [f.orgA, cat])).rows[0]!.id;
      for (let i = 0; i < 10; i++) await tx.query(add, [ticket, `page-${i}.pdf`, false]);
      expect((await failure(tx, add, [ticket, 'page-10.pdf', false])).message).toBe('A ticket can have up to ten files.');
    });
  });
});
