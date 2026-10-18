'use client';

import { useActionState } from 'react';
import { ActionForm } from '@/components/action-form';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { TextAreaField } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
import type { CopilotState } from './actions';

type Action<S> = (prev: S, formData: FormData) => Promise<S>;

const TOOL_LABEL: Record<string, string> = {
  headcount: 'Headcount', joiners_and_leavers: 'Joiners and leavers', leave_taken: 'Leave taken', attendance: 'Attendance',
  payroll_totals: 'Payroll totals', recruitment: 'Recruitment', helpdesk: 'Helpdesk tickets', training: 'Training',
};

function describe(input: unknown) {
  return Object.entries((input ?? {}) as Record<string, unknown>).filter(([, v]) => v != null).map(([k, v]) => `${k} ${String(v)}`).join(', ');
}

export function CopilotForm({ action, rate }: { action: Action<CopilotState>; rate: Action<ActionState> }) {
  const [state, formAction] = useActionState(action, { ok: false } as CopilotState);
  const a = state.ok ? state.answer : undefined;
  return (
    <>
      <form action={formAction} aria-label="Ask about your data" noValidate className="space-y-3 px-5 py-4">
        <FormMessage state={state.ok ? { ok: false } : state} />
        <TextAreaField idPrefix="cop" name="question" label="Question" rows={2} required maxLength={600} key={state.runId ?? 'q'}
          placeholder="What was our attrition this year? How many people joined each month?"
          defaultValue={state.ok ? '' : (state.values?.question ?? '')} error={state.fieldErrors?.question} />
        <SubmitButton pendingLabel="Working it out…">Ask</SubmitButton>
      </form>
      {a && state.runId && (
        <div className="px-5 pb-5">
          <p className="mb-2 text-sm text-muted">You asked: <span className="text-fg">{state.question}</span></p>
          <AiSuggestion key={state.runId} title={a.answered ? 'Answer from your data' : 'Not answered'}
            note="Figures come from the queries listed; the wording is AI’s."
            actions={a.answered ? (
              <>
                <span className="text-xs text-muted">Was this helpful?</span>
                <ActionForm action={rate} label="Helpful" submit="Yes" pendingLabel="…" hidden={{ runId: state.runId, helpful: 'yes' }} size="sm" variant="ghost" className="flex items-center gap-2" />
                <ActionForm action={rate} label="Not helpful" submit="No" pendingLabel="…" hidden={{ runId: state.runId, helpful: 'no' }} size="sm" variant="ghost" className="flex items-center gap-2" />
              </>
            ) : undefined}>
            <p className="whitespace-pre-line leading-6">{a.answer}</p>
            {a.figures.length > 0 && (
              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3" aria-label="Figures">
                {a.figures.map((f) => (
                  <div key={`${f.label}-${f.value}`}><dt className="text-xs text-muted">{f.label}</dt><dd className="font-medium tabular-nums">{f.value}</dd></div>
                ))}
              </dl>
            )}
            <dl className="mt-3 space-y-1 text-xs text-muted">
              {a.timeframe && <div><dt className="inline font-medium">Period: </dt><dd className="inline">{a.timeframe}</dd></div>}
              {a.limitations && <div><dt className="inline font-medium">Limits: </dt><dd className="inline">{a.limitations}</dd></div>}
            </dl>
            {a.unverified.length > 0 && (
              <p className="mt-2 text-xs font-medium text-warning" role="note">
                Not found in the data the assistant read: {a.unverified.join(', ')}. Check these before using them.
              </p>
            )}
            {a.queries.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted">How this was worked out</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5" aria-label="Queries">
                  {a.queries.map((q, i) => <li key={i}>{TOOL_LABEL[q.tool] ?? q.tool}{describe(q.input) ? ` (${describe(q.input)})` : ''}</li>)}
                </ul>
              </details>
            )}
          </AiSuggestion>
        </div>
      )}
    </>
  );
}
