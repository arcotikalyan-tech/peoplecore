'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
export const SCOPE_LABELS: Record<string, string> = {
  contact: 'Personal email and phone numbers', address: 'Current and permanent address', family: 'Family members and dependants',
  emergency: 'Emergency contacts', custom: 'Answers to custom profile fields',
};

export function DeletionRequestForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Request data deletion" className="space-y-3">
      <FormMessage state={state} />
      <fieldset><legend className="mb-1.5 text-sm font-medium">Erase</legend>
        <div className="space-y-1.5">{Object.entries(SCOPE_LABELS).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="scope" value={k} className="size-4 rounded border-line-strong accent-primary" />{label}</label>
        ))}</div>
      </fieldset>
      <label className="block text-sm">Reason (optional)
        <textarea name="reason" rows={2} className="mt-1 block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
      </label>
      <SubmitButton size="sm" variant="secondary">Send request to HR</SubmitButton>
    </form>
  );
}

export function DecideDeletionForm({ action, requestId, name }: { action: Action; requestId: string; name: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={`Decide request from ${name}`} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input name="note" placeholder="Note to the employee (required to decline)" aria-label="Note" className="h-8 w-64 rounded-md border border-line-strong bg-surface px-2 text-xs" />
      <SubmitButton size="sm" variant="danger" name="decision" value="approve" pendingLabel="…">Erase now</SubmitButton>
      <SubmitButton size="sm" variant="ghost" name="decision" value="reject" pendingLabel="…">Decline</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}
