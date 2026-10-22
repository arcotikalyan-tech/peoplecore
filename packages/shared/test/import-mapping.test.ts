import { describe, expect, it } from 'vitest';
import { applyImportMapping, detectSource, looseDate, looseEmploymentType, parseCsv, parseImportFile, splitName, suggestMapping, toPlainCsv } from '../src/index.ts';

describe('employee import mapping', () => {
  it('recognises Zoho People, greytHR and Keka exports and maps their columns', () => {
    const zoho = ['Employee ID', 'First Name', 'Last Name', 'Email address', 'Department', 'Designation', 'Location', 'Reporting To', 'Date of joining', 'Employee Type'];
    expect(detectSource(zoho)).toBe('zoho');
    expect(suggestMapping(zoho)).toEqual(['employee_code', 'first_name', 'last_name', 'work_email', 'department', 'designation', 'location', 'manager', 'date_of_joining', 'employment_type']);
    const greyt = ['Employee No', 'Name', 'DOJ', 'Department', 'Designation', 'Location', 'Email', 'Mobile No', 'Category'];
    expect(detectSource(greyt)).toBe('greythr');
    expect(suggestMapping(greyt)).toEqual(['employee_code', 'full_name', 'date_of_joining', 'department', 'designation', 'location', 'work_email', 'work_phone', 'employment_type']);
    const keka = ['Employee Number', 'Display Name', 'First Name', 'Last Name', 'Work Email', 'Date Joined', 'Job Title', 'Worker Type', 'Reporting Manager Employee Number', 'Notes'];
    expect(detectSource(keka)).toBe('keka');
    // Display name is left out when first and last names are there; unknown columns are skipped.
    expect(suggestMapping(keka)).toEqual(['employee_code', '', 'first_name', 'last_name', 'work_email', 'date_of_joining', 'designation', 'employment_type', 'manager', '']);
    expect(detectSource(['Foo', 'Bar'])).toBeNull();
  });

  it('reads spreadsheet dates, employment types and full names', () => {
    expect([looseDate('46027'), looseDate('05-Jan-2026'), looseDate('Jan 5, 2026'), looseDate('5 January 2026'), looseDate('2026/01/05'), looseDate('05/01/2026')])
      .toEqual(['2026-01-05', '2026-01-05', '2026-01-05', '2026-01-05', '2026-01-05', '05/01/2026']);
    expect(['Full Time', 'Regular', 'Contractual', 'Trainee', 'Part-time', 'Freelancer', 'Intern', 'Something'].map(looseEmploymentType))
      .toEqual(['permanent', 'permanent', 'contract', 'intern', 'temporary', 'consultant', 'intern', 'Something']);
    expect(splitName('Asha Devi Rao')).toEqual({ first: 'Asha', middle: 'Devi', last: 'Rao' });
    expect(splitName('Madonna')).toEqual({ first: 'Madonna', middle: '', last: '' });
  });

  it('turns a greytHR export into template rows the usual checks accept', () => {
    const table = [
      ['Employee No', 'Name', 'DOJ', 'Department', 'Email', 'Category', 'Reporting Manager', 'Mobile No'],
      ['G-101', 'Asha Devi Rao', '05-Jan-2026', 'Engineering', 'asha.rao@example.test', 'Full Time', '', '+91 98765 43210'],
      ['G-102', 'Ravi Kumar', '46030', 'Engineering', 'ravi.kumar@example.test', 'Trainee', 'Asha Devi Rao (G-101)', ''],
    ];
    const mapped = applyImportMapping(table, suggestMapping(table[0]!), {
      department: (v) => (v === 'Engineering' ? 'ENG' : v),
      manager: (v) => /\(([^)]+)\)\s*$/.exec(v)?.[1] ?? v,
    });
    const parsed = parseImportFile(toPlainCsv([mapped.header, ...mapped.rows]));
    expect(parsed.fatal).toBeUndefined();
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.map((r) => [r.employee_code, r.first_name, r.middle_name, r.last_name, r.employment_type, r.date_of_joining, r.department_code, r.manager_code, r.work_phone]))
      .toEqual([
        ['G-101', 'Asha', 'Devi', 'Rao', 'permanent', '2026-01-05', 'ENG', undefined, '+919876543210'],
        ['G-102', 'Ravi', undefined, 'Kumar', 'intern', '2026-01-08', 'ENG', 'G-101', undefined],
      ]);
    expect(parseCsv(toPlainCsv([['a,b', 'say "hi"', '-5']]))).toEqual([['a,b', 'say "hi"', '-5']]);
  });
});
