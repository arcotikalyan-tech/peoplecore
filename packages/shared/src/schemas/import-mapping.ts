import { EMPLOYMENT_TYPES, type EmploymentType } from './employee.ts';
import { IMPORT_COLUMNS, type ImportColumn } from './import.ts';

/**
 * Column mapping for employee imports: any spreadsheet (PeopleCore's template, or an export from Zoho People, GreytHR or
 * Keka) is mapped column by column onto the template, then checked exactly like the template.
 */
export const IMPORT_TARGETS = [
  { key: 'employee_code', label: 'Employee code' },
  { key: 'full_name', label: 'Full name (split into first, middle and last)' },
  { key: 'first_name', label: 'First name' },
  { key: 'middle_name', label: 'Middle name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'work_email', label: 'Work email' },
  { key: 'work_phone', label: 'Work phone' },
  { key: 'employment_type', label: 'Employment type' },
  { key: 'date_of_joining', label: 'Date of joining' },
  { key: 'probation_end_date', label: 'Probation ends' },
  { key: 'department', label: 'Department (code or name)' },
  { key: 'designation', label: 'Designation' },
  { key: 'location', label: 'Location (code or name)' },
  { key: 'manager', label: 'Manager (code, or name)' },
] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number]['key'];

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Header names seen in PeopleCore's template and in HR systems' exports, normalised. */
const ALIASES: Record<ImportTarget, string[]> = {
  employee_code: ['employee code', 'employee id', 'emp id', 'empid', 'employee no', 'employee number', 'emp no', 'emp code', 'staff id'],
  full_name: ['name', 'full name', 'employee name', 'display name', 'employee full name'],
  first_name: ['first name', 'firstname', 'given name'],
  middle_name: ['middle name', 'middlename'],
  last_name: ['last name', 'lastname', 'surname', 'family name'],
  work_email: ['work email', 'email', 'email id', 'email address', 'official email', 'official email id', 'company email', 'work email address', 'business email', 'office email'],
  work_phone: ['work phone', 'mobile', 'mobile phone', 'mobile number', 'mobile no', 'phone', 'phone number', 'contact number', 'work mobile', 'work phone number'],
  employment_type: ['employment type', 'employee type', 'worker type', 'employee category', 'category', 'type of employment', 'job type', 'employment status type'],
  date_of_joining: ['date of joining', 'doj', 'joining date', 'date joined', 'hire date', 'joined on', 'date of hire', 'start date'],
  probation_end_date: ['probation ends', 'probation end date', 'probation end', 'confirmation date', 'date of confirmation'],
  department: ['department', 'department code', 'dept', 'department name', 'dept name'],
  designation: ['designation', 'job title', 'title', 'position', 'designation name'],
  location: ['location', 'location code', 'work location', 'office', 'office location', 'branch', 'location name', 'base location'],
  manager: ['manager', 'manager code', 'reporting manager', 'reporting to', 'reports to', 'reporting manager employee number', 'manager employee id',
    'reporting manager no', 'reporting manager id', 'manager id', 'reporting manager employee id', 'reporting manager code', 'manager employee number'],
};
const BY_ALIAS = new Map(Object.entries(ALIASES).flatMap(([k, list]) => list.map((a) => [a, k as ImportTarget] as const)));

/** The target each column most likely holds ('' to skip it); a target is used at most once, first column wins. */
export function suggestMapping(headers: string[]): Array<ImportTarget | ''> {
  const used = new Set<string>();
  const out = headers.map((h) => {
    const t = BY_ALIAS.get(norm(h));
    if (!t || used.has(t)) return '';
    used.add(t);
    return t;
  });
  // With first and last names present, a "Name" column is a display name: leave it out.
  if (out.includes('first_name') && out.includes('full_name')) out[out.indexOf('full_name')] = '';
  return out;
}

export type ImportSource = 'peoplecore' | 'zoho' | 'greythr' | 'keka';
export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = { peoplecore: 'PeopleCore template', zoho: 'Zoho People', greythr: 'greytHR', keka: 'Keka' };

