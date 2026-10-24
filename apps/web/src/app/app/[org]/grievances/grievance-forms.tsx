'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
import { COMMITTEE_ROLES, POSH_ACTIONS, type PoshStep } from '@/lib/posh';
import { CATEGORY_LABEL, STATUS_LABEL } from './labels';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const CATEGORY_OPTIONS: Option[] = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
const HANDLER_STATUSES: Option[] = (['in_review', 'investigating', 'resolved', 'closed'] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }));

export function RaiseGrievanceForm({ action, colleagues, today }: { action: Action; colleagues: Option[]; today: string }) {
  return (
    <ActionForm action={action} label="Raise a concern" submit="Submit in confidence" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <SelectField idPrefix="grv" name="category" label="What is it about?" required options={CATEGORY_OPTIONS} placeholder="Choose…"
            defaultValue={v.category ?? ''} error={e.category} />
          <TextField idPrefix="grv" name="subject" label="Title" required placeholder="A few words" defaultValue={v.subject} error={e.subject} />
          <TextAreaField idPrefix="grv" name="description" label="What happened?" required rows={6}
            hint="When, where, who was involved and anyone who saw it. Only the people handling the case will read this."
            defaultValue={v.description} error={e.description} />
          <TextField idPrefix="grv" name="incidentOn" label="When did it happen?" type="date" max={today} defaultValue={v.incidentOn ?? ''} error={e.incidentOn} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="grv1" name="respondents" label="Person involved" options={colleagues} placeholder="No one in particular"
              defaultValue={v.respondents ?? ''} />
            <SelectField idPrefix="grv2" name="respondents" label="Another person involved" options={colleagues} placeholder="No one else" defaultValue="" />
          </div>
          <p className="text-xs text-muted">People you name can never see this case, even if they work in HR.</p>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input type="checkbox" name="anonymous" defaultChecked={v.anonymous === 'on'} className="mt-0.5 size-4 rounded border-line-strong accent-primary" />
            <span>
              <span className="font-medium">Raise it anonymously</span>
              <span className="block text-xs text-muted">
                The people handling it won’t see your name, here or in the audit log. You can still follow the case, reply and add files.
                Leave names out of what you write and attach if you want to stay anonymous. Not available for POSH complaints, which the law
                requires to come from the person affected.
              </span>
            </span>
          </label>
        </>
      )}
    </ActionForm>
  );
}

