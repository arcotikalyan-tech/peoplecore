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

const SHA = 'a'.repeat(64);
const file = (tx: Transaction, caseId: string, id: string, internal = false) =>
  tx.query(`select add_grievance_file($1, $2, 'note.pdf', 'application/pdf', 1200, $3, $4)`, [caseId, id, SHA, internal]);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('anonymous grievances', () => {
  it('keep the reporter’s name from everyone handling the case, including the audit log', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await as(tx, f.users.icA);
      expect((await failure(tx, `select raise_grievance($1, 'posh', 'Comments', 'Unwelcome comments in every team meeting.', null, null, true)`, [f.orgA])).message)
        .toMatch(/^A POSH complaint can’t be anonymous/);
      const id = (await tx.query<{ id: string }>(
        `select raise_grievance($1, 'ethics', 'Expense padding', 'A team lead pads travel claims every month with fake taxi bills.', null, $2, true) as id`,
        [f.orgA, [f.employees.leadA]])).rows[0]!.id;
      // The reporter follows their own case as before.
      expect((await tx.query<{ my_role: string; reporter_name: string; anonymous: boolean }>('select my_role, reporter_name, anonymous from grievance_case($1)', [id])).rows[0])
        .toEqual({ my_role: 'reporter', reporter_name: 'Ishan Demo', anonymous: true });
      expect((await tx.query<{ mine: boolean; anonymous: boolean }>('select mine, anonymous from grievance_list($1)', [f.orgA])).rows).toEqual([{ mine: true, anonymous: true }]);
      await tx.query(`select add_grievance_note($1, 'It happened again on the Pune trip.')`, [id]);
      await file(tx, id, uuid(1));
      expect((await failure(tx, 'select reporter_id from grievances')).code).toBe('42501'); // nobody reads it from the table

      await as(tx, f.users.hrA); // case manager
      expect(await tx.query<{ n: string }>(`select count(*) as n from notifications where kind = 'grievance.new' and title like 'New anonymous grievance case #%'`)
        .then((r) => Number(r.rows[0]!.n))).toBe(1);
      expect((await tx.query('select * from grievance_case($1)', [id])).rows[0]).toMatchObject({ my_role: 'manager', reporter_id: null, reporter_name: 'Anonymous', anonymous: true });
      expect((await tx.query<{ mine: boolean }>('select mine from grievance_list($1)', [f.orgA])).rows).toEqual([{ mine: false }]);
      expect((await tx.query<{ author_name: string }>('select author_name from grievance_thread($1)', [id])).rows.map((r) => r.author_name)).toEqual(['Person who raised it']);
      expect((await tx.query<{ uploader_name: string }>('select uploader_name from grievance_files($1)', [id])).rows.map((r) => r.uploader_name)).toEqual(['Person who raised it']);
      expect((await failure(tx, 'select uploaded_by from grievance_files')).code).toBe('42501');
      // Refusals that would say who raised it don't apply: the reporter keeps the reporter's view.
      await tx.query('select add_grievance_respondent($1, $2)', [id, f.employees.icA]);
      await tx.query(`select add_grievance_note($1, 'Checking the claims with finance.', true)`, [id]);

      await as(tx, f.users.icA);
      expect((await tx.query<{ my_role: string }>('select my_role from grievance_case($1)', [id])).rows[0]!.my_role).toBe('reporter');
      expect((await tx.query<{ internal: boolean }>('select internal from grievance_thread($1)', [id])).rows.every((r) => !r.internal)).toBe(true);
      await tx.query(`select withdraw_grievance($1, 'I would rather drop it.')`, [id]);

      await as(tx, f.users.ownerA); // the audit log: the reporter's actions carry no actor, the handler's do
      const trail = (await tx.query<{ entity_type: string; action: string; actor_user_id: string | null }>(
        `select entity_type, action, actor_user_id from audit_events
          where (entity_type = 'grievances' and entity_id = $1)
             or (entity_type in ('grievance_notes', 'grievance_files', 'grievance_respondents') and changes ->> 'grievance_id' = $1::text)
          order by id`, [id])).rows;
      const actors = new Set(trail.map((r) => r.actor_user_id));
      expect(actors.has(f.users.icA)).toBe(false);
      expect(actors.has(null)).toBe(true);
      expect(actors.has(f.users.hrA)).toBe(true);
      expect(trail.filter((r) => r.actor_user_id === null).map((r) => `${r.entity_type}:${r.action}`).sort())
        .toEqual(['grievance_files:insert', 'grievance_notes:insert', 'grievance_notes:insert', 'grievances:insert', 'grievances:update', 'grievance_respondents:insert'].sort());
    });
  });

  it('a case raised in confidence still shows who raised it, and the audit log records them', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await as(tx, f.users.icA);
      const id = (await tx.query<{ id: string }>(
        `select raise_grievance($1, 'pay', 'Overtime not paid', 'My overtime for August has not been paid yet.') as id`, [f.orgA])).rows[0]!.id;
      await as(tx, f.users.hrA);
      expect((await tx.query('select reporter_name, anonymous from grievance_case($1)', [id])).rows[0]).toEqual({ reporter_name: 'Ishan Demo', anonymous: false });
      expect((await failure(tx, 'select set_grievance_access($1, $2, true)', [id, f.users.icA])).message).toBe('The person who raised it can’t investigate it.');
      await as(tx, f.users.ownerA);
      expect((await tx.query<{ actor_user_id: string }>(`select actor_user_id from audit_events where entity_type = 'grievances' and entity_id = $1 and action = 'insert'`, [id])).rows)
        .toEqual([{ actor_user_id: f.users.icA }]);
    });
  });
});

