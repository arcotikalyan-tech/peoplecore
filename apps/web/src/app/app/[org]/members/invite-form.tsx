'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { CheckboxGroup, SelectField, TextField, type CheckboxOption, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  roles: CheckboxOption[];
  defaultRoleIds: string[];
  employees: Option[];
  rolesHint?: string;
}

export function InviteForm({ action, roles, defaultRoleIds, employees, rolesHint }: Props) {
  const [state, formAction] = useActionState(action, initialActionState);
  // After a failed submit keep what was entered; after success start fresh.
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const checked = v.roleIds !== undefined ? v.roleIds.split(',').filter(Boolean) : defaultRoleIds;

  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <TextField idPrefix="invite" name="email" label="Work email" type="email" required autoComplete="off" defaultValue={v.email} error={e.email} />
      <CheckboxGroup idPrefix="invite" name="roleIds" legend="Roles" options={roles} defaultValues={checked} error={e.roleIds} hint={rolesHint} />
      {employees.length > 0 && (
        <SelectField
          idPrefix="invite" name="employeeId" label="Employee record" options={employees} placeholder="Not linked"
          defaultValue={v.employeeId} error={e.employeeId} hint="Links this sign-in to their employee profile."
        />
      )}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
      </div>
    </form>
  );
}
