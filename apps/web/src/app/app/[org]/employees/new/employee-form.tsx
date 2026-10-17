'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { Card } from '@/components/ui/surface';
import { initialActionState, type ActionState } from '@/lib/action-state';

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  cancelHref: string;
  options: { departments: Option[]; designations: Option[]; locations: Option[]; legalEntities: Option[]; managers: Option[] };
}

const employmentTypes = EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }));

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-6 border-b border-line px-5 py-6 last:border-b-0 md:grid-cols-[220px_1fr]">
      <legend className="sr-only">{title}</legend>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function EmployeeForm({ action, cancelHref, options }: Props) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormMessage state={state} />
      <Card>
        <Section title="Identity" description="Legal name as it appears on official documents.">
          <TextField name="firstName" label="First name" required autoComplete="off" defaultValue={v.firstName} error={e.firstName} />
          <TextField name="middleName" label="Middle name" autoComplete="off" defaultValue={v.middleName} error={e.middleName} />
          <TextField name="lastName" label="Last name" autoComplete="off" defaultValue={v.lastName} error={e.lastName} />
          <TextField name="employeeCode" label="Employee code" defaultValue={v.employeeCode} error={e.employeeCode} hint="Leave blank to generate the next code automatically." />
        </Section>
        <Section title="Work contact" description="Used for sign-in invitations and notifications.">
          <TextField name="workEmail" label="Work email" type="email" autoComplete="off" defaultValue={v.workEmail} error={e.workEmail} />
          <TextField name="workPhone" label="Work phone" type="tel" autoComplete="off" defaultValue={v.workPhone} error={e.workPhone} placeholder="+91 98765 43210" />
        </Section>
        <Section title="Employment" description="Future joining dates create the employee in pre-joining status.">
          <SelectField name="employmentType" label="Employment type" required options={employmentTypes} placeholder="Select…" defaultValue={v.employmentType ?? 'permanent'} error={e.employmentType} />
          <TextField name="dateOfJoining" label="Date of joining" type="date" required defaultValue={v.dateOfJoining} error={e.dateOfJoining} />
          <TextField name="probationEndDate" label="Probation end date" type="date" defaultValue={v.probationEndDate} error={e.probationEndDate} />
        </Section>
        <Section title="Placement" description="Recorded as the first entry in the employment history.">
          <SelectField name="departmentId" label="Department" options={options.departments} placeholder="None" defaultValue={v.departmentId} error={e.departmentId} />
          <SelectField name="designationId" label="Designation" options={options.designations} placeholder="None" defaultValue={v.designationId} error={e.designationId} />
          <SelectField name="locationId" label="Location" options={options.locations} placeholder="None" defaultValue={v.locationId} error={e.locationId} />
          <SelectField name="legalEntityId" label="Legal entity" options={options.legalEntities} placeholder="None" defaultValue={v.legalEntityId} error={e.legalEntityId} />
          <SelectField name="managerEmployeeId" label="Reporting manager" options={options.managers} placeholder="None" defaultValue={v.managerEmployeeId} error={e.managerEmployeeId} />
        </Section>
      </Card>
      <div className="flex justify-end gap-3">
        <Link href={cancelHref} className="inline-flex h-10 items-center px-4 text-sm font-medium text-muted hover:text-fg">Cancel</Link>
        <SubmitButton pendingLabel="Creating…">Create employee</SubmitButton>
      </div>
    </form>
  );
}
