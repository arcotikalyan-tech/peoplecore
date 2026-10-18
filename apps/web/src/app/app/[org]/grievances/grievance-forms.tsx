'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
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
