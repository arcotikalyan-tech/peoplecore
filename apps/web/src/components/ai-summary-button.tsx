'use client';

import { useActionState } from 'react';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

export interface AiSummaryState extends ActionState {
  summary?: { summary: string; points: string[]; unverified: string[] };
}

/** A button that asks an assistant to restate figures already on the page, and shows its answer as a suggestion. */
export function AiSummaryButton({ action, label, button, title, note, hidden = {}, pointsLabel }: {
  action: (prev: AiSummaryState, formData: FormData) => Promise<AiSummaryState>;
  label: string; button: string; title: string; note: string; hidden?: Record<string, string>; pointsLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState as AiSummaryState);
  const s = state.ok ? state.summary : undefined;
  return (
    <div className="space-y-3 border-t border-line px-5 py-4">
      <form action={formAction} aria-label={label}>
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <SubmitButton variant="secondary" pendingLabel="Working…">{button}</SubmitButton>
      </form>
      {!state.ok && <FormMessage state={state} />}
      {s && (
        <AiSuggestion title={title} note={note}>
          <p className="leading-6">{s.summary}</p>
          {s.points.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5" aria-label={pointsLabel}>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>}
          {s.unverified.length > 0 && <p className="mt-2 text-xs font-medium text-warning" role="note">Not in the figures: {s.unverified.join(', ')}. Ignore these.</p>}
        </AiSuggestion>
      )}
    </div>
  );
}