/** Attaches a PDF, JPEG or PNG (5 MB at most) to a case; the people handling it can keep a file internal. */
export function AttachGrievanceFileForm({ action, caseId, handler, anonymous }: { action: Action; caseId: string; handler: boolean; anonymous: boolean }) {
  return (
    <ActionForm action={action} label="Attach a file" submit="Attach" pendingLabel="Uploading…" hidden={{ caseId }} variant="secondary" size="sm"
      className="space-y-3 border-t border-line px-5 py-4">
      {(v, e) => (
        <>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted">File (PDF, JPEG or PNG, 5 MB at most)</span>
            <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" aria-label="File" className="block w-full text-sm" />
            {e.file && <span className="mt-1 block text-xs text-danger">{e.file}</span>}</label>
          {!handler && anonymous && <p className="text-xs text-muted">Photos and documents can carry your name or where they were taken. Check before you attach.</p>}
          {handler && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="internal" defaultChecked={v.internal === 'on'} className="size-4 rounded border-line-strong accent-primary" />
              Internal (the person who raised it won’t see it)
            </label>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function GrievanceMessageForm({ action, caseId, handler }: { action: Action; caseId: string; handler: boolean }) {
  return (
    <ActionForm action={action} label="Send a message" submit="Send" hidden={{ caseId }} className="space-y-3 border-t border-line px-5 py-4">
      {(v, e) => (
        <>
          <TextAreaField idPrefix="gmsg" name="body" label="Message" required rows={3} defaultValue={v.body} error={e.body} />
          {handler && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="internal" defaultChecked={v.internal === 'on'} className="size-4 rounded border-line-strong accent-primary" />
              Internal note (the person who raised it won’t see it)
            </label>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function UpdateGrievanceForm({ action, caseId, status, outcome }: { action: Action; caseId: string; status: string; outcome: string | null }) {
  return (
    <ActionForm action={action} label="Update case" submit="Update" hidden={{ caseId }} className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <SelectField idPrefix="gupd" name="status" label="Status" options={HANDLER_STATUSES}
            defaultValue={v.status ?? (status === 'submitted' ? 'in_review' : status)} />
          <TextAreaField idPrefix="gupd" name="outcome" label="Outcome" rows={4} hint="Needed to resolve or close. The person who raised it sees this."
            defaultValue={v.outcome ?? outcome ?? ''} error={e.outcome} />
        </>
      )}
    </ActionForm>
  );
}

export function WithdrawGrievanceForm({ action, caseId }: { action: Action; caseId: string }) {
  return (
    <ActionForm action={action} label="Withdraw concern" submit="Withdraw" hidden={{ caseId }} variant="secondary" className="space-y-3 px-5 py-4">
      {(v) => <TextField idPrefix="gwd" name="reason" label="Reason (optional)" defaultValue={v.reason ?? ''} />}
    </ActionForm>
  );
}

export function AddPersonForm({ action, caseId, name, label, submit, options, placeholder }: {
  action: Action; caseId: string; name: 'userId' | 'employeeId'; label: string; submit: string; options: Option[]; placeholder: string;
}) {
  return (
    <ActionForm action={action} label={label} submit={submit} hidden={{ caseId }} variant="secondary" size="sm"
      className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-3">
      {(v, e) => (
        <SelectField idPrefix={`gp-${name}`} name={name} label={label} required options={options} placeholder={placeholder}
          defaultValue={v[name] ?? ''} error={e[name]} className="min-w-56 flex-1" />
      )}
    </ActionForm>
  );
}

const ROLE_OPTIONS: Option[] = Object.entries(COMMITTEE_ROLES).map(([value, label]) => ({ value, label }));
const ACTION_OPTIONS: Option[] = Object.entries(POSH_ACTIONS).map(([value, label]) => ({ value, label }));

/**
 * Adds someone to the Internal Committee: an employee as presiding officer or member, or the external member by name
 * and organization. Every field is always shown (no client state), and the server checks which ones apply.
 */
export function CommitteeMemberForm({ action, employees, today, termUntil }: { action: Action; employees: Option[]; today: string; termUntil: string }) {
  return (
    <ActionForm action={action} label="Add a committee member" submit="Add to the committee" className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      {(v, e) => (
        <>
          <SelectField idPrefix="pcm" name="role" label="Role" options={ROLE_OPTIONS} defaultValue={v.role ?? 'member'} error={e.role} />
          <SelectField idPrefix="pcm" name="employeeId" label="Employee" options={employees} placeholder="Choose… (not for the external member)"
            defaultValue={v.employeeId ?? ''} error={e.employeeId} />
          <TextField idPrefix="pcm" name="externalName" label="External member’s name" defaultValue={v.externalName} error={e.externalName} />
          <TextField idPrefix="pcm" name="externalOrg" label="NGO or association" defaultValue={v.externalOrg} error={e.externalOrg} />
          <SelectField idPrefix="pcm" name="woman" label="Woman" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} defaultValue={v.woman ?? 'yes'}
            hint="At least half the committee are women, and a woman presides." error={e.woman} />
          <TextField idPrefix="pcm" name="termFrom" label="Term from" type="date" required defaultValue={v.termFrom ?? today} error={e.termFrom} />
          <TextField idPrefix="pcm" name="termUntil" label="Term until" type="date" required defaultValue={v.termUntil ?? termUntil} hint="Three years at most." error={e.termUntil} />
        </>
      )}
    </ActionForm>
  );
}

/** Records the date of one statutory step of a POSH case (and, for the employer's action, what it was). */
export function PoshStepForm({ action, caseId, step, label, today, done }: { action: Action; caseId: string; step: PoshStep; label: string; today: string; done: string | null }) {
  return (
    <ActionForm action={action} label={`Record: ${label}`} submit={done ? 'Change' : 'Record'} hidden={{ caseId, step }} variant="secondary" size="sm"
      className="flex flex-wrap items-end gap-2">
      {(v, e) => (
        <>
          <TextField idPrefix={`pst-${step}`} name="on" label="Date" type="date" max={today} defaultValue={v.on ?? done ?? today} error={e.on} className="w-40" />
          {step === 'action_taken' && <SelectField idPrefix={`pst-${step}`} name="action" label="Action" options={ACTION_OPTIONS} placeholder="Choose…" defaultValue={v.action ?? ''} className="min-w-48" />}
        </>
      )}
    </ActionForm>
  );
}

export function PoshSessionForm({ action, today }: { action: Action; today: string }) {
  return (
    <ActionForm action={action} label="Record a session" submit="Record session" className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      {(v, e) => (
        <>
          <TextField idPrefix="pss" name="title" label="Title" required placeholder="POSH awareness workshop" defaultValue={v.title} error={e.title} className="sm:col-span-2" />
          <SelectField idPrefix="pss" name="audience" label="For" options={[{ value: 'employees', label: 'Employees (awareness)' }, { value: 'committee', label: 'The committee (orientation)' }]}
            defaultValue={v.audience ?? 'employees'} />
          <TextField idPrefix="pss" name="heldOn" label="Held on" type="date" required max={today} defaultValue={v.heldOn ?? today} error={e.heldOn} />
          <TextField idPrefix="pss" name="attendees" label="Attendees" inputMode="numeric" defaultValue={v.attendees} error={e.attendees} />
        </>
      )}
    </ActionForm>
  );
}
