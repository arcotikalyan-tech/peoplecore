import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

/**
 * Migration 20261022000300 (Kredily second pass, batch 4): visiting cards, custom lines and rolling a card out; the
 * Konnect discussion board; the insurance CD ledger; the job-board feed; bulk learning reminders; vendor TDS facts.
 */
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

describe('ID Studio', () => {
  it('ID and visiting cards each have a default; rolling one out tells everyone; custom lines are checked', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const mk = async (name: string, type: string) => (await tx.query<{ id: string }>(
        `insert into id_card_designs (organization_id, name, card_type, fields) values ($1, $2, $3, $4) returning id`,
        [f.orgA, name, type, type === 'visiting' ? ['designation', 'phone', 'work_email', 'office_address', 'website'] : ['employee_code', 'blood_group']])).rows[0]!.id;
      const id1 = await mk('Staff ID', 'id');
      const id2 = await mk('Contractor ID', 'id');
      const vc = await mk('Business card', 'visiting');
      await tx.query('select set_default_id_card($1)', [id1]);
      await tx.query('select set_default_id_card($1)', [vc]);
      await tx.query('select set_default_id_card($1)', [id2]);
      const defaults = (await tx.query<{ name: string; card_type: string }>(`select name, card_type from id_card_designs where organization_id = $1 and is_default order by card_type`, [f.orgA])).rows;
      expect(defaults).toEqual([{ name: 'Contractor ID', card_type: 'id' }, { name: 'Business card', card_type: 'visiting' }]);

      await tx.query(`update id_card_designs set custom_fields = '[{"label":"Access","value":"All floors"}]' where id = $1`, [id1]);
      expect((await failure(tx, `update id_card_designs set custom_fields = '[{"label":"","value":"x"}]' where id = $1`, [id1])).code).toBe('22023');
      expect((await failure(tx, `update id_card_designs set custom_fields = '[{"label":"a","value":"1"},{"label":"b","value":"2"},{"label":"c","value":"3"},{"label":"d","value":"4"},{"label":"e","value":"5"}]' where id = $1`, [id1])).code).toBe('23514');
      expect((await failure(tx, `update id_card_designs set fields = '{favourite_food}' where id = $1`, [id1])).code).toBe('23514');

      expect((await tx.query<{ n: number }>('select roll_out_id_card($1) as n', [id1])).rows[0]!.n).toBe(4);
      expect((await tx.query<{ d: boolean }>('select is_default as d from id_card_designs where id = $1', [id1])).rows[0]!.d).toBe(true);
      await tx.exec('reset role');
      expect((await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'idcard.ready'`, [f.users.icA])).rows).toEqual([{ title: 'Your ID card is ready' }]);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select roll_out_id_card($1)', [vc])).code).toBe('42501');
    });
  });
});

describe('Konnect', () => {
  it('people post and reply in open topics; the author hears of replies; likes count; moderators pin, lock and hide', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const topics = (await tx.query<{ id: string; name: string }>(`select id, name from konnect_topics where organization_id = $1 order by position`, [f.orgA])).rows;
      expect(topics.map((t) => t.name)).toEqual(['General', 'Ideas', 'Help & questions', 'Events & clubs', 'Buy & sell']);
      const help = topics[2]!.id;
      const thread = (await tx.query<{ id: string }>(`insert into konnect_threads (organization_id, topic_id, author_employee_id, title, body) values ($1, $2, $3, 'Printer on floor 3?', 'It keeps jamming. Who fixes it?') returning id`,
        [f.orgA, help, f.employees.icA])).rows[0]!.id;
      expect((await failure(tx, `insert into konnect_threads (organization_id, topic_id, author_employee_id, title, body) values ($1, $2, $3, 'As someone else', 'x')`, [f.orgA, help, f.employees.peerA])).code).toBe('42501');
      expect((await failure(tx, 'update konnect_threads set pinned = true where id = $1', [thread])).code).toBe('42501');

      await as(tx, f.users.peerA);
      await tx.query(`insert into konnect_replies (organization_id, thread_id, author_employee_id, body) values ($1, $2, $3, 'Facilities: raise a helpdesk ticket.')`, [f.orgA, thread, f.employees.peerA]);
      await tx.query(`insert into konnect_likes (organization_id, thread_id, employee_id) values ($1, $2, $3)`, [f.orgA, thread, f.employees.peerA]);
      expect((await tx.query<{ r: number; l: number }>('select reply_count as r, like_count as l from konnect_threads where id = $1', [thread])).rows[0]).toEqual({ r: 1, l: 1 });
      // Someone else's thread: no editing it.
      expect((await tx.query(`update konnect_threads set title = 'Hijacked' where id = $1`, [thread])).affectedRows).toBe(0);

      await tx.exec('reset role');
      expect((await tx.query<{ title: string }>(`select title from notifications where user_id = $1 and kind = 'konnect.reply'`, [f.users.icA])).rows)
        .toEqual([{ title: 'Pia Demo replied to “Printer on floor 3?”' }]);

      await as(tx, f.users.hrA);  // moderates (manages announcements)
      await tx.query('update konnect_threads set pinned = true, locked = true where id = $1', [thread]);
      await as(tx, f.users.peerA);
      expect((await failure(tx, `insert into konnect_replies (organization_id, thread_id, author_employee_id, body) values ($1, $2, $3, 'One more')`, [f.orgA, thread, f.employees.peerA])).code).toBe('42501');
      await as(tx, f.users.hrA);
      await tx.query('update konnect_threads set hidden = true where id = $1', [thread]);
      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from konnect_threads where id = $1', [thread])).rows).toHaveLength(0);
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from konnect_threads where id = $1', [thread])).rows).toHaveLength(1);  // the author still sees it
      await as(tx, f.users.ownerB);
      expect((await tx.query('select 1 from konnect_topics where organization_id = $1', [f.orgA])).rows).toHaveLength(0);
    });
  });
});

describe('insurance CD account', () => {
  it('HR keeps the ledger: deposits in, endorsement charges out, with the right signs; employees see nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into insurance_cd_entries (organization_id, entry_date, kind, amount, reference) values ($1, '2026-04-01', 'deposit', 200000, 'NEFT 123'),
        ($1, '2026-05-01', 'endorsement', -12500, 'Endorsement 4'), ($1, '2026-06-01', 'refund', 1800, 'Exit refund')`, [f.orgA]);
      expect((await tx.query<{ b: string }>('select sum(amount)::text as b from insurance_cd_entries where organization_id = $1', [f.orgA])).rows[0]!.b).toBe('189300.00');
      expect((await failure(tx, `insert into insurance_cd_entries (organization_id, entry_date, kind, amount) values ($1, '2026-07-01', 'deposit', -5)`, [f.orgA])).code).toBe('23514');
      expect((await failure(tx, `insert into insurance_cd_entries (organization_id, entry_date, kind, amount) values ($1, '2026-07-01', 'endorsement', 500)`, [f.orgA])).code).toBe('23514');
      await as(tx, f.users.icA);
      expect((await tx.query('select 1 from insurance_cd_entries')).rows).toHaveLength(0);
    });
  });

  it('HR sends only the chosen changes and the rest stay pending; entries link to own endorsements; employees never see the CD figures', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into insurance_policies (organization_id, insurer, premium_per_life, cd_low_balance) values ($1, 'Example General Insurance', 4200, 50000)`, [f.orgA]);
      await tx.query('insert into insurance_coverage (organization_id, employee_id) values ($1, $2), ($1, $3), ($1, $4)', [f.orgA, f.employees.icA, f.employees.peerA, f.employees.leadA]);
      const pending = async () => (await tx.query<{ change: string; employee_id: string }>(
        `select change, employee_id from insurance_endorsement($1) where change <> 'covered' order by change, employee_id`, [f.orgA])).rows;
      // Syncs made in one transaction share now(); move earlier ones back so "the last endorsement" is unambiguous.
      const age = async () => { await tx.exec('reset role'); await tx.query(`update insurance_syncs set synced_at = synced_at - interval '1 hour' where organization_id = $1`, [f.orgA]); await as(tx, f.users.hrA); };

      expect((await pending()).map((r) => r.change)).toEqual(['addition', 'addition', 'addition']);
      // An employee's own roster key is their id.
      expect((await tx.query<{ r: unknown }>('select lock_insurance_endorsement($1, $2) as r', [f.orgA, [f.employees.icA, f.employees.peerA]])).rows[0]!.r).toEqual({ additions: 2, deletions: 0 });
      expect(await pending()).toEqual([{ change: 'addition', employee_id: f.employees.leadA }]);
      expect((await failure(tx, 'select lock_insurance_endorsement($1, $2)', [f.orgA, [f.employees.icA]])).message).toBe('Choose at least one change for this endorsement.');

      await age();
      await tx.query('update insurance_coverage set covered = false where employee_id = $1', [f.employees.peerA]);
      expect((await tx.query<{ r: unknown }>('select lock_insurance_endorsement($1, $2) as r', [f.orgA, [f.employees.leadA]])).rows[0]!.r).toEqual({ additions: 1, deletions: 0 });
      expect(await pending()).toEqual([{ change: 'deletion', employee_id: f.employees.peerA }]); // left for the next endorsement
      await age();
      expect((await tx.query<{ r: unknown }>('select lock_insurance_endorsement($1) as r', [f.orgA])).rows[0]!.r).toEqual({ additions: 0, deletions: 1 });
      expect(await pending()).toEqual([]);

      const sync = (await tx.query<{ id: string }>('select id from insurance_syncs where organization_id = $1 order by synced_at desc limit 1', [f.orgA])).rows[0]!.id;
      await tx.query(`insert into insurance_cd_entries (organization_id, entry_date, kind, amount, lives, sync_id) values ($1, '2026-05-01', 'endorsement', -4200, 1, $2)`, [f.orgA, sync]);
      await tx.exec('reset role');
      const other = (await tx.query<{ id: string }>(`insert into insurance_syncs (organization_id, roster, additions, deletions) values ($1, '{}', 0, 0) returning id`, [f.orgB])).rows[0]!.id;
      await as(tx, f.users.hrA);
      expect((await failure(tx, `insert into insurance_cd_entries (organization_id, entry_date, kind, amount, sync_id) values ($1, '2026-05-02', 'endorsement', -100, $2)`, [f.orgA, other])).code).toBe('23503');

      await as(tx, f.users.icA);
      const mine = (await tx.query<{ m: { covered: boolean; policy: Record<string, unknown> } }>('select my_insurance($1) as m', [f.orgA])).rows[0]!.m;
      expect(mine.policy.insurer).toBe('Example General Insurance');
      expect(mine.policy).not.toHaveProperty('premium_per_life');
      expect(mine.policy).not.toHaveProperty('cd_low_balance');
    });
  });
});

describe('job feed, learning reminders and vendor TDS', () => {
  it('the feed shows published open jobs with their city to anyone; others stay private', async () => {
    const { f, t } = ctx;
    await t.db.exec('begin');
    try {
      const loc = (await t.db.query<{ id: string }>(`insert into locations (organization_id, code, name, city, state_code) values ($1, 'BLR', 'Bengaluru office', 'Bengaluru', 'KA') returning id`, [f.orgA])).rows[0]!.id;
      await t.db.query(`insert into job_requisitions (organization_id, code, title, location_id, status, is_published, description) values
        ($1, 'R-10', 'Backend engineer', $2, 'open', true, 'Build APIs.'), ($1, 'R-11', 'Secret role', $2, 'open', false, 'Hush.')`, [f.orgA, loc]);
      await t.db.exec('commit');
      const feed = await ctx.t.asAnon((tx) => tx.query<{ title: string; city: string; state_code: string }>(`select title, city, state_code from public_job_feed('demo-a')`));
      expect(feed.rows).toEqual([{ title: 'Backend engineer', city: 'Bengaluru', state_code: 'KA' }]);
    } finally {
      await t.db.exec('rollback').catch(() => undefined);
      await t.db.query(`delete from job_requisitions where organization_id = $1 and code in ('R-10', 'R-11')`, [f.orgA]);
      await t.db.query(`delete from locations where organization_id = $1 and code = 'BLR'`, [f.orgA]);
    }
  });

  it('HR reminds a course’s pending learners at most once a day; vendor TDS shows in the compliance facts', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.exec('reset role');
      const course = (await tx.query<{ id: string }>(`insert into courses (organization_id, title) values ($1, 'Information security basics') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`insert into course_enrollments (organization_id, course_id, employee_id, source, due_on, status) values
        ($1, $2, $3, 'assigned', current_date - 3, 'assigned'), ($1, $2, $4, 'assigned', current_date + 10, 'in_progress'), ($1, $2, $5, 'assigned', null, 'assigned')`,
        [f.orgA, course, f.employees.icA, f.employees.peerA, f.employees.leadA]);
      await as(tx, f.users.hrA);
      expect((await tx.query<{ n: number }>('select remind_learners($1, true) as n', [course])).rows[0]!.n).toBe(1);
      expect((await tx.query<{ n: number }>('select remind_learners($1) as n', [course])).rows[0]!.n).toBe(2);  // the overdue one was reminded already
      expect((await tx.query<{ n: number }>('select remind_learners($1) as n', [course])).rows[0]!.n).toBe(0);
      await as(tx, f.users.icA);
      expect((await failure(tx, 'select remind_learners($1)', [course])).code).toBe('42501');

      await as(tx, f.users.payrollA);
      expect((await tx.query<{ v: { vendor_tds: boolean } }>('select statutory_facts($1) as v', [f.orgA])).rows[0]!.v.vendor_tds).toBe(false);
      const vendor = (await tx.query<{ id: string }>(`insert into vendors (organization_id, name, tds_section, tds_rate) values ($1, 'Acme Studio', '194J', 10) returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select record_vendor_payment($1, $2, 'INV-1', current_date, 10000)`, [f.orgA, vendor]);
      expect((await tx.query<{ v: { vendor_tds: boolean } }>('select statutory_facts($1) as v', [f.orgA])).rows[0]!.v.vendor_tds).toBe(true);
    });
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query('select statutory_facts($1)', [f.orgA])))).toBe('42501');
  });
});

