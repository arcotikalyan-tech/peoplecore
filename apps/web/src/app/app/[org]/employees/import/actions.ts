'use server';

import { revalidatePath } from 'next/cache';
import {
  applyImportMapping, detectSource, IMPORT_TARGETS, importReportSchema, legalName, MAX_IMPORT_ROWS, parseCsv, parseImportFile, suggestMapping,
  toPlainCsv, type ImportProblem, type ImportSource, type ImportTarget, type Resolvers,
} from '@peoplecore/shared';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';
import { readXlsx, XlsxError } from '@/server/xlsx';

export interface ImportState {
  stage: 'idle' | 'map' | 'preview' | 'done';
  ok: boolean;
  message?: string;
  /** The uploaded sheet as CSV text (a workbook is converted), sent back with each step and read again there. */
  csv?: string;
  fileName?: string;
  /** Mapping step: the file's columns, a few rows, the suggested target of each column and where the file seems to come from. */
  headers?: string[];
  samples?: string[][];
  mapping?: string[];
  source?: ImportSource | null;
  rows?: number;
  valid?: number;
  problems?: ImportProblem[];
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SHEET_CHARS = 2 * 1024 * 1024;
const TARGET_KEYS = new Set<string>(IMPORT_TARGETS.map((t) => t.key));

/** Reads an upload (CSV or .xlsx) into rows. */
async function readUpload(file: File): Promise<{ table: string[][] } | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(file.name)) {
    try {
      return { table: readXlsx(bytes, { rows: MAX_IMPORT_ROWS + 1, columns: 60 }) };
    } catch (err) {
      return { error: err instanceof XlsxError ? err.message : 'The workbook could not be read. Save it as CSV and try again.' };
    }
  }
  if (/\.xls$/i.test(file.name) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) return { error: 'Old .xls workbooks aren’t supported. Save it as .xlsx or CSV and try again.' };
  try {
    return { table: parseCsv(new TextDecoder('utf-8').decode(bytes)) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Names in exports become the codes the import needs: departments and locations by code or name, managers by code,
 * "Name (code)", or a full name that matches exactly one person (already here or in the file).
 */
async function resolvers(orgId: string, table: string[][], mapping: Array<ImportTarget | ''>): Promise<Resolvers> {
  const supabase = await createClient();
  const [{ data: depts }, { data: locs }, { data: people }] = await Promise.all([
    supabase.from('departments').select('code, name').eq('organization_id', orgId).is('archived_at', null),
    supabase.from('locations').select('code, name, city').eq('organization_id', orgId).is('archived_at', null),
    supabase.from('employees').select('employee_code, first_name, middle_name, last_name').eq('organization_id', orgId).neq('status', 'exited'),
  ]);
  const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const unique = (pairs: Array<[string, string]>) => {
    const m = new Map<string, string | null>();
    for (const [k, v] of pairs) if (k) m.set(k, m.has(k) && m.get(k) !== v ? null : v);
    return m;
  };
  const deptBy = unique([...(depts ?? []).map((d) => [lower(d.code), d.code] as [string, string]), ...(depts ?? []).map((d) => [lower(d.name), d.code] as [string, string])]);
  const locBy = unique([...(locs ?? []).map((l) => [lower(l.code), l.code] as [string, string]), ...(locs ?? []).map((l) => [lower(l.name), l.code] as [string, string]),
    ...(locs ?? []).filter((l) => l.city).map((l) => [lower(`${l.name}, ${l.city}`), l.code] as [string, string])]);
  // People in the file: their code and the full name they'd get.
  const col = (t: ImportTarget) => mapping.indexOf(t);
  const filePeople: Array<[string, string]> = table.slice(1).map((cells) => {
    const code = cells[col('employee_code')]?.trim() ?? '';
    const full = col('full_name') >= 0 ? cells[col('full_name')] ?? ''
      : [cells[col('first_name')], cells[col('middle_name')], cells[col('last_name')]].filter(Boolean).join(' ');
    return [lower(full.replace(/\s+/g, ' ')), code];
  });
  const codes = new Set([...(people ?? []).map((p) => lower(p.employee_code)), ...filePeople.map(([, c]) => lower(c)).filter(Boolean)]);
  const nameBy = unique([...(people ?? []).map((p) => [lower(legalName(p)), p.employee_code] as [string, string]), ...filePeople.filter(([, c]) => c)]);
  return {
    department: (v) => deptBy.get(lower(v)) ?? v,
    location: (v) => locBy.get(lower(v)) ?? v,
    manager: (v) => {
      if (codes.has(lower(v))) return v;
      const inBrackets = /\(([^()]+)\)\s*$/.exec(v)?.[1]?.trim();
      if (inBrackets && codes.has(lower(inBrackets))) return inBrackets;
      const lastWord = v.trim().split(/\s+/).pop() ?? '';
      if (codes.has(lower(lastWord))) return lastWord;
      return nameBy.get(lower(v.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+/g, ' '))) ?? v;
    },
  };
}

/**
 * Three steps, each starting again from the file's text: upload (read the sheet, suggest a mapping), check (map, then the
 * template's checks and import_employees' dry run, which applies every rule as the caller) and import (the same with
 * nothing kept unless no row has a problem).
 */
export async function importEmployeesAction(orgSlug: string, _prev: ImportState, formData: FormData): Promise<ImportState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.create', 'org')) return { stage: 'idle', ok: false, message: 'You don’t have permission to import employees.' };
  const mode = String(formData.get('mode') ?? 'upload');

  if (mode === 'upload') {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { stage: 'idle', ok: false, message: 'Choose a CSV or Excel (.xlsx) file.' };
    if (file.size > MAX_UPLOAD_BYTES) return { stage: 'idle', ok: false, message: 'Files can be at most 5 MB.' };
    const read = await readUpload(file);
    if ('error' in read) return { stage: 'idle', ok: false, message: read.error };
    const [header, ...body] = read.table;
    if (!header || body.length === 0) return { stage: 'idle', ok: false, message: 'The file has no rows to import.' };
    if (body.length > MAX_IMPORT_ROWS) return { stage: 'idle', ok: false, message: `Import at most ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows at a time.` };
    const csv = toPlainCsv(read.table);
    if (csv.length > MAX_SHEET_CHARS) return { stage: 'idle', ok: false, message: 'The sheet is too large. Keep only the columns you import.' };
    const headers = header.map((h, i) => h.trim() || `Column ${i + 1}`);
    return {
      stage: 'map', ok: true, csv, fileName: file.name, headers, samples: body.slice(0, 3), mapping: suggestMapping(headers), source: detectSource(headers),
      rows: body.length,
    };
  }

  const csv = String(formData.get('csv') ?? '');
  const fileName = String(formData.get('fileName') ?? 'import.csv');
  if (csv.length === 0 || csv.length > MAX_SHEET_CHARS) return { stage: 'idle', ok: false, message: 'Choose the file again.' };
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch {
    return { stage: 'idle', ok: false, message: 'Choose the file again.' };
  }
  const headers = (table[0] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
  const mapping = headers.map((_, i) => {
    const t = String(formData.get(`map_${i}`) ?? '');
    return (TARGET_KEYS.has(t) ? t : '') as ImportTarget | '';
  });
  const back = (message: string): ImportState => ({
    stage: 'map', ok: false, message, csv, fileName, headers, samples: table.slice(1, 4), mapping, source: detectSource(headers), rows: table.length - 1,
  });
  const used = mapping.filter(Boolean);
  if (new Set(used).size !== used.length) return back('Each field can come from one column only.');
  if (!mapping.includes('first_name') && !mapping.includes('full_name')) return back('Choose the column with first names (or full names).');
  for (const [key, label] of [['employment_type', 'employment type'], ['date_of_joining', 'date of joining']] as const) {
    if (!mapping.includes(key)) return back(`Choose the column with the ${label}.`);
  }

  const mapped = applyImportMapping(table, mapping, await resolvers(ctx.org.id, table, mapping));
  const parsed = parseImportFile(toPlainCsv([mapped.header, ...mapped.rows]));
  if (parsed.fatal) return back(parsed.fatal);
  const commit = mode === 'commit';
  const total = parsed.rows.length + new Set(parsed.problems.map((p) => p.line)).size;
  const preview = { stage: 'preview' as const, csv, fileName, headers, mapping, source: detectSource(headers), rows: total };
  if (commit && parsed.problems.length > 0) {
    return { ...preview, ok: false, message: 'Fix the problems below and check the file again.', valid: parsed.rows.length, problems: parsed.problems };
  }

  let report = { committed: false, valid: 0, errors: [] as ImportProblem[] };
  if (parsed.rows.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('import_employees', { p_org: ctx.org.id, p_rows: parsed.rows, p_dry_run: !commit });
    if (error) return { stage: 'idle', ok: false, message: toUserMessage(error) };
    report = importReportSchema.parse(data);
  }
  const problems = [...parsed.problems, ...report.errors].sort((a, b) => a.line - b.line);
  const valid = parsed.rows.length - new Set(report.errors.map((e) => e.line)).size;

  if (commit && report.committed) {
    revalidatePath(`/app/${orgSlug}`, 'layout');
    return { stage: 'done', ok: true, message: `${valid.toLocaleString('en-IN')} employee${valid === 1 ? '' : 's'} imported from ${fileName}.`, rows: total, valid };
  }
  return {
    ...preview,
    ok: problems.length === 0,
    message: problems.length === 0
      ? `All ${total.toLocaleString('en-IN')} rows are ready to import. Nothing has been saved yet.`
      : `${problems.length.toLocaleString('en-IN')} problem${problems.length === 1 ? '' : 's'} found. Nothing has been saved. Fix the file, or the column choices, and check again.`,
    valid, problems,
  };
}
