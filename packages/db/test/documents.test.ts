import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

const add = (tx: Transaction, employee: string, id = randomUUID(), title = 'Offer letter') =>
  tx.query<{ path: string }>(
    `select add_employee_document($1, $2, 'contract', $3, 'offer.pdf', 'application/pdf', 1024) as path`,
    [employee, id, title]);

/** Adds a document as HR (committed), so later transactions as other users can see it. */
async function seedDocument(employee: string): Promise<string> {
  const id = randomUUID();
  await ctx.t.db.query(
    `insert into employee_documents (id, organization_id, employee_id, category, title, file_name, content_type, size_bytes, storage_path)
     select $1::uuid, organization_id, id, 'identity', 'PAN card', 'pan.png', 'image/png', 2048, organization_id || '/' || id || '/' || $1::text
       from employees where id = $2`,
    [id, employee]);
  return id;
}

describe('employee documents', () => {
  it('HR adds documents for anyone in the org; the path is fixed by org, employee and id', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = randomUUID();
      const { rows } = await add(tx, f.employees.icA, id);
      expect(rows[0]!.path).toBe(`${f.orgA}/${f.employees.icA}/${id}`);
      const audit = await tx.query<{ action: string; employee: string }>(
        `select action, metadata->>'employee_id' as employee from audit_events where entity_id = $1`, [id]);
      expect(audit.rows).toEqual([{ action: 'insert', employee: f.employees.icA }]);
    });
  });

  it('employees add their own, but not a colleague’s; managers and payroll cannot add', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.icA, (tx) => add(tx, f.employees.icA));
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => add(tx, f.employees.peerA)))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) => add(tx, f.employees.icA)))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.payrollA, (tx) => add(tx, f.employees.icA)))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.ownerB, (tx) => add(tx, f.employees.icA)))).toBe('42501');
  });

  it('cannot be written directly, even by HR', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.icA);
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) =>
      tx.query(`update employee_documents set title = 'x' where id = $1`, [id])))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) =>
      tx.query(`delete from employee_documents where id = $1`, [id])))).toBe('42501');
  });

  it('are visible to HR and the employee, not to managers, colleagues, payroll or other orgs', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.icA);
    const sees = (user: string) => ctx.t.asUser(user, async (tx) =>
      (await tx.query('select 1 from employee_documents where id = $1', [id])).rows.length === 1);
    expect(await sees(f.users.hrA)).toBe(true);
    expect(await sees(f.users.ownerA)).toBe(true);
    expect(await sees(f.users.icA)).toBe(true);
    for (const user of [f.users.leadA, f.users.managerA, f.users.peerA, f.users.payrollA, f.users.auditorA, f.users.ownerB]) {
      expect(await sees(user)).toBe(false);
    }
  });

  it('HR with a password alone (no two-step) sees none', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.peerA);
    const rows = await ctx.t.asUser(f.users.hrA, async (tx) =>
      (await tx.query('select 1 from employee_documents where id = $1', [id])).rows, { aal: 'aal1' });
    expect(rows).toHaveLength(0);
  });
});

describe('document_download', () => {
  it('returns what the server needs to sign a link, and audits the download', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.icA);
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const { rows } = await tx.query<{ storage_path: string; file_name: string }>(
        'select storage_path, file_name from document_download($1)', [id]);
      expect(rows[0]).toEqual({ storage_path: `${f.orgA}/${f.employees.icA}/${id}`, file_name: 'pan.png' });
      await tx.exec('reset role'); // employees can't read the audit log; check it as the database owner
      const audit = await tx.query<{ actor: string }>(
        `select actor_user_id as actor from audit_events where entity_id = $1 and action = 'download'`, [id]);
      expect(audit.rows).toEqual([{ actor: f.users.icA }]);
    });
  });

  it('refuses others the same way whether or not the document exists', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.icA);
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) => tx.query('select * from document_download($1)', [id])))).toBe('42501');
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) => tx.query('select * from document_download($1)', [randomUUID()])))).toBe('42501');
  });
});

describe('delete_employee_document', () => {
  it('HR deletes: the row stays (hidden) for the audit trail, and can no longer be downloaded', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.icA);
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const { rows } = await tx.query<{ path: string }>('select delete_employee_document($1) as path', [id]);
      expect(rows[0]!.path).toBe(`${f.orgA}/${f.employees.icA}/${id}`);
      expect((await tx.query('select 1 from employee_documents where id = $1', [id])).rows).toHaveLength(0);
      const audit = await tx.query<{ to: string | null }>(
        `select changes->'deleted_at'->>'to' as to from audit_events where entity_id = $1 and action = 'update'`, [id]);
      expect(audit.rows[0]!.to).not.toBeNull();
      expect(await pgError(tx.query('select * from document_download($1)', [id]))).toBe('42501');
    });
  });

  it('employees cannot delete, not even their own', async () => {
    const { f } = ctx;
    const id = await seedDocument(f.employees.icA);
    expect(await pgError(ctx.t.asUser(f.users.icA, (tx) => tx.query('select delete_employee_document($1)', [id])))).toBe('42501');
  });
});

describe('employee-documents bucket', () => {
  it('is private, with the same limits as the table', async () => {
    const { rows } = await ctx.t.db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'employee-documents'`);
    expect(rows).toEqual([{ public: false, file_size_limit: '5242880', allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png'] }]);
  });
});