describe('Konnect reads', () => {
  it('lists threads with authors’ names, searches safely, and keeps hidden posts to their author and moderators', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const general = (await tx.query<{ id: string }>(`select id from konnect_topics where organization_id = $1 and name = 'General'`, [f.orgA])).rows[0]!.id;
      const thread = (await tx.query<{ id: string }>(`insert into konnect_threads (organization_id, topic_id, author_employee_id, title, body) values ($1, $2, $3, 'Team lunch on Friday', '50% off at the canteen') returning id`,
        [f.orgA, general, f.employees.icA])).rows[0]!.id;
      await as(tx, f.users.peerA);
      const list = (await tx.query<{ title: string; author_name: string; mine: boolean }>('select title, author_name, mine from konnect_thread_list($1)', [f.orgA])).rows;
      expect(list).toEqual([{ title: 'Team lunch on Friday', author_name: 'Ishan Demo', mine: false }]);
      expect((await tx.query('select 1 from konnect_thread_list($1, null, $2)', [f.orgA, '50%'])).rows).toHaveLength(1);
      expect((await tx.query('select 1 from konnect_thread_list($1, null, $2)', [f.orgA, '%%%nothing'])).rows).toHaveLength(0);
      const view = (await tx.query<{ v: { title: string; replies: unknown[]; mine: boolean } }>('select konnect_thread_view($1) as v', [thread])).rows[0]!.v;
      expect([view.title, view.replies, view.mine]).toEqual(['Team lunch on Friday', [], false]);
      await as(tx, f.users.hrA);
      await tx.query('update konnect_threads set hidden = true where id = $1', [thread]);
      await as(tx, f.users.peerA);
      expect((await tx.query<{ v: unknown }>('select konnect_thread_view($1) as v', [thread])).rows[0]!.v).toBeNull();
      expect((await tx.query('select 1 from konnect_thread_list($1)', [f.orgA])).rows).toHaveLength(0);
      await as(tx, f.users.ownerB);
      expect((await tx.query<{ v: unknown }>('select konnect_thread_view($1) as v', [thread])).rows[0]!.v).toBeNull();
    });
  });
});
