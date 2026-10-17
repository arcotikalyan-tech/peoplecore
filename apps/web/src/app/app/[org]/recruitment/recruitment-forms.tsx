'use client';

import { useActionState } from 'react';
import {
  APPLICATION_STAGE_LABELS,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_SOURCES,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  MOVABLE_STAGES,
  REQUISITION_STATUS_LABELS,
  REQUISITION_STATUSES,
  type ApplicationStage,
  type RequisitionStatus,
} from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const employmentTypes = EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }));
const sources = CANDIDATE_SOURCES.map((s) => ({ value: s, label: CANDIDATE_SOURCE_LABELS[s] }));

export function RequisitionForm({
  action, options,
}: {
  action: Action;
  options: { departments: Option[]; designations: Option[]; locations: Option[]; managers: Option[] };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="New requisition" className="space-y-4 px-5 py-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[1fr_120px_180px]">
        <TextField idPrefix="req" name="title" label="Job title" required placeholder="Backend Engineer" defaultValue={v.title} error={e.title} />
        <TextField idPrefix="req" name="openings" label="Openings" type="number" min={1} max={500} required defaultValue={v.openings ?? '1'} error={e.openings} />
        <SelectField idPrefix="req" name="employmentType" label="Employment type" required options={employmentTypes} defaultValue={v.employmentType ?? 'permanent'} error={e.employmentType} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField idPrefix="req" name="departmentId" label="Department" options={options.departments} placeholder="None" defaultValue={v.departmentId} error={e.departmentId} />
        <SelectField idPrefix="req" name="designationId" label="Designation" options={options.designations} placeholder="None" defaultValue={v.designationId} error={e.designationId} />
        <SelectField idPrefix="req" name="locationId" label="Location" options={options.locations} placeholder="None" defaultValue={v.locationId} error={e.locationId} />
        <SelectField idPrefix="req" name="hiringManagerId" label="Hiring manager" options={options.managers} placeholder="None" defaultValue={v.hiringManagerId} error={e.hiringManagerId}
          hint={options.managers.length === 0 ? 'Only people who can see the employee directory can choose one.' : undefined} />
      </div>
      <TextAreaField idPrefix="req" name="description" label="Description" rows={3} defaultValue={v.description} error={e.description} />
      <SubmitButton pendingLabel="Creating…">Create requisition</SubmitButton>
    </form>
  );
}

export function RequisitionStatusForm({ action, status }: { action: Action; status: RequisitionStatus }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-end gap-2">
      <SelectField idPrefix="status" name="status" label="Status" options={REQUISITION_STATUSES.map((s) => ({ value: s, label: REQUISITION_STATUS_LABELS[s] }))} defaultValue={status} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Update</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

export function AddCandidateForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Add candidate" className="space-y-4 px-5 py-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix="cand" name="firstName" label="First name" required defaultValue={v.firstName} error={e.firstName} />
        <TextField idPrefix="cand" name="lastName" label="Last name" defaultValue={v.lastName} error={e.lastName} />
        <TextField idPrefix="cand" name="email" label="Email" type="email" defaultValue={v.email} error={e.email} hint="An email or a phone number is needed. Existing candidates are matched on both." />
        <TextField idPrefix="cand" name="phone" label="Phone" type="tel" defaultValue={v.phone} error={e.phone} />
        <SelectField idPrefix="cand" name="source" label="Source" required options={sources} defaultValue={v.source ?? 'direct'} error={e.source} />
        <TextField idPrefix="cand" name="currentCompany" label="Current company" defaultValue={v.currentCompany} error={e.currentCompany} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-0.5" aria-describedby={e.consent ? 'cand-consent-error' : undefined} />
        <span>The candidate agreed to us storing and processing their details for recruitment.</span>
      </label>
      {e.consent && <p id="cand-consent-error" className="text-xs font-medium text-danger">{e.consent}</p>}
      <SubmitButton pendingLabel="Adding…">Add candidate</SubmitButton>
    </form>
  );
}

/** One application in the pipeline: move it, hire from Offer, or erase the candidate. */
export function PipelineCard({
  entry, move, hire, erase, canHire,
}: {
  entry: { id: string; stage: ApplicationStage; candidateId: string; name: string };
  move?: Action;
  hire?: Action;
  erase?: Action;
  canHire: boolean;
}) {
  const [moveState, moveAction] = useActionState(move ?? (async () => initialActionState), initialActionState);
  const [hireState, hireAction] = useActionState(hire ?? (async () => initialActionState), initialActionState);
  const [eraseState, eraseAction] = useActionState(erase ?? (async () => initialActionState), initialActionState);
  const p = `app-${entry.id}`;
  if (entry.stage === 'hired' || !move) return null;
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <form action={moveAction} className="flex flex-wrap items-end gap-2" aria-label={`Move ${entry.name}`}>
        <input type="hidden" name="applicationId" value={entry.id} />
        <SelectField idPrefix={p} name="stage" label="Stage" options={MOVABLE_STAGES.map((s) => ({ value: s, label: APPLICATION_STAGE_LABELS[s] }))} defaultValue={entry.stage} />
        <TextField idPrefix={p} name="note" label="Note" placeholder="Optional" className="min-w-40 flex-1" />
        <SubmitButton size="sm" variant="secondary" pendingLabel="Moving…">Move</SubmitButton>
      </form>
      {!moveState.ok && moveState.message && <p role="alert" className="text-xs font-medium text-danger">{moveState.message}</p>}

      {entry.stage === 'offer' && canHire && hire && (
        <form action={hireAction} className="space-y-2 rounded-md bg-subtle/60 p-3" aria-label={`Hire ${entry.name}`}>
          <FormMessage state={hireState} />
          <input type="hidden" name="applicationId" value={entry.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField idPrefix={`${p}-hire`} name="dateOfJoining" label="Date of joining" type="date" required error={hireState.fieldErrors?.dateOfJoining} />
            <TextField idPrefix={`${p}-hire`} name="workEmail" label="Work email" type="email" error={hireState.fieldErrors?.workEmail} />
          </div>
          <SubmitButton size="sm" pendingLabel="Hiring…">Hire and create employee</SubmitButton>
        </form>
      )}

      {erase && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Erase candidate</summary>
          <form action={eraseAction} className="mt-2 space-y-2" aria-label={`Erase ${entry.name}`}>
            <input type="hidden" name="candidateId" value={entry.candidateId} />
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirm" className="mt-0.5" />
              <span>Delete this candidate and all their applications, everywhere. This can’t be undone.</span>
            </label>
            <SubmitButton size="sm" variant="danger" pendingLabel="Erasing…">Erase permanently</SubmitButton>
            {eraseState.message && <p role={eraseState.ok ? 'status' : 'alert'} className={eraseState.ok ? 'text-success' : 'font-medium text-danger'}>{eraseState.message}</p>}
          </form>
        </details>
      )}
    </div>
  );
}
