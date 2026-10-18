import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

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

const titles = async (tx: Transaction) =>
  (await tx.query<{ title: string }>('select title from announcements order by title')).rows.map((r) => r.title);

describe('announcements', () => {
  it('reach everyone or one department, go live when published, and are acknowledged once', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query('update employees set department_id = $1 where id = $2', [f.deptA, f.employees.icA]);
      await as(tx, f.users.hrA);
      const all = (await tx.query<{ id: string }>(
        `insert into announcements (organization_id, title, body, requires_ack) values ($1, 'New leave policy', 'Read the updated policy.', true) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into announcements (organization_id, title, body, department_id) values ($1, 'Engineering offsite', 'Friday in Pune.', $2)`, [f.orgA, f.deptA]);
      await tx.query(`insert into announcements (organization_id, title, body, published_at) values ($1, 'Coming soon', 'Not yet.', now() + interval '2 days')`, [f.orgA]);
      expect(await titles(tx)).toEqual(['Coming soon', 'Engineering offsite', 'New leave policy']);

      await as(tx, f.users.icA); // in Engineering
      expect(await titles(tx)).toEqual(['Engineering offsite', 'New leave policy']);
      await tx.query('select acknowledge_announcement($1)', [all]);
      await tx.query('select acknowledge_announcement($1)', [all]); // idempotent
      expect((await tx.query('select 1 from announcement_acknowledgements')).rows).toHaveLength(1);
      expect((await failure(tx, `insert into announcements (organization_id, title, body) values ($1, 'Mine', 'Not allowed.')`, [f.orgA])).code).toBe('42501');

      await as(tx, f.users.peerA); // no department
      expect(await titles(tx)).toEqual(['New leave policy']);
      expect((await tx.query('select 1 from announcement_acknowledgements')).rows).toHaveLength(0); // someone else’s

      await as(tx, f.users.employeeB);
      expect(await titles(tx)).toEqual([]);
      expect((await failure(tx, 'select acknowledge_announcement($1)', [all])).code).toBe('42501');

      await as(tx, f.users.hrA);
      expect((await tx.query<{ employee_id: string }>('select employee_id from announcement_acknowledgements where announcement_id = $1', [all])).rows)
        .toEqual([{ employee_id: f.employees.icA }]);
    });
  });
});

