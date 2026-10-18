'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
import { REASONS, TYPE_LABEL } from './labels';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const TYPES: Option[] = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

export function ResignForm({ action, today, noticeDays, noticeEnd }: { action: Action; today: string; noticeDays: number; noticeEnd: string }) {
  return (
    <ActionForm action={action} label="Resign" submit="Submit resignation" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <TextField idPrefix="rsg" name="lastDay" label="Last working day you’d like" type="date" required min={today}
            hint={`Your notice period is ${noticeDays} days, ending ${noticeEnd}. Leaving earlier needs HR’s agreement.`}
            defaultValue={v.lastDay ?? noticeEnd} error={e.lastDay} />
          <SelectField idPrefix="rsg" name="reasonCategory" label="Main reason" options={REASONS.filter((r) => !['performance', 'conduct', 'restructuring'].includes(r.value))}
            placeholder="Prefer not to say" defaultValue={v.reasonCategory ?? ''} />
          <TextAreaField idPrefix="rsg" name="reason" label="Anything you’d like HR to know" rows={3} hint="Only HR sees this, not your manager."
            defaultValue={v.reason ?? ''} error={e.reason} />
        </>
      )}
    </ActionForm>
  );
}

export function StartExitForm({ action, people, today }: { action: Action; people: Option[]; today: string }) {
  return (
    <ActionForm action={action} label="Start an exit" submit="Start" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <SelectField idPrefix="ext" name="employeeId" label="Employee" required options={people} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="ext" name="type" label="Type" options={TYPES} defaultValue={v.type ?? 'termination'} />
            <TextField idPrefix="ext" name="lastDay" label="Last working day" type="date" required min={today} defaultValue={v.lastDay ?? ''} error={e.lastDay} />
          </div>
          <SelectField idPrefix="ext" name="reasonCategory" label="Reason" options={REASONS} placeholder="Not recorded" defaultValue={v.reasonCategory ?? ''} />
          <TextAreaField idPrefix="ext" name="reason" label="Notes (HR only)" rows={3} defaultValue={v.reason ?? ''} error={e.reason} />
          <p className="text-xs text-muted">The employee’s manager approves first, then another HR administrator.</p>
        </>
      )}
    </ActionForm>
  );
}

export function TermsForm({ action, separationId, lastDay, treatment, shortfall, today }: {
  action: Action; separationId: string; lastDay: string; treatment: string | null; shortfall: number; today: string;
}) {
  return (
    <ActionForm action={action} label="Terms" submit="Save terms" hidden={{ separationId }} variant="secondary" className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <TextField idPrefix="trm" name="lastDay" label="Last working day" type="date" required min={today} defaultValue={v.lastDay ?? lastDay} error={e.lastDay} />
          <SelectField idPrefix="trm" name="treatment" label="Notice shortfall" placeholder={shortfall ? 'Decide later' : 'No shortfall'}
            options={[{ value: 'waived', label: 'Waive it' }, { value: 'recovered', label: 'Recover it in the settlement' }]}
            defaultValue={v.treatment ?? treatment ?? ''} hint="Applies when the last day is before the end of the notice period." />
        </>
      )}
    </ActionForm>
  );
}

export function WaiveForm({ action, itemId, title }: { action: Action; itemId: string; title: string }) {
  return (
    <ActionForm action={action} label={`Waive ${title}`} submit="Waive" hidden={{ itemId, status: 'waived' }} variant="ghost" size="sm"
      className="flex flex-wrap items-end gap-2">
      {(v, e) => <TextField idPrefix={`wv-${itemId}`} name="note" label="Why" placeholder="e.g. lost, recover in settlement" defaultValue={v.note ?? ''} error={e.note} className="w-56" />}
    </ActionForm>
  );
}

