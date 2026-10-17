import { z } from 'zod';
import { parseCsv } from '../csv.ts';
import { fieldErrors } from './common.ts';
import { createEmployeeSchema, EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, type EmploymentType } from './employee.ts';

/**
 * Bulk employee import: the CSV template, header matching and per-row checks of formats. References
 * (department, designation, location, manager) and uniqueness are checked by the database's dry run
 * (import_employees, migration 20261018000700), which has the final say.
 */
export const IMPORT_COLUMNS = [
  { key: 'employee_code', header: 'Employee code', required: false, example: 'EMP-1001' },
  { key: 'first_name', header: 'First name', required: true, example: 'Asha' },
  { key: 'middle_name', header: 'Middle name', required: false, example: '' },
  { key: 'last_name', header: 'Last name', required: false, example: 'Rao' },
  { key: 'work_email', header: 'Work email', required: false, example: 'asha.rao@example.test' },
  { key: 'work_phone', header: 'Work phone', required: false, example: '+91 98765 43210' },
  { key: 'employment_type', header: 'Employment type', required: true, example: 'Permanent' },
  { key: 'date_of_joining', header: 'Date of joining', required: true, example: '2026-01-05' },
  { key: 'probation_end_date', header: 'Probation ends', required: false, example: '2026-07-04' },
  { key: 'department_code', header: 'Department code', required: false, example: 'ENG' },
  { key: 'designation', header: 'Designation', required: false, example: 'Software Engineer' },
  { key: 'location_code', header: 'Location code', required: false, example: 'BLR' },
  { key: 'manager_code', header: 'Manager code', required: false, example: '' },
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number]['key'];
export type ImportRow = { line: number } & Partial<Record<ImportColumn, string>>;
export interface ImportProblem { line: number; message: string }

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_*]+/g, ' ').trim();
const HEADER_KEYS = new Map(IMPORT_COLUMNS.flatMap((c) => [[normalizeHeader(c.header), c.key], [normalizeHeader(c.key), c.key]] as const));

/** Accepts the template's YYYY-MM-DD, and DD/MM/YYYY or DD-MM-YYYY as Indian spreadsheets often write dates. */
export function normalizeImportDate(value: string): string {
  const v = value.trim();
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}` : v;
}

function employmentType(value: string): EmploymentType | string {
  const v = value.trim().toLowerCase();
  return EMPLOYMENT_TYPES.find((t) => t === v || EMPLOYMENT_TYPE_LABELS[t].toLowerCase() === v) ?? value;
}

const LABELS: Record<string, string> = Object.fromEntries([
  ['employeeCode', 'Employee code'], ['firstName', 'First name'], ['middleName', 'Middle name'], ['lastName', 'Last name'],
  ['workEmail', 'Work email'], ['workPhone', 'Work phone'], ['employmentType', 'Employment type'],
  ['dateOfJoining', 'Date of joining'], ['probationEndDate', 'Probation ends'],
]);

/**
 * Reads an import file. Line numbers are the file's (the header is line 1). Returns normalised rows ready for
 * import_employees, plus format problems found before the database is asked.
 */
export function parseImportFile(text: string): { rows: ImportRow[]; problems: ImportProblem[]; fatal?: string } {
  let cells: string[][];
  try {
    cells = parseCsv(text);
  } catch (err) {
    return { rows: [], problems: [], fatal: (err as Error).message };
  }
  const [header, ...body] = cells;
  if (!header) return { rows: [], problems: [], fatal: 'The file is empty.' };
  const keys = header.map((h) => HEADER_KEYS.get(normalizeHeader(h)));
  const unknown = header.filter((_, i) => !keys[i] && header[i]!.trim() !== '');
  if (unknown.length) return { rows: [], problems: [], fatal: `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Use the template.` };
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !keys.includes(c.key)).map((c) => c.header);
  if (missing.length) return { rows: [], problems: [], fatal: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` };
  if (body.length === 0) return { rows: [], problems: [], fatal: 'The file has no rows to import.' };
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], problems: [], fatal: `Import at most ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows at a time.` };

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const seenEmails = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  body.forEach((cellsOfRow, index) => {
    const line = index + 2;
    const raw: Partial<Record<ImportColumn, string>> = {};
    keys.forEach((k, i) => { if (k) raw[k] = (cellsOfRow[i] ?? '').trim(); });

    const parsed = createEmployeeSchema.safeParse({
      employeeCode: raw.employee_code, firstName: raw.first_name, middleName: raw.middle_name, lastName: raw.last_name,
      workEmail: raw.work_email, workPhone: raw.work_phone, employmentType: employmentType(raw.employment_type ?? ''),
      dateOfJoining: normalizeImportDate(raw.date_of_joining ?? ''),
      probationEndDate: raw.probation_end_date ? normalizeImportDate(raw.probation_end_date) : '',
    });
    if (!parsed.success) {
      for (const [field, message] of Object.entries(fieldErrors(parsed.error))) {
        problems.push({ line, message: `${LABELS[field] ?? field}: ${message}` });
      }
      return;
    }
    const v = parsed.data;
    if (v.workEmail) {
      const first = seenEmails.get(v.workEmail);
      if (first) { problems.push({ line, message: `Work email: also on line ${first}` }); return; }
      seenEmails.set(v.workEmail, line);
    }
    if (v.employeeCode) {
      const first = seenCodes.get(v.employeeCode);
      if (first) { problems.push({ line, message: `Employee code: also on line ${first}` }); return; }
      seenCodes.set(v.employeeCode, line);
    }
    rows.push({
      line,
      employee_code: v.employeeCode, first_name: v.firstName, middle_name: v.middleName, last_name: v.lastName,
      work_email: v.workEmail, work_phone: v.workPhone, employment_type: v.employmentType,
      date_of_joining: v.dateOfJoining, probation_end_date: v.probationEndDate,
      department_code: raw.department_code || undefined, designation: raw.designation || undefined,
      location_code: raw.location_code || undefined, manager_code: raw.manager_code || undefined,
    });
  });
  return { rows, problems };
}

/** Result of import_employees, as returned by the database. */
export const importReportSchema = z.object({
  committed: z.boolean(),
  rows: z.number(),
  valid: z.number(),
  errors: z.array(z.object({ line: z.number(), message: z.string() })),
});
export type ImportReport = z.infer<typeof importReportSchema>;
