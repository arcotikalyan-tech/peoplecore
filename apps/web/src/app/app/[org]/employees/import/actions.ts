'use server';

import { revalidatePath } from 'next/cache';
import { importReportSchema, MAX_IMPORT_BYTES, parseImportFile, type ImportProblem } from '@peoplecore/shared';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

export interface ImportState {
  stage: 'idle' | 'preview' | 'done';
  ok: boolean;
  message?: string;
  /** The file's text, sent back on confirm and parsed again there (nothing from the preview is trusted). */
  csv?: string;
  fileName?: string;
  rows?: number;
  valid?: number;
  problems?: ImportProblem[];
}

/**
 * Preview (dry run) or import. Both parse the file, then ask import_employees, which applies every rule
 * as the caller and keeps nothing unless this is a real import with no problems at all.
 */
export async function importEmployeesAction(orgSlug: string, _prev: ImportState, formData: FormData): Promise<ImportState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.create', 'org')) return { stage: 'idle', ok: false, message: 'You don’t have permission to import employees.' };
  const commit = formData.get('mode') === 'commit';

  let csv: string;
  let fileName: string;
  if (commit) {
    csv = String(formData.get('csv') ?? '');
    fileName = String(formData.get('fileName') ?? 'import.csv');
  } else {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { stage: 'idle', ok: false, message: 'Choose a CSV file to check.' };
    if (file.size > MAX_IMPORT_BYTES) return { stage: 'idle', ok: false, message: 'Files can be at most 1 MB.' };
    csv = await file.text();
    fileName = file.name;
  }
  if (csv.length > MAX_IMPORT_BYTES) return { stage: 'idle', ok: false, message: 'Files can be at most 1 MB.' };

  const parsed = parseImportFile(csv);
  if (parsed.fatal) return { stage: 'idle', ok: false, message: parsed.fatal };
  const total = parsed.rows.length + new Set(parsed.problems.map((p) => p.line)).size;
  if (commit && parsed.problems.length > 0) {
    return { stage: 'preview', ok: false, message: 'Fix the problems below and check the file again.', csv, fileName, rows: total, valid: parsed.rows.length, problems: parsed.problems };
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
    return { stage: 'done', ok: true, message: `${valid.toLocaleString('en-IN')} employee${valid === 1 ? '' : 's'} imported.`, rows: total, valid };
  }
  return {
    stage: 'preview',
    ok: problems.length === 0,
    message: problems.length === 0
      ? `All ${total.toLocaleString('en-IN')} rows are ready to import. Nothing has been saved yet.`
      : `${problems.length.toLocaleString('en-IN')} problem${problems.length === 1 ? '' : 's'} found. Nothing has been saved. Fix the file and check it again.`,
    csv, fileName, rows: total, valid, problems,
  };
}
