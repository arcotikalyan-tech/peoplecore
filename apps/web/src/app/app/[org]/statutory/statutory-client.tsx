'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface Period { formId: string; form: string; periodStart: string; periodEnd: string; dueOn: string | null; label: string }

/** Mark one obligation filed (date, acknowledgement, proof) — or not applicable for the period. */
export function FilingForm({ action, period, today }: { action: Action; period: Period; today: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const id = `f-${period.formId}-${period.periodStart}`;
  const hidden = (
    <>
      <input type="hidden" name="formId" value={period.formId} />
      <input type="hidden" name="periodStart" value={period.periodStart} />
      <input type="hidden" name="periodEnd" value={period.periodEnd} />
      {period.dueOn && <input type="hidden" name="dueOn" value={period.dueOn} />}
    </>
  );
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-medium text-primary hover:underline">Mark filed</summary>
      <div className="mt-2 space-y-3 rounded-lg border border-line bg-subtle p-3 text-left">
        <form action={formAction} noValidate aria-label={`Mark ${period.form} ${period.label} filed`} className="space-y-3">
          <FormMessage state={state} />
          {hidden}
          <input type="hidden" name="status" value="filed" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix={id} name="filedOn" label="Filed on" type="date" required max={today} defaultValue={v.filedOn ?? today} error={e.filedOn} />
            <TextField idPrefix={id} name="reference" label="Acknowledgement / challan no." defaultValue={v.reference ?? ''} error={e.reference} />
          </div>
          <div>
            <label htmlFor={`${id}-proof`} className="mb-1 block text-xs font-medium text-muted">Proof (PDF, JPEG or PNG, up to 5 MB)</label>
            <input id={`${id}-proof`} name="proof" type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm" />
            <p className="mt-1 text-[11px] text-muted">Kept for five years after the period; it can’t be removed before then.</p>
          </div>
          <TextField idPrefix={id} name="note" label="Note" defaultValue={v.note ?? ''} error={e.note} />
          <SubmitButton size="sm">Save as filed</SubmitButton>
        </form>
        <form action={formAction} aria-label={`Mark ${period.form} ${period.label} not applicable`}>
          {hidden}
          <input type="hidden" name="status" value="not_applicable" />
          <SubmitButton size="sm" variant="ghost">Not applicable this period</SubmitButton>
        </form>
      </div>
    </details>
  );
}

export function ReopenForm({ action, filingId, label }: { action: Action; filingId: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={`Reopen ${label}`} className="inline">
      <input type="hidden" name="filingId" value={filingId} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">Reopen</SubmitButton>
      {!state.ok && state.message && <p role="alert" className="mt-1 max-w-xs text-xs text-danger">{state.message}</p>}
    </form>
  );
}

export function ScopeForm({ action, contractLabour, factory }: { action: Action; contractLabour: boolean; factory: boolean }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Scope" className="space-y-3">
      <FormMessage state={state} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="contractLabour" defaultChecked={contractLabour} className="mt-0.5 size-4 rounded border-line-strong accent-primary" />
        <span><span className="font-medium">We engage contract labour</span><span className="block text-xs text-muted">Adds principal-employer registration, the register of contractors and the CLRA returns.</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="factory" defaultChecked={factory} className="mt-0.5 size-4 rounded border-line-strong accent-primary" />
        <span><span className="font-medium">An establishment is a factory</span><span className="block text-xs text-muted">Adds the factory annual return under the OSH Code.</span></span>
      </label>
      <SubmitButton size="sm" variant="secondary">Save scope</SubmitButton>
    </form>
  );
}

export function RegistrationForm({ action, est }: {
  action: Action;
  est: { id: string; name: string; pt_number: string | null; pt_enrolment: string | null; lwf_number: string | null; se_number: string | null };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const id = `reg-${est.id}`;
  return (
    <form action={formAction} noValidate aria-label={`Registrations for ${est.name}`} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="locationId" value={est.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField idPrefix={id} name="seNumber" label="Shops & establishments no." defaultValue={v.seNumber ?? est.se_number ?? ''} error={e.seNumber} />
        <TextField idPrefix={id} name="ptNumber" label="PT registration (PTRC)" defaultValue={v.ptNumber ?? est.pt_number ?? ''} error={e.ptNumber} />
        <TextField idPrefix={id} name="ptEnrolment" label="PT enrolment (PTEC)" defaultValue={v.ptEnrolment ?? est.pt_enrolment ?? ''} error={e.ptEnrolment} />
        <TextField idPrefix={id} name="lwfNumber" label="LWF registration" defaultValue={v.lwfNumber ?? est.lwf_number ?? ''} error={e.lwfNumber} />
      </div>
      <SubmitButton size="sm" variant="secondary">Save registrations</SubmitButton>
    </form>
  );
}
