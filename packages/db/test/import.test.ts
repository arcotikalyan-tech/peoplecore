import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

interface Report { committed: boolean; rows: number; valid: number; errors: Array<{ line: number; message: string }> }

const row = (line: number, extra: Record<string, string> = {}) => ({
  line, first_name: `Imp${line}`, employment_type: 'permanent', date_of_joining: '2026-01-05', ...extra,
});

async function importRows(tx: Transaction, org: string, rows: object[], dryRun: boolean): Promise<Report> {
  const { rows: out } = await tx.query<{ r: Report }>('select import_employees($1, $2, $3) as r', [org, JSON.stringify(rows), dryRun]);
  return out[0]!.r;
}

const count = async (tx: Transaction, org: string, like: string) =>
  (await tx.query<{ n: number }>(`select count(*)::int as n from employees where organization_id = $1 and first_name like $2`, [org, like])).rows[0]!.n;

describe('import_employees', () => {
  it('a dry run validates everything and keeps nothing', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const report = await importRows(tx, f.orgA, [row(2, { department_code: 'eng' }), row(3)], true);
      expect(report).toEqual({ committed: false, rows: 2, valid: 2, errors: [] });
      expect(await count(tx, f.orgA, 'Imp%')).toBe(0);
    });
  });

  it('a real import creates every row, with joining history, and records the import', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const report = await importRows(tx, f.orgA, [
        row(2, { employee_code: 'IMP-1', work_email: 'imp1@example.test', department_code: 'ENG' }),
        row(3, { employee_code: 'IMP-2', manager_code: 'IMP-1' }),   // manager from the same file
        row(4, { manager_code: 'A-001' }),                            // existing manager, auto code
      ], false);
      expect(report).toEqual({ committed: true, rows: 3, valid: 3, errors: [] });

      const { rows } = await tx.query<{ code: string; manager: string | null; dept: string | null; history_manager: string | null }>(
        `select e.employee_code as code, m.employee_code as manager, d.code as dept, rm.employee_code as history_manager
           from employees e
           left join employees m on m.id = e.manager_employee_id
           left join departments d on d.id = e.department_id
           join employment_records r on r.employee_id = e.id and r.change_reason = 'joining'
           left join employees rm on rm.id = r.manager_employee_id
          where e.organization_id = $1 and e.first_name like 'Imp%' order by e.first_name`, [f.orgA]);
      expect(rows).toEqual([
        { code: 'IMP-1', manager: null, dept: 'ENG', history_manager: null },
        { code: 'IMP-2', manager: 'IMP-1', dept: null, history_manager: 'IMP-1' },
        { code: expect.stringMatching(/^EMP\d{5}$/), manager: 'A-001', dept: null, history_manager: 'A-001' },
      ]);
      await tx.exec('reset role');
      const ev = await tx.query<{ metadata: unknown }>(`select metadata from audit_events where action = 'import' and organization_id = $1`, [f.orgA]);
      expect(ev.rows).toEqual([{ metadata: { rows: 3, created: 3 } }]);
    });
  });

  it('one bad row stops the whole import, and every problem is reported by line', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const report = await importRows(tx, f.orgA, [
        row(2),
        row(3, { work_email: 'mira@example.test' }),                       // taken by an existing employee
        row(4, { department_code: 'NOPE' }),
        row(5, { employee_code: 'A-001' }),                                 // code in use
        row(6, { probation_end_date: '2025-12-31' }),                       // before joining
        row(7, { employment_type: 'freelance' }),
        row(8, { manager_code: 'GHOST' }),
        row(9, { work_email: 'dup@example.test' }),
        row(10, { work_email: 'DUP@example.test' }),                        // duplicate inside the file
      ], false);
      expect(report.committed).toBe(false);
      expect(report.valid).toBe(2);
      expect(report.errors).toEqual([
        { line: 3, message: 'Another employee already uses this work email.' },
        { line: 4, message: 'Unknown or archived department code: “NOPE”.' },
        { line: 5, message: 'This employee code is already in use.' },
        { line: 6, message: 'Probation can’t end before the date of joining.' },
        { line: 7, message: 'A value has the wrong format (dates are YYYY-MM-DD).' },
        { line: 8, message: 'Unknown manager code “GHOST”.' },
        { line: 10, message: 'Another employee already uses this work email.' },
      ]);
      expect(await count(tx, f.orgA, 'Imp%')).toBe(0);
    });
  });

  it('refuses archived items and people without employee.create', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      await tx.query(`insert into departments (organization_id, code, name, archived_at) values ($1, 'OLD', 'Old', now())`, [f.orgA]);
      const report = await importRows(tx, f.orgA, [row(2, { department_code: 'OLD' })], true);
      expect(report.errors).toEqual([{ line: 2, message: 'Unknown or archived department code: “OLD”.' }]);
    });
    for (const user of [f.users.managerA, f.users.payrollA, f.users.icA, f.users.ownerB]) {
      expect(await pgError(ctx.t.asUser(user, (tx) => importRows(tx, f.orgA, [row(2)], true)))).toBe('42501');
    }
  });

  it('rejects empty and oversized files', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => importRows(tx, f.orgA, [], true)))).toBe('22023');
    const many = Array.from({ length: 2001 }, (_, i) => row(i + 2));
    expect(await pgError(ctx.t.asUser(f.users.hrA, (tx) => importRows(tx, f.orgA, many, true)))).toBe('22023');
  });
});