/** A best guess at where the file came from (for the screen only; mapping doesn't depend on it). */
export function detectSource(headers: string[]): ImportSource | null {
  const h = new Set(headers.map(norm));
  if (IMPORT_COLUMNS.filter((c) => h.has(norm(c.header))).length >= 5) return 'peoplecore';
  if (h.has('display name') || h.has('worker type') || h.has('date joined') || h.has('reporting manager employee number')) return 'keka';
  if (h.has('employee no') && (h.has('doj') || h.has('date of joining')) && !h.has('email address')) return 'greythr';
  if (h.has('employee id') && (h.has('email address') || h.has('reporting to'))) return 'zoho';
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Spreadsheet dates: an Excel serial day (from 1899-12-30), 05-Jan-2026, Jan 5, 2026, 5 January 2026, 2026/01/05. Others pass through. */
export function looseDate(value: string): string {
  const v = value.trim();
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const n = Math.floor(Number(v));
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  let m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]+(\d{4})$/.exec(v);
  if (m && MONTHS.includes(m[2]!.slice(0, 3).toLowerCase())) return `${m[3]}-${pad(MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1)}-${pad(Number(m[1]))}`;
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m && MONTHS.includes(m[1]!.slice(0, 3).toLowerCase())) return `${m[3]}-${pad(MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1)}-${pad(Number(m[2]))}`;
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return v;
}

const TYPE_WORDS: Array<[RegExp, EmploymentType]> = [
  [/^(full[\s-]?time|permanent|regular|confirmed|on roll|fte)$/i, 'permanent'],
  [/^(contract|contractual|contractor|fixed[\s-]?term|third[\s-]?party|off roll)$/i, 'contract'],
  [/^(intern|internship|trainee|apprentice)$/i, 'intern'],
  [/^(temporary|temp|part[\s-]?time|casual|seasonal)$/i, 'temporary'],
  [/^(consultant|freelancer|freelance|retainer|advisor)$/i, 'consultant'],
];

/** HR systems' employment types onto PeopleCore's (unknown values pass through for the checks to report). */
export function looseEmploymentType(value: string): string {
  const v = value.trim();
  if ((EMPLOYMENT_TYPES as readonly string[]).includes(v.toLowerCase())) return v.toLowerCase();
  return TYPE_WORDS.find(([re]) => re.test(v))?.[1] ?? v;
}

/** "Asha Devi Rao" → first Asha, middle Devi, last Rao; a single word is a first name. */
export function splitName(full: string): { first: string; middle: string; last: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: words[0] ?? '', middle: '', last: '' };
  return { first: words[0]!, middle: words.slice(1, -1).join(' '), last: words[words.length - 1]! };
}

export interface Resolvers {
  department?: (value: string) => string;
  location?: (value: string) => string;
  manager?: (value: string) => string;
}

/**
 * The file's rows on the template's columns. Line numbers stay the file's (row i of the body is line i + 2), so the
 * checks point at the right line of the original file.
 */
export function applyImportMapping(table: string[][], mapping: Array<ImportTarget | ''>, resolve: Resolvers = {}): { header: string[]; rows: string[][] } {
  const header = IMPORT_COLUMNS.map((c) => c.header);
  const at = (key: ImportColumn) => IMPORT_COLUMNS.findIndex((c) => c.key === key);
  const rows = table.slice(1).map((cells) => {
    const out = header.map(() => '');
    const set = (key: ImportColumn, value: string) => { if (value.trim() !== '') out[at(key)] = value.trim(); };
    mapping.forEach((target, i) => {
      const value = (cells[i] ?? '').trim();
      if (!target || value === '') return;
      switch (target) {
        case 'full_name': {
          const n = splitName(value);
          if (!out[at('first_name')]) set('first_name', n.first);
          if (!out[at('middle_name')]) set('middle_name', n.middle);
          if (!out[at('last_name')]) set('last_name', n.last);
          break;
        }
        case 'first_name': case 'middle_name': case 'last_name': out[at(target)] = value; break;
        case 'employment_type': set('employment_type', looseEmploymentType(value)); break;
        case 'date_of_joining': case 'probation_end_date': set(target, looseDate(value)); break;
        case 'department': set('department_code', resolve.department ? resolve.department(value) : value); break;
        case 'location': set('location_code', resolve.location ? resolve.location(value) : value); break;
        case 'manager': set('manager_code', resolve.manager ? resolve.manager(value) : value); break;
        default: set(target, value);
      }
    });
    return out;
  });
  return { header, rows };
}
