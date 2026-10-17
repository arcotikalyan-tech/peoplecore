'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { Alert } from '@/components/ui/surface';
import type { ImportState } from './actions';

const initialImportState: ImportState = { stage: 'idle', ok: false };

type Action = (prev: ImportState, formData: FormData) => Promise<ImportState>;

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

  return (
    <div className="space-y-5 px-5 py-5">
      {state.message && <Alert tone={state.ok ? 'success' : 'danger'} title={state.message} />}

      {state.stage === 'preview' && (
        <section aria-label="Check results" className="space-y-3">
          <p className="text-sm text-muted">
            {state.fileName}: {state.rows} row{state.rows === 1 ? '' : 's'}, {state.valid} without problems.
          </p>
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
              <input type="hidden" name="csv" value={state.csv} />
              <input type="hidden" name="fileName" value={state.fileName} />
              <SubmitButton pendingLabel="Importing…">Import {state.valid} employee{state.valid === 1 ? '' : 's'}</SubmitButton>
            </form>
          )}
        </section>
      )}

      <form action={formAction} noValidate aria-label="Check a file" className="space-y-3">
        <input type="hidden" name="mode" value="preview" />
        <TextField name="file" label={state.stage === 'preview' ? 'Check another file' : 'CSV file'} type="file" required
          accept=".csv,text/csv" hint="Up to 2,000 rows and 1 MB. Checking saves nothing."
          className="[&_input]:h-auto [&_input]:py-2" />
        <SubmitButton variant={state.stage === 'preview' ? 'secondary' : 'primary'} pendingLabel="Checking…">Check file</SubmitButton>
      </form>
    </div>
  );
}
