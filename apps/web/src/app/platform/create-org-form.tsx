'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { TextField } from '@/components/ui/fields';
import { initialActionState } from '@/lib/action-state';
import { createOrganizationAction } from './actions';

export function CreateOrgForm() {
  const [state, formAction] = useActionState(createOrganizationAction, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <TextField name="name" label="Organization name" required defaultValue={v.name} error={e.name} />
      <TextField name="slug" label="URL" required defaultValue={v.slug} error={e.slug} hint="Lowercase letters, digits and hyphens, e.g. acme-india." />
      <TextField
        name="ownerEmail" label="Owner email" type="email" defaultValue={v.ownerEmail} error={e.ownerEmail}
        hint="Optional. Existing users are added as owner; new users receive an invitation."
      />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
      </div>
    </form>
  );
}
