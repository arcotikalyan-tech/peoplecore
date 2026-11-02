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
  /** The inviter may add employee records (employee.create): a new one, joining on this date by default. */
  newRecordDate?: string;
  /** The organization adds an employee record for everyone (Settings › Controls): the tick starts on. */
  recordByDefault: boolean;
}

export function InviteForm({ action, roles, defaultRoleIds, employees, rolesHint, newRecordDate, recordByDefault }: Props) {
  const [state, formAction] = useActionState(action, initialActionState);
  // After a failed submit keep what was entered; after success start fresh.
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const checked = v.roleIds !== undefined ? v.roleIds.split(',').filter(Boolean) : defaultRoleIds;
  // An unticked box isn't sent, so "recordShown" tells a cleared tick from a fresh form.
  const tick = v.recordShown ? v.addRecord === 'on' || v.record === 'existing' : recordByDefault;

  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <TextField idPrefix="invite" name="email" label="Work email" type="email" required autoComplete="off" defaultValue={v.email} error={e.email} />
      <fieldset className="group/record space-y-2">
        <legend className="mb-1.5 text-sm font-medium text-fg">Employee record</legend>
        <input type="hidden" name="recordShown" value="1" />
        <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm has-[input:checked]:border-primary/50 has-[input:checked]:bg-primary-soft/40">
          <input type="checkbox" name="addRecord" defaultChecked={tick} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span>
            <span className="font-medium text-fg">Add their employee record</span>
            <span className="block text-xs text-muted">Punching in, leave and pay need one, and it lists them under Employees. Untick for someone who doesn’t work for you, such as an accountant or an auditor.</span>
          </span>
        </label>
        <div className="hidden gap-3 rounded-xl border border-line p-3 group-has-[input[name=addRecord]:checked]/record:grid">
          {newRecordDate ? (
            <>
              <TextField idPrefix="invite" name="firstName" label="First name" required autoComplete="off" defaultValue={v.firstName} error={e.firstName} />
              <TextField idPrefix="invite" name="lastName" label="Last name" autoComplete="off" defaultValue={v.lastName} error={e.lastName} />
              <TextField idPrefix="invite" name="dateOfJoining" label="Date of joining" type="date" required defaultValue={v.dateOfJoining ?? newRecordDate} error={e.dateOfJoining} />
            </>
          ) : (
            <p className="text-xs text-muted">A record is added with the name from their email, joining today. Fill in the rest under Employees.</p>
          )}
          {employees.length > 0 && (
            <SelectField idPrefix="invite" name="employeeId" label="Or link a record already under Employees" options={employees}
              placeholder="No, add a new one" defaultValue={v.employeeId} error={e.employeeId} />
          )}
        </div>
        <p className="hidden text-xs text-muted group-has-[input[name=addRecord]:not(:checked)]/record:block">
          No employee record: they can sign in with their roles, but can’t punch in, apply for leave or be paid.
        </p>
      </fieldset>
      <CheckboxGroup idPrefix="invite" name="roleIds" legend="Roles" options={roles} defaultValues={checked} error={e.roleIds} hint={rolesHint} />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
      </div>
    </form>
  );
}
