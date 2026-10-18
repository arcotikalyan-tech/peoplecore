'use client';

import { useActionState } from 'react';
import { ACCRUAL_PERIOD_LABELS, ACCRUAL_PERIODS } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

export function ApplyLeaveForm({ action, types, today }: { action: Action; types: Option[]; today: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Request leave" className="space-y-4 px-5 py-5">
      <FormMessage state={state} />
      <SelectField idPrefix="leave" name="leaveTypeId" label="Leave type" required options={types} placeholder="Choose…" defaultValue={v.leaveTypeId ?? ''} error={e.leaveTypeId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField idPrefix="leave" name="startDate" label="From" type="date" required defaultValue={v.startDate ?? today} error={e.startDate} />
        <TextField idPrefix="leave" name="endDate" label="To" type="date" required defaultValue={v.endDate ?? today} error={e.endDate} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox name="halfDayStart" label="First day: second half only" defaultChecked={v.halfDayStart === 'on'} />
        <Checkbox name="halfDayEnd" label="Last day: first half only" defaultChecked={v.halfDayEnd === 'on'} />
      </div>
      {e.halfDayEnd && <p className="text-xs font-medium text-danger">{e.halfDayEnd}</p>}
      <TextAreaField idPrefix="leave" name="reason" label="Reason" rows={2} defaultValue={v.reason} error={e.reason} />
      <p className="text-xs text-muted">Weekly offs and holidays inside the dates aren’t counted.</p>
      <SubmitButton pendingLabel="Requesting…">Request leave</SubmitButton>
    </form>
  );
}

export function CancelLeave({ action, requestId, label }: { action: Action; requestId: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="Cancelling…" aria-label={`Cancel ${label}`}>Cancel</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

export function AdjustBalanceForm({ action, employees, types }: { action: Action; employees: Option[]; types: Option[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Adjust a balance" className="space-y-4 px-5 py-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[1fr_160px_110px]">
        <SelectField idPrefix="adj" name="employeeId" label="Employee" required options={employees} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />
        <SelectField idPrefix="adj" name="leaveTypeId" label="Leave type" required options={types} placeholder="Choose…" defaultValue={v.leaveTypeId ?? ''} error={e.leaveTypeId} />
        <TextField idPrefix="adj" name="days" label="Days (±)" required inputMode="decimal" defaultValue={v.days} error={e.days} />
      </div>
      <TextField idPrefix="adj" name="note" label="Reason" required placeholder="Opening balance carried over from the previous system" defaultValue={v.note} error={e.note} />
      <SubmitButton pendingLabel="Saving…">Adjust balance</SubmitButton>
    </form>
  );
}

export function HolidayForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Add a holiday" className="space-y-3 border-t border-line bg-subtle/40 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[170px_1fr_auto_auto] sm:items-end">
        <TextField idPrefix="hol" name="holidayDate" label="Date" type="date" required defaultValue={v.holidayDate} error={e.holidayDate} />
        <TextField idPrefix="hol" name="name" label="Holiday" required placeholder="Republic Day" defaultValue={v.name} error={e.name} />
        <div className="pb-2"><Checkbox name="isOptional" label="Optional" /></div>
        <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}

export function RemoveHoliday({ action, holidayId, name }: { action: Action; holidayId: string; name: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="holidayId" value={holidayId} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="Removing…" aria-label={`Remove ${name}`}>Remove</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

export function PolicyVersionForm({ action, types, today }: { action: Action; types: Option[]; today: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="New policy version" className="space-y-4 border-t border-line px-5 py-5">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SelectField idPrefix="pol" name="leaveTypeId" label="Leave type" required options={types} placeholder="Choose…" defaultValue={v.leaveTypeId ?? ''} error={e.leaveTypeId} />
        <TextField idPrefix="pol" name="effectiveFrom" label="Applies from" type="date" required defaultValue={v.effectiveFrom ?? today} error={e.effectiveFrom} />
        <SelectField idPrefix="pol" name="accrualPeriod" label="Accrues" required options={ACCRUAL_PERIODS.map((p) => ({ value: p, label: ACCRUAL_PERIOD_LABELS[p] }))} defaultValue={v.accrualPeriod ?? 'monthly'} error={e.accrualPeriod} />
        <TextField idPrefix="pol" name="accrualDays" label="Days per period" required inputMode="decimal" defaultValue={v.accrualDays ?? '1'} error={e.accrualDays} />
        <TextField idPrefix="pol" name="carryForwardMax" label="Carry-forward cap" inputMode="decimal" placeholder="Unlimited" defaultValue={v.carryForwardMax} error={e.carryForwardMax} />
      </div>
      <SubmitButton pendingLabel="Saving…">Save new version</SubmitButton>
    </form>
  );
}
