'use client';

import { useActionState, type ReactNode } from 'react';
import type { InviteRecordChoice } from '@peoplecore/shared';
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
  /** The inviter may add employee records (employee.create): offer a new one, joining on this date by default. */
  newRecordDate?: string;
}

/** One way to give the person an employee record; its fields show only while it's chosen (CSS, so it works before hydration). */
function RecordChoice({ value, label, note, checked, children }: { value: InviteRecordChoice; label: string; note?: string; checked: boolean; children?: ReactNode }) {
  return (
    <div className="group/choice rounded-xl border border-line p-3 has-[input[type=radio]:checked]:border-primary/50 has-[input[type=radio]:checked]:bg-primary-soft/40">
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="record" value={value} defaultChecked={checked} className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span>
          <span className="font-medium text-fg">{label}</span>
          {note && <span className="block text-xs text-muted">{note}</span>}
        </span>
      </label>
      {children && <div className="mt-3 hidden gap-3 group-has-[input[type=radio]:checked]/choice:grid">{children}</div>}
    </div>
  );
}

export function InviteForm({ action, roles, defaultRoleIds, employees, rolesHint, newRecordDate }: Props) {
  const [state, formAction] = useActionState(action, initialActionState);
  // After a failed submit keep what was entered; after success start fresh.
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const checked = v.roleIds !== undefined ? v.roleIds.split(',').filter(Boolean) : defaultRoleIds;
  const record = v.record ?? (newRecordDate ? 'new' : employees.length > 0 ? 'existing' : 'none');

  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <FormMessage state={state} />
      <TextField idPrefix="invite" name="email" label="Work email" type="email" required autoComplete="off" defaultValue={v.email} error={e.email} />
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium text-fg">Employee record</legend>
        <p className="text-xs text-muted">Punching in, leave and pay need one, and it’s what lists them under Employees.</p>
        {newRecordDate && (
          <RecordChoice value="new" label="Add their employee record" note="Fill in the rest of their details under Employees later." checked={record === 'new'}>
            <TextField idPrefix="invite" name="firstName" label="First name" required autoComplete="off" defaultValue={v.firstName} error={e.firstName} />
            <TextField idPrefix="invite" name="lastName" label="Last name" autoComplete="off" defaultValue={v.lastName} error={e.lastName} />
            <TextField idPrefix="invite" name="dateOfJoining" label="Date of joining" type="date" required defaultValue={v.dateOfJoining ?? newRecordDate} error={e.dateOfJoining} />
          </RecordChoice>
        )}
        {employees.length > 0 && (
          <RecordChoice value="existing" label="Link a record already under Employees" checked={record === 'existing'}>
            <SelectField idPrefix="invite" name="employeeId" label="Employee record" options={employees} placeholder="Choose…" defaultValue={v.employeeId} error={e.employeeId} />
          </RecordChoice>
        )}
        <RecordChoice value="none" label="No employee record" checked={record === 'none'}
          note="For people who don’t work for you, such as an accountant or an auditor. They can’t punch in, apply for leave or be paid." />
      </fieldset>
      <CheckboxGroup idPrefix="invite" name="roleIds" legend="Roles" options={roles} defaultValues={checked} error={e.roleIds} hint={rolesHint} />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
      </div>
    </form>
  );
}