describe('files on grievances', () => {
  it('follow the case’s rules: handlers’ internal files stay internal, ten at most, closed cases take none, downloads are audited', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, async (tx) => {
      await as(tx, f.users.icA);
      const id = (await tx.query<{ id: string }>(
        `select raise_grievance($1, 'safety', 'Blocked fire exit', 'The fire exit on floor 3 has been blocked with boxes for weeks.') as id`, [f.orgA])).rows[0]!.id;
      await file(tx, id, uuid(11));
      expect((await failure(tx, `select add_grievance_file($1, $2, 'x.pdf', 'application/pdf', 10, $3, true)`, [id, uuid(12), SHA])).code).toBe('42501');

      await as(tx, f.users.hrA);
      await file(tx, id, uuid(13), true);
      expect((await tx.query<{ name: string; internal: boolean }>('select name, internal from grievance_files($1)', [id])).rows).toHaveLength(2);
      expect((await tx.query<{ path: string }>('select path from grievance_file($1)', [uuid(13)])).rows[0]!.path).toBe(`${f.orgA}/${id}/${uuid(13)}`);
      for (let i = 0; i < 8; i++) await file(tx, id, uuid(20 + i));
      expect((await failure(tx, `select add_grievance_file($1, $2, 'x.pdf', 'application/pdf', 10, $3)`, [id, uuid(40), SHA])).message).toBe('A case can have up to ten files.');
      expect(await tx.query<{ path: string }>('select remove_grievance_file($1) as path', [uuid(20)]).then((r) => r.rows[0]!.path)).toBe(`${f.orgA}/${id}/${uuid(20)}`);

      await as(tx, f.users.icA);
      const mine = (await tx.query<{ id: string }>('select id from grievance_files($1)', [id])).rows.map((r) => r.id);
      expect(mine).toContain(uuid(11));
      expect(mine).not.toContain(uuid(13));
      expect((await tx.query('select * from grievance_file($1)', [uuid(13)])).rows).toHaveLength(0);
      expect((await tx.query('select id from grievance_files where id = $1', [uuid(13)])).rows).toHaveLength(0);
      expect((await failure(tx, 'select remove_grievance_file($1)', [uuid(21)])).code).toBe('42501'); // not theirs

      for (const user of [f.users.leadA, f.users.peerA, f.users.employeeB]) {
        await as(tx, user);
        expect((await tx.query('select * from grievance_files($1)', [id])).rows, user).toHaveLength(0);
        expect((await tx.query('select * from grievance_file($1)', [uuid(11)])).rows, user).toHaveLength(0);
        expect((await failure(tx, `select add_grievance_file($1, $2, 'x.pdf', 'application/pdf', 10, $3)`, [id, uuid(41), SHA])).code, user).toBe('42501');
        expect((await failure(tx, 'select remove_grievance_file($1)', [uuid(11)])).code, user).toBe('42501');
      }

      await as(tx, f.users.hrA);
      await tx.query(`select update_grievance($1, 'closed', 'The exit was cleared and checked.')`, [id]);
      expect((await failure(tx, `select add_grievance_file($1, $2, 'x.pdf', 'application/pdf', 10, $3)`, [id, uuid(42), SHA])).message).toBe('This case is closed.');
      await as(tx, f.users.ownerA);
      expect((await tx.query<{ actor_user_id: string }>(`select actor_user_id from audit_events where entity_type = 'grievance_files' and action = 'download' and entity_id = $1`, [uuid(13)])).rows)
        .toEqual([{ actor_user_id: f.users.hrA }]);
    });
  });
});
