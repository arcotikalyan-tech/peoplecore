import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

/** Runs a statement that must fail, inside a savepoint so the test's transaction carries on. */
async function refused(tx: Transaction, sql: string, params: unknown[], pattern: RegExp) {
  await tx.exec('savepoint expect_failure');
  try {
    await expect(tx.query(sql, params)).rejects.toThrow(pattern);
  } finally {
    await tx.exec('rollback to savepoint expect_failure');
  }
}

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

describe('policy drafts: only people who manage policies see them', () => {
  it('HR writes, edits and deletes drafts; employees and other organizations see none', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const drafts = async () => (await tx.query<{ title: string }>('select title from policy_drafts order by title')).rows.map((r) => r.title);

      await as(tx, f.users.hrA);
      await tx.query(`insert into policy_drafts (organization_id, title, body, source) values ($1, 'Code of conduct', 'Be kind to one another, always.', 'starter')`, [f.orgA]);
      await tx.query(`update policy_drafts set body = 'Be kind to one another, always and everywhere.' where organization_id = $1 and title = 'Code of conduct'`, [f.orgA]);
      expect(await drafts()).toEqual(['Code of conduct']);
      // One draft per title in an organization.
      await refused(tx, `insert into policy_drafts (organization_id, title, body) values ($1, 'Code of conduct', 'A second draft of it.')`, [f.orgA], /duplicate|unique/i);

      await as(tx, f.users.icA); // an employee of the same organization
      expect(await drafts()).toEqual([]);
      await refused(tx, `insert into policy_drafts (organization_id, title, body) values ($1, 'Sneaky', 'Not allowed to draft.')`, [f.orgA], /row-level security/i);
      expect((await tx.query(`delete from policy_drafts where organization_id = $1 returning id`, [f.orgA])).rows).toEqual([]);

      await as(tx, f.users.ownerB); // another organization's owner
      expect(await drafts()).toEqual([]);

      await as(tx, f.users.hrA);
      expect((await tx.query(`delete from policy_drafts where organization_id = $1 returning id`, [f.orgA])).rows).toHaveLength(1);
      expect(await drafts()).toEqual([]);
      // Drafts never reach what employees read.
      expect((await tx.query(`select 1 from policy_documents where organization_id = $1 and title = 'Code of conduct'`, [f.orgA])).rows).toEqual([]);
    });
  });
});
