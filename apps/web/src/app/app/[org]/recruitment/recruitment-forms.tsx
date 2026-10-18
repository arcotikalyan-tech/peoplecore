'use client';

import { useActionState, type Ref } from 'react';
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  OFFER_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RECOMMENDATIONS,
  SCORECARD_CRITERIA,
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
import { ActionForm } from '@/components/action-form';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { CheckboxGroup, SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { Badge } from '@/components/ui/surface';
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

/** `formRef` lets the resume reader fill the fields; `suggestionId` then records whether they were kept. */
export function AddCandidateForm({ action, formRef, suggestionId }: { action: Action; formRef?: Ref<HTMLFormElement>; suggestionId?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} noValidate aria-label="Add candidate" className="space-y-4 px-5 py-5">
      <FormMessage state={state} />
      <input type="hidden" name="suggestionId" value={suggestionId ?? ''} />
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

export interface OfferInfo {
  id: string;
  status: keyof typeof OFFER_STATUS_LABELS;
  version: number;
  ctc: string;
  joiningDate: string;
  expiresOn: string;
  joiningLabel: string;
  expiresLabel: string;
}

/** One application in the pipeline: stage, offer, interviews, hire and erase. */
export function PipelineCard({
  entry, offer, actions, canHire, designations, employees, today,
}: {
  entry: { id: string; stage: ApplicationStage; candidateId: string; name: string };
  offer: OfferInfo | null;
  actions: { move: Action; hire?: Action; erase: Action; saveOffer: Action; offerStep: Action; schedule: Action };
  canHire: boolean;
  designations: Option[];
  employees: Option[];
  today: string;
}) {
  const [moveState, moveAction] = useActionState(actions.move, initialActionState);
  const [hireState, hireAction] = useActionState(actions.hire ?? (async () => initialActionState), initialActionState);
  const [eraseState, eraseAction] = useActionState(actions.erase, initialActionState);
  const [offerState, offerAction] = useActionState(actions.saveOffer, initialActionState);
  const [stepState, stepAction] = useActionState(actions.offerStep, initialActionState);
  const [scheduleState, scheduleAction] = useActionState(actions.schedule, initialActionState);
  const p = `app-${entry.id}`;
  if (entry.stage === 'hired') return null;
  const ov = offerState.ok ? {} : (offerState.values ?? {});
  const oe = offerState.fieldErrors ?? {};
  const sv = scheduleState.ok ? {} : (scheduleState.values ?? {});
  const se = scheduleState.fieldErrors ?? {};
  const closed = entry.stage === 'rejected' || entry.stage === 'withdrawn';
  const steps: Array<{ step: string; label: string; show: boolean }> = offer ? [
    { step: 'submit', label: 'Submit for approval', show: offer.status === 'draft' },
    { step: 'sent', label: 'Mark as sent', show: offer.status === 'approved' },
    { step: 'accepted', label: 'Candidate accepted', show: offer.status === 'sent' },
    { step: 'declined', label: 'Candidate declined', show: offer.status === 'sent' },
    { step: 'withdrawn', label: 'Withdraw', show: !['accepted', 'withdrawn', 'declined'].includes(offer.status) },
  ] : [];

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <form action={moveAction} className="flex flex-wrap items-end gap-2" aria-label={`Move ${entry.name}`}>
        <input type="hidden" name="applicationId" value={entry.id} />
        <SelectField idPrefix={p} name="stage" label="Stage" options={MOVABLE_STAGES.map((s) => ({ value: s, label: APPLICATION_STAGE_LABELS[s] }))} defaultValue={entry.stage} />
        <TextField idPrefix={p} name="note" label="Note" placeholder="Optional" className="min-w-40 flex-1" />
        <SubmitButton size="sm" variant="secondary" pendingLabel="Moving…">Move</SubmitButton>
      </form>
      {!moveState.ok && moveState.message && <p role="alert" className="text-xs font-medium text-danger">{moveState.message}</p>}

      {offer && (
        <div className="space-y-2 rounded-md border border-line p-3 text-sm" aria-label={`Offer for ${entry.name}`}>
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Offer v{offer.version}</span>
            <Badge tone={offer.status === 'accepted' ? 'success' : offer.status === 'declined' || offer.status === 'withdrawn' ? 'danger' : offer.status === 'pending_approval' ? 'warning' : 'neutral'}>{OFFER_STATUS_LABELS[offer.status]}</Badge>
          </p>
          <p className="text-muted">{offer.ctc} a year · joins {offer.joiningLabel} · valid until {offer.expiresLabel}</p>
          <div className="flex flex-wrap gap-2">
            {steps.filter((s) => s.show).map((s) => (
              <form key={s.step} action={stepAction}>
                <input type="hidden" name="offerId" value={offer.id} />
                <input type="hidden" name="step" value={s.step} />
                <SubmitButton size="sm" variant={s.step === 'withdrawn' || s.step === 'declined' ? 'ghost' : 'secondary'} pendingLabel="Saving…"
                  aria-label={`${s.label}: ${entry.name}`}>{s.label}</SubmitButton>
              </form>
            ))}
          </div>
          <FormMessage state={stepState} />
        </div>
      )}

      {!closed && (!offer || ['draft', 'approved', 'declined', 'withdrawn'].includes(offer.status)) && (
        <details className="text-sm" open={!offer && entry.stage === 'offer'}>
          <summary className="cursor-pointer font-medium text-primary">{offer ? 'Revise offer (new version)' : 'Make an offer'}</summary>
          <form action={offerAction} noValidate className="mt-2 space-y-2 rounded-md bg-subtle/60 p-3" aria-label={`Offer form for ${entry.name}`}>
            <FormMessage state={offerState} />
            <input type="hidden" name="applicationId" value={entry.id} />
            <div className="grid gap-2 sm:grid-cols-3">
              <TextField idPrefix={`${p}-of`} name="annualCtc" label="Annual CTC (₹)" required inputMode="decimal" defaultValue={ov.annualCtc} error={oe.annualCtc} />
              <TextField idPrefix={`${p}-of`} name="joiningDate" label="Joining date" type="date" required min={today} defaultValue={ov.joiningDate ?? offer?.joiningDate} error={oe.joiningDate} />
              <TextField idPrefix={`${p}-of`} name="expiresOn" label="Offer valid until" type="date" required min={today} defaultValue={ov.expiresOn ?? offer?.expiresOn} error={oe.expiresOn} />
            </div>
            <SelectField idPrefix={`${p}-of`} name="designationId" label="Designation" options={designations} placeholder="As on the requisition" defaultValue={ov.designationId ?? ''} />
            <TextAreaField idPrefix={`${p}-of`} name="terms" label="Terms" rows={2} defaultValue={ov.terms} />
            <SubmitButton size="sm" pendingLabel="Saving…">Save offer</SubmitButton>
          </form>
        </details>
      )}

      {!closed && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-primary">Schedule an interview</summary>
          <form action={scheduleAction} noValidate className="mt-2 space-y-2 rounded-md bg-subtle/60 p-3" aria-label={`Schedule interview for ${entry.name}`}>
            <FormMessage state={scheduleState} />
            <input type="hidden" name="applicationId" value={entry.id} />
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField idPrefix={`${p}-iv`} name="roundName" label="Round" required placeholder="Technical" defaultValue={sv.roundName} error={se.roundName} />
              <TextField idPrefix={`${p}-iv`} name="scheduledAt" label="When" type="datetime-local" required defaultValue={sv.scheduledAt} error={se.scheduledAt} />
              <TextField idPrefix={`${p}-iv`} name="durationMinutes" label="Minutes" inputMode="numeric" defaultValue={sv.durationMinutes ?? '60'} error={se.durationMinutes} />
              <SelectField idPrefix={`${p}-iv`} name="mode" label="Mode" options={INTERVIEW_MODES.map((m) => ({ value: m, label: INTERVIEW_MODE_LABELS[m] }))} defaultValue={sv.mode ?? 'video'} />
            </div>
            <TextField idPrefix={`${p}-iv`} name="location" label="Link or place" defaultValue={sv.location} error={se.location} />
            <CheckboxGroup idPrefix={`${p}-iv`} name="panelistIds" legend="Interviewers" options={employees} error={se.panelistIds} className="max-h-48 overflow-y-auto" />
            <SubmitButton size="sm" pendingLabel="Scheduling…">Schedule</SubmitButton>
          </form>
        </details>
      )}

      {offer?.status === 'accepted' && canHire && actions.hire && (
        <form action={hireAction} className="space-y-2 rounded-md bg-subtle/60 p-3" aria-label={`Hire ${entry.name}`}>
          <FormMessage state={hireState} />
          <input type="hidden" name="applicationId" value={entry.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField idPrefix={`${p}-hire`} name="dateOfJoining" label="Date of joining" type="date" defaultValue={offer.joiningDate} error={hireState.fieldErrors?.dateOfJoining} />
            <TextField idPrefix={`${p}-hire`} name="workEmail" label="Work email" type="email" error={hireState.fieldErrors?.workEmail} />
          </div>
          <SubmitButton size="sm" pendingLabel="Hiring…">Hire and create employee</SubmitButton>
        </form>
      )}

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
    </div>
  );
}

export function PublishToggle({ action, published }: { action: Action; published: boolean }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="publish" value={published ? 'false' : 'true'} />
      <p className="text-sm">{published ? 'Listed on your public careers page.' : 'Not on the careers page.'}</p>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">{published ? 'Unpublish' : 'Publish on careers page'}</SubmitButton>
      {state.message && <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-xs text-success' : 'text-xs text-danger'}>{state.message}</p>}
    </form>
  );
}

export function ScorecardForm({ action, interviewId, label }: { action: Action; interviewId: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  if (state.ok) return <p role="status" className="text-sm text-success">{state.message}</p>;
  return (
    <form action={formAction} noValidate className="space-y-3" aria-label={`Scorecard: ${label}`}>
      <FormMessage state={state} />
      <input type="hidden" name="interviewId" value={interviewId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {SCORECARD_CRITERIA.map((c, i) => (
          <SelectField key={c} idPrefix={`sc-${interviewId}`} name={`rating${i}`} label={c} required
            options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} – ${['', 'Poor', 'Weak', 'Adequate', 'Strong', 'Excellent'][n]}` }))}
            placeholder="Rate…" defaultValue={v[`rating${i}`] ?? ''} />
        ))}
      </div>
      <SelectField idPrefix={`sc-${interviewId}`} name="recommendation" label="Recommendation" required
        options={RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABELS[r] }))} placeholder="Choose…" defaultValue={v.recommendation ?? ''} error={e.recommendation} />
      <TextAreaField idPrefix={`sc-${interviewId}`} name="summary" label="Summary" required rows={3} defaultValue={v.summary} error={e.summary} />
      {e.ratings && <p className="text-xs font-medium text-danger">Rate every criterion.</p>}
      <SubmitButton pendingLabel="Submitting…">Submit scorecard</SubmitButton>
    </form>
  );
}

export function CandidateRetentionForm({ action, days }: { action: Action; days: number }) {
  return (
    <ActionForm action={action} label="Candidate retention" submit="Save" variant="secondary" size="sm"
      className="flex flex-wrap items-end justify-between gap-3 px-5 py-3">
      {(v, e) => (
        <TextField idPrefix="cand-ret" name="days" label="Days after a candidate’s last activity" inputMode="numeric"
          defaultValue={v.days ?? String(days)} error={e.days} className="w-64" />
      )}
    </ActionForm>
  );
}
