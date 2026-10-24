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

const due = async (tx: Transaction, org: string, from: string, priority: string) =>
  (await tx.query<{ at: string }>(`select to_char(app.helpdesk_due($1, $2::timestamptz, $3) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at`, [org, from, priority])).rows[0]!.at;

describe('helpdesk response targets', () => {
  it('count business hours on the organization’s working days, skipping weekly offs and holidays', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      await tx.query(`update organizations set timezone = 'Asia/Kolkata' where id = $1`, [f.orgA]);
      await tx.query(`insert into holiday_calendars (organization_id, name, weekly_offs) values ($1, 'Default', '{0,6}')
                      on conflict (organization_id) where location_id is null do update set weekly_offs = '{0,6}'`, [f.orgA]);
      const cal = (await tx.query<{ id: string }>('select id from holiday_calendars where organization_id = $1 and location_id is null', [f.orgA])).rows[0]!.id;
      await tx.query(`insert into holidays (organization_id, calendar_id, holiday_date, name) values ($1, $2, '2026-10-26', 'Festival')
                      on conflict (calendar_id, holiday_date) do nothing`, [f.orgA, cal]);
      await tx.query(`insert into holidays (organization_id, calendar_id, holiday_date, name, is_optional) values ($1, $2, '2026-10-27', 'Optional', true)
                      on conflict (calendar_id, holiday_date) do nothing`, [f.orgA, cal]);

      // Wall-clock hours until an organization switches business hours on.
      expect(await due(tx, f.orgA, '2026-10-23 17:30+05:30', 'normal')).toBe('2026-10-24 12:00');

      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from helpdesk_settings')).rows).toHaveLength(0);
      expect((await failure(tx, `insert into helpdesk_settings (organization_id, business_hours) values ($1, true)`, [f.orgA])).code).toBe('42501');
      await as(tx, f.users.hrA);
      expect((await failure(tx, `insert into helpdesk_settings (organization_id, urgent_hours, high_hours) values ($1, 10, 8)`, [f.orgA])).code).toBe('23514');
      await tx.query(`insert into helpdesk_settings (organization_id, business_hours, day_start, day_end) values ($1, true, '09:30', '18:30')`, [f.orgA]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ business_hours: boolean }>('select business_hours from helpdesk_settings')).rows).toEqual([{ business_hours: true }]);

      await tx.exec('reset role');
      // Friday 17:30: an hour on Friday, then Tuesday (Saturday and Sunday off, Monday a holiday; Tuesday's holiday is
      // optional), Wednesday, and five hours on Thursday: 14:30 IST.
      expect(await due(tx, f.orgA, '2026-10-23 17:30+05:30', 'normal')).toBe('2026-10-29 09:00');
      expect(await due(tx, f.orgA, '2026-10-23 17:30+05:30', 'urgent')).toBe('2026-10-27 07:00'); // Tuesday 12:30 IST
      expect(await due(tx, f.orgA, '2026-10-29 08:00+05:30', 'high')).toBe('2026-10-29 12:00'); // before opening: 09:30 + 8 h = 17:30 IST
      expect(await due(tx, f.orgA, '2026-10-24 11:00+05:30', 'urgent')).toBe('2026-10-27 08:00'); // raised on a Saturday: Tuesday 09:30 + 4 h

      // Tickets use it when raised and when their priority changes.
      const cat = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 and name = 'Other'`, [f.orgA])).rows[0]!.id;
      await as(tx, f.users.icA);
      const ticket = (await tx.query<{ id: string }>(`select raise_ticket($1, $2, 'Seat change', 'Move me near my team.', 'low') as id`, [f.orgA, cat])).rows[0]!.id;
      await tx.exec('reset role');
      const check = async () => (await tx.query<{ ok: boolean }>(
        'select sla_due_at = app.helpdesk_due(organization_id, created_at, priority) as ok from tickets where id = $1', [ticket])).rows[0]!.ok;
      expect(await check()).toBe(true);
      await as(tx, f.users.hrA);
      await tx.query(`select update_ticket($1, 'in_progress', null, 'urgent')`, [ticket]);
      await tx.exec('reset role');
      expect(await check()).toBe(true);
    });
  });
});

describe('helpdesk satisfaction', () => {
  it('the requester rates resolved tickets from 1 to 5; the assignee is told, managers see the average', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const cat = (await tx.query<{ id: string }>(`select id from ticket_categories where organization_id = $1 and name = 'Other'`, [f.orgA])).rows[0]!.id;
      await as(tx, f.users.icA);
      const ticket = (await tx.query<{ id: string }>(`select raise_ticket($1, $2, 'Payslip missing', 'My October payslip is not there.') as id`, [f.orgA, cat])).rows[0]!.id;
      expect((await failure(tx, 'select rate_ticket($1, 5)', [ticket])).message).toBe('You can rate the help once the ticket is resolved.');

      await as(tx, f.users.hrA);
      await tx.query(`select update_ticket($1, 'resolved', $2)`, [ticket, f.employees.peerA]);
      await as(tx, f.users.icA);
      expect((await tx.query<{ title: string }>(`select title from notifications where kind = 'helpdesk.resolved'`)).rows[0]!.title).toMatch(/How did we do\?$/);
      expect((await failure(tx, 'select rate_ticket($1, 6)', [ticket])).message).toBe('Choose from 1 to 5.');
      await tx.query(`select rate_ticket($1, 2, 'Took three days.')`, [ticket]);
      await tx.query(`select rate_ticket($1, 4, '  Sorted in the end.  ')`, [ticket]);
      expect((await tx.query('select rating, comment from ticket_feedback where ticket_id = $1', [ticket])).rows).toEqual([{ rating: 4, comment: 'Sorted in the end.' }]);

      await as(tx, f.users.peerA); // the assignee
      expect((await tx.query<{ title: string }>(`select title from notifications where kind = 'helpdesk.feedback' order by created_at`)).rows.map((r) => r.title.slice(0, 13)))
        .toEqual(['Rated 2 of 5:', 'Rated 4 of 5:']);
      expect((await tx.query('select rating from ticket_feedback where ticket_id = $1', [ticket])).rows).toEqual([{ rating: 4 }]);
      expect((await failure(tx, 'select rate_ticket($1, 5)', [ticket])).code).toBe('42501'); // only the requester rates

      await as(tx, f.users.managerA); // not involved
      expect((await tx.query('select 1 from ticket_feedback')).rows).toHaveLength(0);
      expect((await tx.query('select responses from helpdesk_satisfaction($1)', [f.orgA])).rows).toEqual([{ responses: 0 }]);

      await as(tx, f.users.hrA);
      expect((await tx.query('select responses, average::text as average, low from helpdesk_satisfaction($1)', [f.orgA])).rows)
        .toEqual([{ responses: 1, average: '4.0', low: 0 }]);
      await tx.query(`select update_ticket($1, 'closed')`, [ticket]);
      await as(tx, f.users.icA);
      await tx.query('select rate_ticket($1, 5)', [ticket]); // still possible once closed
    });
  });
});
