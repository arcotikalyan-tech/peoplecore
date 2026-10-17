import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS, normalizeImportDate, parseCsv, parseImportFile, toCsv } from '../src/index.ts';

const header = IMPORT_COLUMNS.map((c) => c.header).join(',');

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, CRLF and a BOM, and skips blank lines', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",2\n')).toEqual([
      ['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', '2'],
    ]);
  });

  it('round-trips what toCsv writes', () => {
    const rows = [['Rao, Asha', 'line\nbreak', '"quoted"']];
    expect(parseCsv(toCsv(['a', 'b', 'c'], rows)).slice(1)).toEqual(rows);
  });

  it('refuses an unclosed quote', () => {
    expect(() => parseCsv('a\n"open')).toThrow('The file has an unclosed quote.');
  });
});

describe('normalizeImportDate', () => {
  it('accepts ISO and Indian day-first dates', () => {
    expect(normalizeImportDate('2026-01-05')).toBe('2026-01-05');
    expect(normalizeImportDate('5/1/2026')).toBe('2026-01-05');
    expect(normalizeImportDate('05-01-2026')).toBe('2026-01-05');
  });
});

describe('parseImportFile', () => {
  it('normalises rows and numbers them by file line', () => {
    const csv = `${header}\nEMP-1, Asha ,,Rao,Asha.Rao@Example.TEST,+91 98765 43210,permanent,05/01/2026,,eng,Engineer,BLR,`;
    const { rows, problems, fatal } = parseImportFile(csv);
    expect(fatal).toBeUndefined();
    expect(problems).toEqual([]);
    expect(rows).toEqual([{
      line: 2, employee_code: 'EMP-1', first_name: 'Asha', middle_name: undefined, last_name: 'Rao',
      work_email: 'asha.rao@example.test', work_phone: '+919876543210', employment_type: 'permanent',
      date_of_joining: '2026-01-05', probation_end_date: undefined,
      department_code: 'eng', designation: 'Engineer', location_code: 'BLR', manager_code: undefined,
    }]);
  });

  it('accepts columns in any order, by header or key, and labels for employment type', () => {
    const { rows } = parseImportFile('date_of_joining,First name,Employment type\n2026-02-01,Ravi,Contract');
    expect(rows[0]).toMatchObject({ line: 2, first_name: 'Ravi', employment_type: 'contract', date_of_joining: '2026-02-01' });
  });

  it('reports format problems and duplicates inside the file, by line', () => {
    const csv = [
      'First name,Employment type,Date of joining,Work email',
      ',permanent,2026-01-05,',
      'Ravi,freelance,2026-02-30,',
      'Uma,intern,2026-01-05,uma@example.test',
      'Uma,intern,2026-01-05,UMA@example.test',
    ].join('\n');
    const { rows, problems } = parseImportFile(csv);
    expect(rows.map((r) => r.line)).toEqual([4]);
    expect(problems).toEqual([
      { line: 2, message: 'First name: First name is required' },
      { line: 3, message: 'Employment type: Choose an employment type' },
      { line: 3, message: 'Date of joining: Enter a valid date (YYYY-MM-DD)' },
      { line: 5, message: 'Work email: also on line 4' },
    ]);
  });

  it('refuses unknown or missing columns, empty files and too many rows', () => {
    expect(parseImportFile('First name,Salary\nA,1').fatal).toBe('Unknown column: Salary. Use the template.');
    expect(parseImportFile('First name\nA').fatal).toBe('Missing columns: Employment type, Date of joining.');
    expect(parseImportFile(header).fatal).toBe('The file has no rows to import.');
    expect(parseImportFile('').fatal).toBe('The file is empty.');
    const many = [header, ...Array.from({ length: 2001 }, () => 'A,,,,,,permanent,2026-01-05,,,,,')].join('\n');
    expect(parseImportFile(many).fatal).toBe('Import at most 2,000 rows at a time.');
  });
});
