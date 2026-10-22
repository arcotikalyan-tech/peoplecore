'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** One button that marks an organization setup step: "Looks right", "Not needed" or "Undo". */
export function MarkStep({ action, step, mark, label, aria, variant = 'ghost' }: {
  action: Action; step: string; mark: 'done' | 'skipped' | 'clear'; label: string; aria: string; variant?: 'ghost' | 'secondary';
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex items-center gap-2">
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="mark" value={mark} />
      {state.message && !state.ok && <span role="alert" className="text-xs text-danger">{state.message}</span>}
      <SubmitButton size="sm" variant={variant} pendingLabel="…">{label}</SubmitButton>
    </form>
  );
}
