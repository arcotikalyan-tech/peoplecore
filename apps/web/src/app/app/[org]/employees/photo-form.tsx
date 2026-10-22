'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Upload or remove a picture (a profile photo or the company logo): JPEG or PNG, under 2 MB. */
export function PictureForm({ action, remove, field, label, has }: { action: Action; remove: () => Promise<ActionState>; field: 'photo' | 'logo'; label: string; has: boolean }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [removed, removeAction] = useActionState(async () => remove(), initialActionState);
  const shown = state.message ? state : removed;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <form action={formAction} aria-label={label} className="flex flex-wrap items-center gap-2">
        <input type="file" name={field} accept="image/jpeg,image/png" aria-label={label} required
          className="max-w-56 text-xs file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-xs" />
        <SubmitButton size="sm" variant="secondary" pendingLabel="Uploading…">{has ? 'Replace' : 'Upload'}</SubmitButton>
      </form>
      {has && (
        <form action={removeAction} aria-label={`Remove ${field === 'photo' ? 'photo' : 'logo'}`}>
          <SubmitButton size="sm" variant="ghost" pendingLabel="…">Remove</SubmitButton>
        </form>
      )}
      {shown.message && <span role={shown.ok ? 'status' : 'alert'} className={`text-xs ${shown.ok ? 'text-success' : 'text-danger'}`}>{shown.message}</span>}
    </div>
  );
}
