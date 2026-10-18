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

const begin = async (tx: Transaction, org: string, agent = 'policy_assistant', permission: string | null = null) =>
  (await tx.query<{ id: string }>('select ai_begin_run($1, $2, $3) as id', [org, agent, permission])).rows[0]!.id;
const finish = (tx: Transaction, run: string, tokens = 100, status = 'succeeded') =>
  tx.query(`select ai_finish_run($1, $2, 'claude-test', 'policy_assistant/1.0.0', $3, 0, 900, '{"email":1}', '{"q":"redacted"}', '{"a":1}', null)`, [run, status, tokens]);
const turnOn = (tx: Transaction, org: string, budget = 2000000, hourly = 30) =>
  tx.query('select save_ai_settings($1, true, $2, $3)', [org, budget, hourly]);

describe('AI gate, runs and suggestions', () => {
  it('AI is off until the owner turns it on; only ai.use holders get through the gate', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      expect((await failure(tx, 'select ai_begin_run($1, $2)', [f.orgA, 'policy_assistant'])).message).toBe('AI assistants are turned off for this organization.');
      expect((await failure(tx, 'select save_ai_settings($1, true, 100000, 10)', [f.orgA])).code).toBe('42501');
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select save_ai_settings($1, true, 100000, 10)', [f.orgA])).code).toBe('42501'); // owner only
      await as(tx, f.users.ownerA);
      expect((await failure(tx, 'select save_ai_settings($1, true, 10, 10)', [f.orgA])).message).toBe('Choose a monthly budget between 1,000 and 1,000,000,000 tokens.');
      await turnOn(tx, f.orgA);
      expect((await tx.query<{ action: string }>(`select action from audit_events where entity_type = 'ai_settings'`)).rows).toEqual([{ action: 'insert' }]);

      await as(tx, f.users.icA);
      expect((await tx.query('select enabled from ai_settings')).rows).toEqual([{ enabled: true }]);
      const run = await begin(tx, f.orgA);
      expect(run).toMatch(/^[0-9a-f-]{36}$/);
      await as(tx, f.users.auditorA); // the auditor role has no ai.use
      expect((await failure(tx, 'select ai_begin_run($1, $2)', [f.orgA, 'policy_assistant'])).code).toBe('42501');
      await as(tx, f.users.employeeB); // another organization
      expect((await failure(tx, 'select ai_begin_run($1, $2)', [f.orgA, 'policy_assistant'])).code).toBe('42501');
      expect((await tx.query('select * from ai_settings')).rows).toEqual([]);
      await as(tx, f.users.icA); // an agent's module permission is checked too
      expect((await failure(tx, 'select ai_begin_run($1, $2, $3)', [f.orgA, 'resume_extraction', 'recruitment.manage'])).code).toBe('42501');
      await as(tx, f.users.recruiterA);
      await begin(tx, f.orgA, 'resume_extraction', 'recruitment.manage');
    });
  });

  it('a run is closed once by its own user; runs are private to their user and the AI managers; prompts are not readable', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await turnOn(tx, f.orgA);
      await as(tx, f.users.icA);
      const run = await begin(tx, f.orgA);
      await as(tx, f.users.peerA);
      expect((await failure(tx, `select ai_finish_run($1, 'succeeded', 'm', 'v', 1, 1, 1, '{}', null, null, null)`, [run])).code).toBe('42501');
      await as(tx, f.users.icA);
      await finish(tx, run);
      expect((await failure(tx, `select ai_finish_run($1, 'succeeded', 'm', 'v', 1, 1, 1, '{}', null, null, null)`, [run])).code).toBe('42501'); // once
      expect((await tx.query('select agent, status, model, input_tokens, redactions, latency_ms from ai_runs')).rows)
        .toEqual([{ agent: 'policy_assistant', status: 'succeeded', model: 'claude-test', input_tokens: 100, redactions: { email: 1 }, latency_ms: 900 }]);
      expect((await failure(tx, 'select request from ai_runs')).code).toBe('42501');
      expect((await failure(tx, 'select response from ai_runs')).code).toBe('42501');
      expect((await failure(tx, `update ai_runs set input_tokens = 0`)).code).toBe('42501');
      await tx.query(`select rate_ai_run($1, false, 'Missed the point')`, [run]);

      for (const [user, sees] of [[f.users.peerA, 0], [f.users.managerA, 0], [f.users.hrA, 0], [f.users.ownerA, 1], [f.users.ownerB, 0]] as const) {
        await as(tx, user);
        expect((await tx.query('select 1 from ai_runs')).rows.length, user).toBe(sees);
        if (user !== f.users.ownerA) expect((await failure(tx, `select rate_ai_run($1, true)`, [run])).code).toBe('42501');
      }
      await as(tx, f.users.ownerA);
      expect((await tx.query('select agent, runs, failed, tokens, helpful, not_helpful, users from ai_usage($1)', [f.orgA])).rows)
        .toEqual([{ agent: 'policy_assistant', runs: 1, failed: 0, tokens: 100, helpful: 0, not_helpful: 1, users: 1 }]);
      await as(tx, f.users.hrA);
      expect((await failure(tx, 'select * from ai_usage($1)', [f.orgA])).code).toBe('42501');
    });
  });

  it('enforces the hourly limit per user and the monthly budget per organization', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await turnOn(tx, f.orgA, 1000, 2);
      await as(tx, f.users.icA);
      await finish(tx, await begin(tx, f.orgA), 10);
      await finish(tx, await begin(tx, f.orgA), 10);
      expect((await failure(tx, 'select ai_begin_run($1, $2)', [f.orgA, 'policy_assistant'])).message).toBe('You’ve reached the hourly limit for AI requests. Try again later.');
      await as(tx, f.users.peerA); // the limit is per person
      await finish(tx, await begin(tx, f.orgA), 980); // the organization has now used 1,000 tokens
      await as(tx, f.users.leadA);
      expect((await failure(tx, 'select ai_begin_run($1, $2)', [f.orgA, 'policy_assistant'])).message).toBe('This organization has used its AI allowance for the month.');
      await as(tx, f.users.ownerB); // another organization has its own budget
      await turnOn(tx, f.orgB);
      await begin(tx, f.orgB);
    });
  });

  it('suggestions belong to the person who asked, and are decided once', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await turnOn(tx, f.orgA);
      await as(tx, f.users.recruiterA);
      const open = await begin(tx, f.orgA, 'resume_extraction', 'recruitment.manage');
      expect((await failure(tx, `select ai_save_suggestion($1, 'candidate', null, '{}')`, [open])).code).toBe('42501'); // not finished yet
      await finish(tx, open);
      const s = (await tx.query<{ id: string }>(`select ai_save_suggestion($1, 'candidate', null, '{"firstName":"Asha"}') as id`, [open])).rows[0]!.id;
      expect((await tx.query('select agent, subject_kind, status, payload from ai_suggestions')).rows)
        .toEqual([{ agent: 'resume_extraction', subject_kind: 'candidate', status: 'proposed', payload: { firstName: 'Asha' } }]);
      expect((await failure(tx, `update ai_suggestions set status = 'accepted'`)).code).toBe('42501');

      for (const user of [f.users.hrA, f.users.ownerA, f.users.icA]) {
        await as(tx, user);
        expect((await tx.query('select 1 from ai_suggestions')).rows).toEqual([]);
        expect((await failure(tx, `select decide_ai_suggestion($1, 'rejected')`, [s])).message).toBe('This suggestion was already used or dismissed.');
        expect((await failure(tx, `select ai_save_suggestion($1, 'candidate', null, '{}')`, [open])).code).toBe('42501');
      }
      await as(tx, f.users.recruiterA);
      const candidate = '00000000-0000-4000-8000-000000000001';
      await tx.query(`select decide_ai_suggestion($1, 'edited', $2)`, [s, candidate]);
      expect((await tx.query('select status, subject_id from ai_suggestions')).rows).toEqual([{ status: 'edited', subject_id: candidate }]);
      expect((await failure(tx, `select decide_ai_suggestion($1, 'accepted')`, [s])).message).toBe('This suggestion was already used or dismissed.');
    });
  });

  it('knowledge search runs as the caller: published articles and current policies of their own organization only', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into kb_articles (organization_id, title, body, published) values
        ($1, 'Work from home', 'You can work from home two days a week with your manager''s agreement.', true),
        ($1, 'Draft: sabbatical', 'Sabbatical leave of up to six months is being considered for home workers.', false)`, [f.orgA]);
      await tx.exec('reset role');
      await tx.query(`insert into policy_documents (organization_id, title, version, body, published_at, retired_at) values
        ($1, 'Leave policy', 1, 'Casual leave is 10 days a year, and you can work from home on leave days.', now() - interval '2 days', null),
        ($1, 'Leave policy', 2, 'Casual leave is 12 days a year. Earned leave is 18 days.', now() - interval '1 day', null),
        ($1, 'Old remote policy', 1, 'Working from home is not allowed.', now() - interval '9 days', now() - interval '3 days'),
        ($2, 'Other org home policy', 1, 'Org B lets everyone work from home every day.', now(), null)`, [f.orgA, f.orgB]);
      await tx.query(`insert into kb_articles (organization_id, title, body, published) values ($1, 'Org B home office', 'Org B pays for a home office chair.', true)`, [f.orgB]);

      const search = async (q: string) =>
        (await tx.query<{ source_kind: string; title: string }>('select source_kind, title from search_knowledge($1, $2)', [f.orgA, q])).rows;
      for (const user of [f.users.icA, f.users.hrA]) { // HR sees drafts in the table, but the assistant never cites them
        await as(tx, user);
        expect(await search('Can I work from home?')).toEqual([{ source_kind: 'article', title: 'Work from home' }]);
        expect(await search('How many casual leaves do I get?')).toEqual([{ source_kind: 'policy', title: 'Leave policy' }]);
        expect((await tx.query<{ body: string }>('select body from search_knowledge($1, $2)', [f.orgA, 'casual leave'])).rows[0]!.body).toContain('12 days');
        expect(await search('the and what')).toEqual([]);
        expect(await search('')).toEqual([]);
        expect(await search('sabbatical')).toEqual([]);
      }
      await as(tx, f.users.employeeB); // another organization's member gets nothing from org A, even by id
      expect(await search('work from home')).toEqual([]);
      expect((await tx.query<{ title: string }>('select title from search_knowledge($1, $2) order by title', [f.orgB, 'home'])).rows.map((r) => r.title))
        .toEqual(['Org B home office', 'Other org home policy']);
    });
  });

  it('the worker clears prompts and suggestions after 30 days and closes runs that never finished', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.ownerA, async (tx) => {
      await turnOn(tx, f.orgA);
      await as(tx, f.users.recruiterA);
      const old = await begin(tx, f.orgA, 'resume_extraction', 'recruitment.manage');
      await finish(tx, old);
      await tx.query(`select ai_save_suggestion($1, 'candidate', null, '{"firstName":"Asha"}')`, [old]);
      const fresh = await begin(tx, f.orgA);
      await finish(tx, fresh);
      const stuck = await begin(tx, f.orgA);
      await tx.exec('reset role');
      await tx.query(`update ai_runs set created_at = now() - interval '31 days' where id = $1`, [old]);
      await tx.query(`update ai_suggestions set created_at = now() - interval '31 days'`);
      await tx.query(`update ai_runs set created_at = now() - interval '2 hours' where id = $1`, [stuck]);
      await tx.exec('set local role authenticated');
      expect((await failure(tx, 'select worker_ai_retention()')).code).toBe('42501');
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      expect((await tx.query('select worker_ai_retention() as r')).rows[0]).toEqual({ r: { runs_cleared: 1, suggestions_deleted: 1 } });
      await tx.exec('reset role');
      const runs = (await tx.query<{ id: string; status: string; kept: boolean; error: string | null }>(
        'select id, status, request is not null as kept, error from ai_runs')).rows;
      expect(runs.find((r) => r.id === old)).toMatchObject({ status: 'succeeded', kept: false });
      expect(runs.find((r) => r.id === fresh)).toMatchObject({ status: 'succeeded', kept: true });
      expect(runs.find((r) => r.id === stuck)).toMatchObject({ status: 'failed', error: 'Did not finish' });
      expect((await tx.query('select 1 from ai_suggestions')).rows).toEqual([]);
    });
  });
});
