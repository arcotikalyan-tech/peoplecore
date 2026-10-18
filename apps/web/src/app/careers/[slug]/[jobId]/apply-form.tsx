'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

export function ApplyForm({ action, requisitionId, organization }: { action: (p: ActionState, f: FormData) => Promise<ActionState>; requisitionId: string; organization: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  if (state.ok) return <FormMessage state={state} />;
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Apply" className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="requisitionId" value={requisitionId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="firstName" label="First name" required autoComplete="given-name" defaultValue={v.firstName} error={e.firstName} />
        <TextField name="lastName" label="Last name" autoComplete="family-name" defaultValue={v.lastName} error={e.lastName} />
        <TextField name="email" label="Email" type="email" required autoComplete="email" defaultValue={v.email} error={e.email} />
        <TextField name="phone" label="Phone" type="tel" autoComplete="tel" defaultValue={v.phone} error={e.phone} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-0.5" />
        <span>I agree to {organization} storing and processing my details to consider me for this and similar roles.</span>
      </label>
      {e.consent && <p className="text-xs font-medium text-danger">{e.consent}</p>}
      <SubmitButton pendingLabel="Sending…">Apply</SubmitButton>
    </form>
  );
}