export function ExitInterviewForm({ action, separationId }: { action: Action; separationId: string }) {
  return (
    <ActionForm action={action} label="Exit interview" submit="Submit" hidden={{ separationId }} className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <SelectField idPrefix="xi" name="recommend" label="Would you recommend working here?" required defaultValue={v.recommend ?? ''} error={e.recommend} placeholder="Choose…"
            options={[{ value: '5', label: 'Definitely' }, { value: '4', label: 'Probably' }, { value: '3', label: 'Not sure' }, { value: '2', label: 'Probably not' }, { value: '1', label: 'Definitely not' }]} />
          <SelectField idPrefix="xi" name="wouldReturn" label="Would you consider coming back?" defaultValue={v.wouldReturn ?? ''} placeholder="Prefer not to say"
            options={[{ value: 'yes', label: 'Yes' }, { value: 'maybe', label: 'Maybe' }, { value: 'no', label: 'No' }]} />
          <TextAreaField idPrefix="xi" name="improve" label="What should we do better?" rows={3} defaultValue={v.improve ?? ''} error={e.improve} />
          <TextAreaField idPrefix="xi" name="liked" label="What did you value most?" rows={3} defaultValue={v.liked ?? ''} error={e.liked} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="alumni" defaultChecked={v.alumni === 'on'} className="size-4 rounded border-line-strong accent-primary" />
            Keep me in touch (alumni network, future openings)
          </label>
          <p className="text-xs text-muted">Only HR reads your answers.</p>
        </>
      )}
    </ActionForm>
  );
}

export function RehireForm({ action, separationId, eligible }: { action: Action; separationId: string; eligible: boolean | null }) {
  return (
    <ActionForm action={action} label="Eligible for rehire" submit="Save" hidden={{ separationId }} variant="secondary" className="flex flex-wrap items-end gap-3 px-5 py-4">
      {(v) => (
        <SelectField idPrefix="rh" name="eligible" label="Rehire" defaultValue={v.eligible ?? (eligible === false ? 'no' : 'yes')}
          options={[{ value: 'yes', label: 'Eligible for rehire' }, { value: 'no', label: 'Not eligible' }]} />
      )}
    </ActionForm>
  );
}

/** Payroll computes the settlement; extra lines cover what the engine can't know (an unreturned asset, a bonus due). */
export function PrepareSettlementForm({ action, separationId, again }: { action: Action; separationId: string; again: boolean }) {
  return (
    <ActionForm action={action} label="Prepare settlement" submit={again ? 'Compute again' : 'Compute settlement'} hidden={{ separationId }}
      variant={again ? 'secondary' : 'primary'} className="space-y-3 px-5 py-4">
      {(v, e) => (
        <>
          <p className="text-xs text-muted">Salary for the final month is paid by the payroll run. Add anything else due or to recover:</p>
          {[1, 2, 3].map((i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <TextField idPrefix={`fnf${i}`} name={`extraName${i}`} label={`Extra line ${i}`} placeholder={i === 1 ? 'Laptop not returned' : ''} defaultValue={v[`extraName${i}`] ?? ''} />
              <SelectField idPrefix={`fnf${i}`} name={`extraKind${i}`} label="Type" defaultValue={v[`extraKind${i}`] ?? 'deduction'}
                options={[{ value: 'deduction', label: 'Recover' }, { value: 'earning', label: 'Pay' }]} />
              <TextField idPrefix={`fnf${i}`} name={`extraAmount${i}`} label="Amount (₹)" inputMode="decimal" defaultValue={v[`extraAmount${i}`] ?? ''} error={e[`extraAmount${i}`]} />
            </div>
          ))}
        </>
      )}
    </ActionForm>
  );
}

export function RetentionForm({ action, recordClass, label, months }: { action: Action; recordClass: string; label: string; months: number }) {
  return (
    <ActionForm action={action} label={`Retention for ${label}`} submit="Save" hidden={{ recordClass }} variant="secondary" size="sm"
      className="flex flex-wrap items-end justify-between gap-3 px-5 py-3">
      {(v, e) => (
        <TextField idPrefix={`ret-${recordClass}`} name="months" label={`${label}: months after leaving`} inputMode="numeric"
          defaultValue={v.months ?? String(months)} error={e.months} className="w-64" />
      )}
    </ActionForm>
  );
}
