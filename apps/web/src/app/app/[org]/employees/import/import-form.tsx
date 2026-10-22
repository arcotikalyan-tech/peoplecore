'use client';

import { useActionState } from 'react';
import { IMPORT_SOURCE_LABELS, IMPORT_TARGETS } from '@peoplecore/shared';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { Alert } from '@/components/ui/surface';
import type { ImportState } from './actions';

const initialImportState: ImportState = { stage: 'idle', ok: false };

type Action = (prev: ImportState, formData: FormData) => Promise<ImportState>;

/** Upload a CSV or Excel file, map its columns (suggested for PeopleCore's template and Zoho, greytHR or Keka exports), check, import. */
export function ImportForm({ action, directoryHref }: { action: Action; directoryHref: string }) {
  const [state, formAction] = useActionState(action, initialImportState);

  if (state.stage === 'done') {
    return (
      <div className="space-y-4 px-5 py-5">
        <Alert tone="success" title={state.message} />
        <a href={directoryHref} className={buttonClass('primary')}>Go to the directory</a>
      </div>
    );
  }

  const carry = (
    <>
      <input type="hidden" name="csv" value={state.csv ?? ''} />
      <input type="hidden" name="fileName" value={state.fileName ?? ''} />
    </>
  );
  const mappingFields = (state.headers ?? []).map((_, i) => <input key={i} type="hidden" name={`map_${i}`} value={state.mapping?.[i] ?? ''} />);

  return (
    <div className="space-y-5 px-5 py-5">
      {state.message && <Alert tone={state.ok ? 'success' : 'danger'} title={state.message} />}

      {(state.stage === 'map' || state.stage === 'preview') && state.headers && (
        <form action={formAction} aria-label="Map columns" className="space-y-3">
          <input type="hidden" name="mode" value="check" />
          {carry}
          <p className="text-sm text-muted">
            {state.fileName}: {state.rows} row{state.rows === 1 ? '' : 's'}{state.source ? ` · looks like a ${IMPORT_SOURCE_LABELS[state.source]} file` : ''}.
            Choose what each column holds; columns set to “Don’t import” are left out. Department, location and manager can be names or codes.
          </p>
          <div className="scroll-thin max-h-96 overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">Columns in the file</caption>
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-3 py-2 font-semibold">Column in the file</th><th className="px-3 py-2 font-semibold">Example</th><th className="px-3 py-2 font-semibold">Imports as</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {state.headers.map((h, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium">{h}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-muted">{(state.samples ?? []).map((r) => r[i]).find((x) => x && x.trim()) ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      <select name={`map_${i}`} defaultValue={state.mapping?.[i] ?? ''} aria-label={`${h} imports as`}
                        className="h-9 w-full min-w-56 rounded-md border border-line-strong bg-surface px-2">
                        <option value="">Don’t import</option>
                        {IMPORT_TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SubmitButton variant={state.stage === 'preview' ? 'secondary' : 'primary'} pendingLabel="Checking…">Check rows</SubmitButton>
        </form>
      )}

      {state.stage === 'preview' && (
        <section aria-label="Check results" className="space-y-3">
          <p className="text-sm text-muted">{state.rows} row{state.rows === 1 ? '' : 's'}, {state.valid} without problems.</p>
          {state.problems && state.problems.length > 0 && (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line text-sm" aria-label="Problems">
              {state.problems.map((p, i) => (
                <li key={i} className="flex gap-3 px-3 py-2">
                  <span className="w-16 shrink-0 tabular-nums text-muted">Line {p.line}</span>
                  <span>{p.message}</span>
                </li>
              ))}
            </ul>
          )}
          {state.ok && (
            <form action={formAction}>
              <input type="hidden" name="mode" value="commit" />
              {carry}
              {mappingFields}
              <SubmitButton pendingLabel="Importing…">Import {state.valid} employee{state.valid === 1 ? '' : 's'}</SubmitButton>
            </form>
          )}
        </section>
      )}

      <form action={formAction} noValidate aria-label="Upload a file" className="space-y-3">
        <input type="hidden" name="mode" value="upload" />
        <TextField name="file" label={state.stage === 'idle' ? 'CSV or Excel file' : 'Start again with another file'} type="file" required
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hint="PeopleCore’s template, or an export from Zoho People, greytHR, Keka or any spreadsheet. Up to 2,000 rows and 5 MB. Nothing is saved until you import."
          className="[&_input]:h-auto [&_input]:py-2" />
        <SubmitButton variant={state.stage === 'idle' ? 'primary' : 'secondary'} pendingLabel="Reading…">Upload</SubmitButton>
      </form>
    </div>
  );
}
