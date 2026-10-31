'use client';

import { useActionState, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState } from '@/lib/action-state';
import { addPlatformAdminAction, removePlatformAdminAction, setDefaultPlanAction } from '../actions';

export function AddAdminForm() {
  return (
    <ActionForm action={addPlatformAdminAction} label="Add a platform administrator" submit="Add administrator" variant="secondary" size="sm" className="space-y-3">
      {(v, e) => (
        <TextField name="email" label="Email" type="email" required defaultValue={v.email} error={e.email}
          hint="They need a PeopleCore account already (any organization, or a past invitation). They’re emailed." />
      )}
    </ActionForm>
  );
}

export function RemoveAdminButton({ userId, email }: { userId: string; email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(removePlatformAdminAction, initialActionState);
  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${email}`}>Remove</Button>
        {state.message && !state.ok && <p role="alert" className="text-xs text-danger">{state.message}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton size="sm" variant="danger" pendingLabel="Removing…">Confirm</SubmitButton>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
    </form>
  );
}

export function DefaultPlanForm({ plans, current }: { plans: Option[]; current: string }) {
  return (
    <ActionForm action={setDefaultPlanAction} label="Default plan" submit="Save" variant="secondary" size="sm" className="flex flex-wrap items-end gap-3">
      {() => <SelectField name="plan" label="Default plan for new organizations" defaultValue={current} options={plans} className="min-w-64" />}
    </ActionForm>
  );
}
