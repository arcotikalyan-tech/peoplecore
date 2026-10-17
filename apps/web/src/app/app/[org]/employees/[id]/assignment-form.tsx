'use client';

import { useActionState } from 'react';
import { ASSIGNMENT_CHANGE_REASONS, ASSIGNMENT_CHANGE_REASON_LABELS } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  employeeId: string;
  current: { departmentId: string | null; designationId: string | null; locationId: string | null; managerEmployeeId: string | null };
  options: { departments: Option[]; designations: Option[]; locations: Option[]; managers: Option[] };
  today: string;
}

const reasons = ASSIGNMENT_CHANGE_REASONS.map((r) => ({ value: r, label: ASSIGNMENT_CHANGE_REASON_LABELS[r] }));

export function AssignmentForm({ action, employeeId, current, options, today }: Props) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.values;
  const e = state.fieldErrors ?? {};
  // After a failed submit keep what the user typed; otherwise start from the current assignment.
  const pick = (key: string, fallback: string | null) => (v ? v[key] : fallback ?? '');

  return (
    <form action={formAction} noValidate className="space-y-4 px-5 py-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="effectiveFrom" label="Effective from" type="date" required max={today} defaultValue={v?.effectiveFrom ?? today} error={e.effectiveFrom}
          hint="Today or earlier. Future-dated changes aren’t supported yet." />
        <SelectField name="changeReason" label="Reason" required options={reasons} placeholder="Select…" defaultValue={v?.changeReason} error={e.changeReason} />
        <SelectField name="departmentId" label="Department" options={options.departments} placeholder="None" defaultValue={pick('departmentId', current.departmentId)} error={e.departmentId} />
        <SelectField name="designationId" label="Designation" options={options.designations} placeholder="None" defaultValue={pick('designationId', current.designationId)} error={e.designationId} />
        <SelectField name="locationId" label="Location" options={options.locations} placeholder="None" defaultValue={pick('locationId', current.locationId)} error={e.locationId} />
        <SelectField name="managerEmployeeId" label="Reporting manager" options={options.managers.filter((m) => m.value !== employeeId)} placeholder="None"
          defaultValue={pick('managerEmployeeId', current.managerEmployeeId)} error={e.managerEmployeeId} />
      </div>
      <TextAreaField name="notes" label="Notes" defaultValue={v?.notes} error={e.notes} />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Recording…">Record change</SubmitButton>
      </div>
    </form>
  );
}