describe('helpdesk', () => {
  it('raise → routed to the category’s assignee → internal note and reply → waiting → reopened → resolved → closed', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const it = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 and name = 'IT and access'`, [f.orgA])).rows[0]!.id;
      await tx.query('update ticket_categories set default_assignee_id = $1 where id = $2', [f.employees.peerA, it]);

      await as(tx, f.users.icA);
      expect((await failure(tx, `select raise_ticket($1, $2, 'Laptop', 'Broken', 'high')`, [f.orgA, it])).message).toBe('Describe the problem in a sentence or two.');
      const ticket = (await tx.query<{ id: string }>(
        `select raise_ticket($1, $2, 'VPN keeps dropping', 'Every 10 minutes since Monday.', 'high') as id`, [f.orgA, it])).rows[0]!.id;
      const t = (await tx.query<{ number: number; assignee_id: string; hours: number }>(
        `select number, assignee_id, round(extract(epoch from sla_due_at - created_at) / 3600) as hours from tickets where id = $1`, [ticket])).rows[0]!;
      expect(t).toMatchObject({ number: 1, assignee_id: f.employees.peerA });
      expect(Number(t.hours)).toBe(8);

      // The assignee works it without org-wide helpdesk access.
      await as(tx, f.users.peerA);
      expect((await tx.query(`select 1 from notifications where kind = 'helpdesk.assigned'`)).rows).toHaveLength(1);
      await tx.query(`select comment_ticket($1, 'Looks like the old client; check version.', true)`, [ticket]);
      await tx.query(`select comment_ticket($1, 'Please update the VPN client to 5.2 and tell me if it still drops.')`, [ticket]);
      await tx.query(`select update_ticket($1, 'waiting')`, [ticket]);
      expect((await failure(tx, `select update_ticket($1, 'in_progress', $2)`, [ticket, f.employees.managerA])).code).toBe('42501'); // can’t reassign

      await as(tx, f.users.icA);
      expect((await tx.query<{ body: string }>('select body from ticket_comments where ticket_id = $1', [ticket])).rows.map((r) => r.body))
        .toEqual(['Please update the VPN client to 5.2 and tell me if it still drops.']); // no internal note
      expect((await failure(tx, `select comment_ticket($1, 'Sneaky internal note', true)`, [ticket])).message).toBe('Only agents can add internal notes.');
      expect((await tx.query<{ author_name: string; mine: boolean }>('select author_name, mine from ticket_thread($1)', [ticket])).rows)
        .toEqual([{ author_name: 'Pia Demo', mine: false }]);
      expect((await failure(tx, `select update_ticket($1, 'resolved')`, [ticket])).code).toBe('42501');
      await tx.query(`select comment_ticket($1, 'Updated, still drops.')`, [ticket]);
      expect((await tx.query<{ status: string }>('select status from tickets where id = $1', [ticket])).rows[0]!.status).toBe('open');

      await as(tx, f.users.managerA); // not involved
      expect((await tx.query('select 1 from tickets where id = $1', [ticket])).rows).toHaveLength(0);
      expect((await tx.query('select * from ticket_thread($1)', [ticket])).rows).toHaveLength(0);
      expect((await failure(tx, `select comment_ticket($1, 'Hello')`, [ticket])).code).toBe('42501');

      await as(tx, f.users.hrA);
      await tx.query(`select update_ticket($1, 'resolved')`, [ticket]);
      expect((await tx.query<{ internal: boolean }>('select internal from ticket_thread($1)', [ticket])).rows.map((r) => r.internal)).toEqual([true, false, false]);
      await as(tx, f.users.icA);
      expect((await tx.query(`select 1 from notifications where kind in ('helpdesk.reply', 'helpdesk.resolved')`)).rows).toHaveLength(2);
      await tx.query(`select update_ticket($1, 'closed')`, [ticket]);
      expect((await failure(tx, `select comment_ticket($1, 'One more thing')`, [ticket])).message).toBe('This ticket is closed. Raise a new one.');

      await as(tx, f.users.employeeB); // another organization
      expect((await failure(tx, `select raise_ticket($1, $2, 'Payslip', 'Where is my payslip?')`, [f.orgA, it])).code).toBe('42501');
    });
  });

  it('the worker flags a missed SLA once and escalates to the assignee and helpdesk staff', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const cat = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 and name = 'Other'`, [f.orgA])).rows[0]!.id;
      const ticket = (await tx.query<{ id: string }>(`select raise_ticket($1, $2, 'Seat change', 'Move me near my team.', 'urgent') as id`, [f.orgA, cat])).rows[0]!.id;
      expect((await failure(tx, 'select worker_helpdesk_sla()')).code).toBe('42501');
      await as(tx, f.users.hrA); // unrouted category: helpdesk staff hear about it
      expect((await tx.query(`select 1 from notifications where kind = 'helpdesk.new'`)).rows).toHaveLength(1);

      await tx.exec('reset role');
      await tx.query(`update tickets set sla_due_at = now() - interval '1 minute', assignee_id = $2 where id = $1`, [ticket, f.employees.peerA]);
      await tx.exec('set local role service_role');
      expect((await tx.query<{ r: { breached: number } }>('select worker_helpdesk_sla() as r')).rows[0]!.r).toEqual({ breached: 1 });
      expect((await tx.query<{ r: { breached: number } }>('select worker_helpdesk_sla() as r')).rows[0]!.r).toEqual({ breached: 0 });
      await tx.exec('reset role');
      const told = (await tx.query<{ user_id: string }>(`select user_id from notifications where kind = 'helpdesk.breach' order by user_id`)).rows.map((r) => r.user_id);
      expect(told.sort()).toEqual([f.users.ownerA, f.users.hrA, f.users.peerA].sort());
    });
  });
});

