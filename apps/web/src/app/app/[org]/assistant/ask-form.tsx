'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ActionForm } from '@/components/action-form';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { TextAreaField } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
import type { AskState } from './actions';

type Action<S> = (prev: S, formData: FormData) => Promise<S>;

export function AskForm({ action, rate, base }: { action: Action<AskState>; rate: Action<ActionState>; base: string }) {
  const [state, formAction] = useActionState(action, { ok: false } as AskState);
  const answer = state.ok ? state.answer : undefined;
  return (
    <>
      <form action={formAction} aria-label="Ask HR" noValidate className="space-y-3 px-5 py-4">
        <FormMessage state={state.ok ? { ok: false } : state} />
        <TextAreaField idPrefix="ask" name="question" label="Your question" rows={3} required maxLength={1000}
          placeholder="How many days of casual leave do I get?"
          defaultValue={state.ok ? '' : (state.values?.question ?? '')} error={state.fieldErrors?.question} key={state.runId ?? 'q'} />
        <SubmitButton pendingLabel="Looking it up…">Ask</SubmitButton>
      </form>
      {answer && state.runId && (
        <div className="px-5 pb-5">
          <p className="mb-2 text-sm text-muted">You asked: <span className="text-fg">{state.question}</span></p>
          <AiSuggestion key={state.runId} title={answer.answered ? 'Answer from your policies' : 'Not in the policies'}
            note="AI can be wrong; the linked policy is what counts."
            actions={answer.answered ? (
              <>
                <span className="text-xs text-muted">Was this helpful?</span>
                <ActionForm action={rate} label="Helpful" submit="Yes" pendingLabel="…" hidden={{ runId: state.runId, helpful: 'yes' }} size="sm" variant="ghost" className="flex items-center gap-2" />
                <ActionForm action={rate} label="Not helpful" submit="No" pendingLabel="…" hidden={{ runId: state.runId, helpful: 'no' }} size="sm" variant="ghost" className="flex items-center gap-2" />
              </>
            ) : (
              <Link className="text-sm font-medium text-primary hover:underline" href={`${base}/helpdesk`}>Raise a helpdesk ticket →</Link>
            )}>
            <p className="whitespace-pre-line leading-6">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <ul aria-label="Sources" className="mt-3 space-y-1 text-xs">
                {answer.citations.map((c) => (
                  <li key={c.id}>
                    <Link className="text-primary hover:underline" href={c.kind === 'article' ? `${base}/knowledge/${c.id}` : `${base}/policies#policy-${c.id}`}>
                      {c.kind === 'article' ? 'Knowledge base' : 'Policy'}: {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AiSuggestion>
        </div>
      )}
    </>
  );
}
