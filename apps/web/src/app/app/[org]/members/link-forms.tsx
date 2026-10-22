'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Result({ state }: { state: ActionState }) {
  return state.message ? <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span> : null;
}

/** Links a member's sign-in to an employee record that has none yet. */
export function LinkEmployeeForm({ action, memberId, email, options }: { action: Action; memberId: string; email: string; options: Array<{ value: string; label: string }> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  if (options.length === 0) return <p className="text-xs text-muted">No employee record. Add one under People (same work email links it).</p>;
  return (
    <form action={formAction} aria-label={`Link ${email} to an employee record`} className="mt-1 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="memberId" value={memberId} />
      <select name="employeeId" aria-label={`Employee record for ${email}`} defaultValue="" className="h-8 max-w-52 rounded-md border border-line-strong bg-surface px-2 text-xs">
        <option value="" disabled>Link to employee record…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <SubmitButton size="sm" variant="secondary" pendingLabel="…">Link</SubmitButton>
      <Result state={state} />
    </form>
  );
}

/** A one-button form carrying the member id (unlink, send a password link). */
export function MemberButton({ action, memberId, label, aria, variant = 'ghost' }: { action: Action; memberId: string; label: string; aria: string; variant?: 'ghost' | 'secondary' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="memberId" value={memberId} />
      <SubmitButton size="sm" variant={variant} pendingLabel="…">{label}</SubmitButton>
      <Result state={state} />
    </form>
  );
}
