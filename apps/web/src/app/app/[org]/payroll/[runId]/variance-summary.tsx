'use client';

import { useActionState } from 'react';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState } from '@/lib/action-state';
import type { VarianceSummaryState } from '../actions';

export function VarianceSummaryButton({ action, runId }: { action: (prev: VarianceSummaryState, formData: FormData) => Promise<VarianceSummaryState>; runId: string }) {
  const [state, formAction] = useActionState(action, initialActionState as VarianceSummaryState);
  const s = state.ok ? state.summary : undefined;
  return (
    <div className="space-y-3 border-t border-line px-5 py-4">
      <form action={formAction} aria-label="Summarise the changes">
        <input type="hidden" name="runId" value={runId} />
        <SubmitButton variant="secondary" pendingLabel="Summarising…">Summarise for the approver</SubmitButton>
      </form>
      {!state.ok && <FormMessage state={state} />}
      {s && (
        <AiSuggestion title="Summary of the changes" note="Restates the table above; the table is what counts.">
          <p className="leading-6">{s.summary}</p>
          {s.points.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5" aria-label="To check">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>}
          {s.unverified.length > 0 && <p className="mt-2 text-xs font-medium text-warning" role="note">Not in the table: {s.unverified.join(', ')}. Ignore these.</p>}
        </AiSuggestion>
      )}
    </div>
  );
}