describe('knowledge base', () => {
  it('members read and search published articles; drafts and edits are for helpdesk staff', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into kb_articles (organization_id, title, body, category, published) values
        ($1, 'Reset your VPN password', 'Open the portal, choose Forgot password and follow the steps.', 'IT', true),
        ($1, 'Payroll calendar draft', 'Payroll closes on the 25th of every month (draft).', 'Payroll', false)`, [f.orgA]);
      expect((await tx.query('select * from search_kb($1, $2)', [f.orgA, 'payroll'])).rows).toHaveLength(1);

      await as(tx, f.users.icA);
      expect((await tx.query<{ title: string }>('select title from search_kb($1, $2)', [f.orgA, ''])).rows.map((r) => r.title)).toEqual(['Reset your VPN password']);
      expect((await tx.query('select * from search_kb($1, $2)', [f.orgA, 'payroll'])).rows).toHaveLength(0);
      expect((await tx.query<{ title: string }>('select title from search_kb($1, $2)', [f.orgA, 'vpn password'])).rows).toHaveLength(1);
      expect((await failure(tx, `insert into kb_articles (organization_id, title, body) values ($1, 'My tips', 'Things I think are useful.')`, [f.orgA])).code).toBe('42501');

      await as(tx, f.users.employeeB);
      expect((await tx.query('select * from search_kb($1, $2)', [f.orgA, ''])).rows).toHaveLength(0);
    });
  });
});

describe('kudos', () => {
  it('go from one colleague to another, notify the recipient and stay in the organization', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await tx.query(`select give_kudos($1, $2, 'Thanks for covering the release on Sunday!')`, [f.orgA, f.employees.peerA]);
      expect((await failure(tx, `select give_kudos($1, $2, 'Great work, me.')`, [f.orgA, f.employees.icA])).message).toBe('Kudos go to someone else.');
      expect((await failure(tx, `select give_kudos($1, $2, 'Hi from the other org')`, [f.orgA, f.employees.employeeB])).message).toBe('Choose a colleague.');
      expect((await failure(tx, `insert into kudos (organization_id, from_employee_id, to_employee_id, message) values ($1, $2, $3, 'Direct insert')`,
        [f.orgA, f.employees.icA, f.employees.peerA])).code).toBe('42501');

      expect((await tx.query<{ from_name: string; to_name: string }>('select from_name, to_name from kudos_feed($1)', [f.orgA])).rows)
        .toEqual([{ from_name: 'Ishan Demo', to_name: 'Pia Demo' }]);

      await as(tx, f.users.peerA);
      expect((await tx.query(`select 1 from notifications where kind = 'kudos.received'`)).rows).toHaveLength(1);
      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from kudos')).rows).toHaveLength(0);
      expect((await tx.query('select * from kudos_feed($1)', [f.orgA])).rows).toHaveLength(0);
    });
  });
});

describe('colleague directory', () => {
  it('gives members names, department and designation only; nothing across organizations', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.recruiterA, async (tx) => {
      expect((await tx.query('select 1 from employees')).rows).toHaveLength(0); // still no employee rows
      const found = await tx.query<Record<string, unknown>>('select * from colleague_directory($1, $2)', [f.orgA, 'pia']);
      expect(found.rows).toEqual([{ id: f.employees.peerA, name: 'Pia Demo', department: null, designation: null }]);
      expect((await tx.query('select * from colleague_directory($1)', [f.orgA])).rows.length).toBeGreaterThanOrEqual(4);
      expect((await tx.query('select * from colleague_directory($1)', [f.orgB])).rows).toHaveLength(0);
    });
  });

  it('only HR publishes announcements and configures the helpdesk', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) =>
      tx.query(`insert into ticket_categories (organization_id, name) values ($1, 'Facilities')`, [f.orgA])))).toBe('42501');
  });
});
