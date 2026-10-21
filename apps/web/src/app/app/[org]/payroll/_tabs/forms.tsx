'use client';

import { useActionState, useMemo, useState } from 'react';
import { structureBreakup, type StructureCalc } from '@peoplecore/payroll/structure';
import { ActionForm } from '@/components/action-form';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const smallInput = 'h-8 w-24 rounded-md border border-line-strong bg-surface px-2 text-right text-sm tabular-nums';

/** One number for one employee-month (LOP days, TDS override, days/hours worked); empty clears it. */
export function InlineNumber({ action, employeeId, month, field, value, label, placeholder, disabled }: {
  action: Action; employeeId: string; month: string; field: 'lop_days' | 'tds_override' | 'units'; value: number | null; label: string; placeholder?: string; disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center justify-end gap-1.5" aria-label={label}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="field" value={field} />
      <input name="value" aria-label={label} inputMode="decimal" defaultValue={value ?? ''} placeholder={placeholder} disabled={disabled} className={smallInput} />
      {!disabled && <SubmitButton size="sm" variant="secondary" pendingLabel="…">Save</SubmitButton>}
      {state.message && <span role="status" className={`text-[11px] ${state.ok ? 'text-success' : 'text-danger'}`}>{state.ok ? '✓' : state.message}</span>}
    </form>
  );
}

export function HoldForm({ action, employeeId, month, onHold, reason, disabled }: {
  action: Action; employeeId: string; month: string; onHold: boolean; reason: string | null; disabled?: boolean;
}) {
  if (disabled) return <span className="text-xs text-muted">{onHold ? `On hold · ${reason}` : '—'}</span>;
  return (
    <ActionForm action={action} label={onHold ? 'Release the hold' : 'Hold the salary'} submit={onHold ? 'Release' : 'Hold'} size="sm" variant={onHold ? 'secondary' : 'ghost'}
      hidden={{ employeeId, month, hold: onHold ? 'off' : 'on' }} className="flex flex-wrap items-center justify-end gap-2">
      {(v, e) => onHold
        ? <span className="text-xs text-warning">{reason}</span>
        : <input name="reason" aria-label="Reason for the hold" placeholder="Reason" defaultValue={v.reason} aria-invalid={e.reason ? true : undefined}
            className="h-8 w-44 rounded-md border border-line-strong bg-surface px-2 text-sm" />}
    </ActionForm>
  );
}

export function LopImportForm({ action, month }: { action: Action; month: string }) {
  return (
    <ActionForm action={action} label="LOP import" submit="⬆ Import LOP" size="sm" variant="secondary" hidden={{ month }} className="flex flex-wrap items-end gap-2">
      {() => (
        <label className="text-xs text-muted">
          <span className="mb-1 block">CSV: employee code, LOP days</span>
          <input type="file" name="file" accept=".csv,text/csv" className="text-sm" />
        </label>
      )}
    </ActionForm>
  );
}

export function StartCycleForm({ action, month, label }: { action: Action; month: string; label: string }) {
  return <ActionForm action={action} label={label} submit={label} hidden={{ month }} size="sm" className="inline-flex flex-col gap-2" />;
}

export interface ComponentOption { id: string; code: string; name: string; kind: string }
export interface StructureView {
  id: string; name: string; description: string | null; pay_basis: 'monthly' | 'daily' | 'hourly';
  lines: Array<{ component_id: string; calc: StructureCalc; value: number }>;
}

const CALC_LABELS: Record<StructureCalc, string> = {
  percent_of_gross: '% of gross', percent_of_basic: '% of basic', fixed: 'Fixed ₹', balance: 'Balance of gross',
};

/** Create or edit a structure: for each earning, how it's calculated. */
export function StructureEditor({ action, structure, components }: { action: Action; structure: StructureView | null; components: ComponentOption[] }) {
  const line = (id: string) => structure?.lines.find((l) => l.component_id === id);
  return (
    <ActionForm action={action} label={structure ? `Edit ${structure.name}` : 'New salary structure'} submit={structure ? 'Save structure' : 'Create structure'}
      hidden={{ structureId: structure?.id ?? '' }} className="space-y-4">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField idPrefix="st" name="name" label="Name" required defaultValue={v.name ?? structure?.name} error={e.name} />
            <SelectField idPrefix="st" name="payBasis" label="Pay basis" defaultValue={v.payBasis ?? structure?.pay_basis ?? 'monthly'}
              options={[{ value: 'monthly', label: 'Monthly salary' }, { value: 'daily', label: 'Daily wage' }, { value: 'hourly', label: 'Hourly wage' }]} />
            <TextField idPrefix="st" name="description" label="Description" defaultValue={v.description ?? structure?.description ?? ''} />
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Components</caption>
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2 font-semibold">Earning</th><th className="font-semibold">Calculation</th><th className="text-right font-semibold">Value</th></tr></thead>
            <tbody className="divide-y divide-line">
              {components.filter((c) => c.kind === 'earning').map((c) => (
                <tr key={c.id}>
                  <td className="py-2 font-medium">{c.name} <span className="text-xs text-muted">{c.code}</span></td>
                  <td>
                    <select name={`calc:${c.id}`} aria-label={`${c.name} calculation`} defaultValue={v[`calc:${c.id}`] ?? line(c.id)?.calc ?? ''}
                      className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm">
                      <option value="">Not in this structure</option>
                      {(Object.keys(CALC_LABELS) as StructureCalc[]).map((k) => <option key={k} value={k}>{CALC_LABELS[k]}</option>)}
                    </select>
                  </td>
                  <td className="text-right">
                    <input name={`value:${c.id}`} aria-label={`${c.name} value`} inputMode="decimal" defaultValue={v[`value:${c.id}`] ?? line(c.id)?.value ?? ''} className={smallInput} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">Percentages are of the monthly gross (or of basic). One component takes the balance so the lines always add up to the gross. Wage structures pay the rate on the basic component.</p>
        </>
      )}
    </ActionForm>
  );
}

/** Kredily's "enter any CTC to see the breakup" preview. */
export function BreakupPreview({ structure, components, initialCtc = 1200000 }: { structure: StructureView; components: ComponentOption[]; initialCtc?: number }) {
  const [ctc, setCtc] = useState(String(initialCtc));
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const breakup = structureBreakup((Number(ctc.replace(/[^0-9.]/g, '')) || 0) / 12, structure.lines.map((l) => ({
    componentId: l.component_id, code: byId.get(l.component_id)?.code ?? '', name: byId.get(l.component_id)?.name ?? '', calc: l.calc, value: l.value,
  })));
  const gross = breakup.total || 1;
  const tones = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-accent'];
  if (structure.pay_basis !== 'monthly') {
    return <p className="rounded-xl border border-line bg-subtle/50 p-4 text-sm text-muted">Wage-based: each employee gets a rate per {structure.pay_basis === 'daily' ? 'day' : 'hour'}, paid for the {structure.pay_basis === 'daily' ? 'days' : 'hours'} worked in the month.</p>;
  }
  return (
    <div className="rounded-xl border border-line bg-subtle/40 p-4">
      <div className="flex flex-wrap items-end gap-6">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Annual CTC
          <span className="mt-1 flex items-center gap-1 text-base font-semibold text-fg">₹<input value={ctc} onChange={(e) => setCtc(e.target.value)} inputMode="numeric"
            className="h-9 w-36 rounded-md border border-line-strong bg-surface px-2 text-base tabular-nums" /></span>
        </label>
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Monthly CTC</p><p className="text-xl font-semibold tabular-nums">{inr.format(breakup.total)}</p></div>
        <p className="text-xs text-muted">Sample preview — enter any CTC to see the breakup</p>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">Salary breakup</p>
      <ul className="mt-2 space-y-2">
        {breakup.lines.map((l, i) => {
          const pct = Math.round((l.amount / gross) * 100);
          return (
            <li key={l.componentId} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="font-medium">{l.name}</span>
              <span className="h-4 overflow-hidden rounded-full bg-line"><span className={`flex h-full items-center px-1.5 text-[10px] font-semibold text-white ${tones[i % tones.length]}`} style={{ width: `${Math.max(pct, 6)}%` }}>{pct}%</span></span>
              <span className="tabular-nums">{inr.format(l.amount)}</span>
            </li>
          );
        })}
      </ul>
      {breakup.overflow && <p className="mt-2 text-xs text-danger">The fixed amounts exceed this CTC.</p>}
    </div>
  );
}

export function SalaryForm({ action, employees, structures, defaultEmployee, defaultStructure, today, revising }: {
  action: Action; employees: Array<{ value: string; label: string }>; structures: Array<{ value: string; label: string; basis: string }>;
  defaultEmployee?: string; defaultStructure?: string; today: string; revising?: boolean;
}) {
  const [structure, setStructure] = useState(defaultStructure ?? structures[0]?.value ?? '');
  const basis = structures.find((s) => s.value === structure)?.basis ?? 'monthly';
  return (
    <ActionForm action={action} label={revising ? 'Revise salary' : 'Assign salary'} submit={revising ? 'Send for sign-off' : 'Save salary'} className="space-y-4">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="sal" name="employeeId" label="Employee" required options={employees} placeholder="Choose…" defaultValue={v.employeeId ?? defaultEmployee ?? ''} error={e.employeeId} />
            <div>
              <label htmlFor="f-sal-structureId" className="mb-1.5 block text-sm font-medium">Salary structure <span className="text-danger" aria-hidden="true">*</span></label>
              <select id="f-sal-structureId" name="structureId" value={structure} onChange={(ev) => setStructure(ev.target.value)}
                className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
                {structures.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <TextField idPrefix="sal" name="amount" label={basis === 'monthly' ? 'Annual CTC (₹)' : `Rate per ${basis === 'daily' ? 'day' : 'hour'} (₹)`} required inputMode="decimal"
              defaultValue={v.amount} error={e.amount} />
            <TextField idPrefix="sal" name="effectiveFrom" label="Effective from" type="date" required defaultValue={v.effectiveFrom ?? today} error={e.effectiveFrom} />
          </div>
          <TextField idPrefix="sal" name="reason" label="Reason" placeholder={revising ? 'Annual appraisal' : 'Offer letter'} defaultValue={v.reason} error={e.reason}
            hint="A revision for someone who already has a salary needs sign-off from another payroll approver. Months already paid get arrears in the next run." />
        </>
      )}
    </ActionForm>
  );
}

export function DecisionForm({ action, hidden, approveLabel = 'Approve', canDecide, canWithdraw }: {
  action: Action; hidden: Record<string, string>; approveLabel?: string; canDecide: boolean; canWithdraw?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2" aria-label="Decision">
      <FormMessage state={state} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {canDecide && (
        <>
          <input name="note" aria-label="Note" placeholder="Note (needed to reject)" className="h-8 w-48 rounded-md border border-line-strong bg-surface px-2 text-sm" />
          <button name="decision" value="approve" className="h-8 rounded-md bg-success px-3 text-xs font-semibold text-white">{approveLabel}</button>
          <button name="decision" value="reject" className="h-8 rounded-md border border-danger px-3 text-xs font-semibold text-danger">Reject</button>
        </>
      )}
      {canWithdraw && <button name="decision" value="withdraw" className="h-8 rounded-md border border-line px-3 text-xs font-medium text-muted">Withdraw</button>}
    </form>
  );
}

export function ComponentForm({ action, component }: {
  action: Action; component?: { id: string; code: string; name: string; kind: string; category: string; taxable: boolean; pf_wage: boolean; is_active: boolean; description: string | null };
}) {
  return (
    <ActionForm action={action} label={component ? `Edit ${component.name}` : 'New component'} submit={component ? 'Save' : 'Add component'} size="sm"
      hidden={{ componentId: component?.id ?? '' }} className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-4">
          <TextField idPrefix={`cmp${component?.id ?? 'new'}`} name="code" label="Code" required defaultValue={v.code ?? component?.code} error={e.code} />
          <TextField idPrefix={`cmp${component?.id ?? 'new'}`} name="name" label="Name" required defaultValue={v.name ?? component?.name} error={e.name} />
          <SelectField idPrefix={`cmp${component?.id ?? 'new'}`} name="kind" label="Type" defaultValue={v.kind ?? component?.kind ?? 'earning'}
            options={[{ value: 'earning', label: 'Earning' }, { value: 'deduction', label: 'Deduction' }]} />
          <SelectField idPrefix={`cmp${component?.id ?? 'new'}`} name="category" label="Category" defaultValue={v.category ?? component?.category ?? 'recurring'}
            options={[{ value: 'base', label: 'Base' }, { value: 'recurring', label: 'Recurring' }, { value: 'variable', label: 'Variable' }, { value: 'adhoc', label: 'Adhoc' }]} />
          <SelectField idPrefix={`cmp${component?.id ?? 'new'}`} name="taxable" label="Taxable" defaultValue={v.taxable ?? (component ? (component.taxable ? 'yes' : 'no') : 'yes')}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          <SelectField idPrefix={`cmp${component?.id ?? 'new'}`} name="pfWage" label="Counts for PF" defaultValue={v.pfWage ?? (component?.pf_wage ? 'yes' : 'no')}
            options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
          <SelectField idPrefix={`cmp${component?.id ?? 'new'}`} name="active" label="Status" defaultValue={v.active ?? (component && !component.is_active ? 'no' : 'yes')}
            options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />
          <TextField idPrefix={`cmp${component?.id ?? 'new'}`} name="description" label="Description" defaultValue={v.description ?? component?.description ?? ''} />
        </div>
      )}
    </ActionForm>
  );
}

const check = (name: string, label: string, on: boolean, hint?: string) => (
  <label className="flex items-start gap-2 text-sm">
    <input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 accent-primary" />
    <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
  </label>
);

export interface PaySettings {
  pay_day: number | null; lop_from_absence: boolean; payslip_template: string; payslip_show_ytd: boolean;
  pay_days_basis: string; holidays_paid: boolean; input_cycle_start_day: number; joiner_cutoff_day: number | null;
  overtime_multiplier: number | null; overtime_in_esi: boolean; payslip_show_paise: boolean; show_tax_projection: boolean; show_tax_computation: boolean;
  da_enabled: boolean;
}

/** Kredily's Pay Settings: cycle, payout date, joiner cut-off, pay days, overtime, payslip decimals and employee access. */
export function PaySettingsForm({ action, s }: { action: Action; s: PaySettings }) {
  const days = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? 'Day 1 (the calendar month)' : `Day ${i + 1} of the previous month` }));
  return (
    <ActionForm action={action} label="Pay settings" submit="Save" size="sm" hidden={{ section: 'pay' }} className="space-y-5">
      {(v, e) => (
        <>
          <fieldset className="space-y-3"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Cycle</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField idPrefix="pay" name="payDay" label="Payout date" defaultValue={v.payDay ?? (s.pay_day ? String(s.pay_day) : 'last')} error={e.payDay}
                options={[{ value: 'last', label: 'Last day of the month' }, ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }))]} />
              <SelectField idPrefix="pay" name="inputCycleStart" label="Attendance & leave cycle starts" defaultValue={v.inputCycleStart ?? String(s.input_cycle_start_day)} error={e.inputCycleStart}
                options={days} />
              <SelectField idPrefix="pay" name="joinerCutoff" label="Joiner cut-off" defaultValue={v.joinerCutoff ?? (s.joiner_cutoff_day ? String(s.joiner_cutoff_day) : 'none')} error={e.joinerCutoff}
                options={[{ value: 'none', label: 'None: everyone joins this month’s run' }, ...Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: `After day ${i + 1}: paid next month` }))]} />
            </div>
            <p className="text-xs text-muted">With a later cycle start, loss of pay and overtime are counted from that day of the previous month to the day before it this month.</p>
          </fieldset>
          <fieldset className="space-y-3"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Pay days</legend>
            <SelectField idPrefix="pay" name="payDaysBasis" label="A month’s pay is spread over" defaultValue={v.payDaysBasis ?? s.pay_days_basis}
              options={[{ value: 'calendar', label: 'Calendar days (weekly offs and holidays are paid)' }, { value: 'working', label: 'Working days only (weekly offs aren’t pay days)' }, { value: 'fixed_30', label: 'A fixed 30 days, whatever the month' }]} />
            {check('holidaysPaid', 'With working days: count declared holidays as paid days', s.holidays_paid)}
            {check('lopFromAbsence', 'Treat absences (no punches, no leave) as loss of pay', s.lop_from_absence, 'Off: only unpaid leave and penalties reduce pay.')}
            {check('daEnabled', 'Use Dearness Allowance (DA) in salaries', s.da_enabled, 'Adds a DA component that counts as a PF wage; add it to salary structures, e.g. as a percentage of basic.')}
          </fieldset>
          <fieldset className="space-y-3"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Overtime</legend>
            <SelectField idPrefix="pay" name="overtimeMultiplier" label="Pay approved overtime" defaultValue={v.overtimeMultiplier ?? (s.overtime_multiplier ? String(Number(s.overtime_multiplier)) : 'none')}
              options={[{ value: 'none', label: 'Don’t pay overtime through payroll' }, { value: '1', label: 'At the hourly rate (1×)' }, { value: '1.5', label: 'At 1.5× the hourly rate' }, { value: '2', label: 'At twice the hourly rate (Factories Act)' }]} />
            {check('overtimeInEsi', 'Include overtime in ESI and professional-tax wages', s.overtime_in_esi, 'The hourly rate is the month’s earnings ÷ pay days ÷ 8 hours.')}
          </fieldset>
          <fieldset className="space-y-3"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Payslips and employee access</legend>
            <SelectField idPrefix="pay" name="payslipTemplate" label="Payslip format" defaultValue={v.payslipTemplate ?? s.payslip_template}
              options={[{ value: 'modern', label: 'Modern' }, { value: 'classic', label: 'Classic' }, { value: 'compact', label: 'Compact' }]} />
            {check('payslipShowYtd', 'Show year-to-date totals on payslips', s.payslip_show_ytd)}
            {check('payslipShowPaise', 'Show paise on payslips', s.payslip_show_paise, 'Amounts are calculated in whole rupees; this shows them as ₹12,345.00.')}
            {check('showTaxProjection', 'Employees see their tax projection', s.show_tax_projection)}
            {check('showTaxComputation', 'Employees see their tax computation', s.show_tax_computation)}
          </fieldset>
        </>
      )}
    </ActionForm>
  );
}

export function StatutorySettingsForm({ action, s }: { action: Action; s: { pf_enabled: boolean; esi_enabled: boolean; pt_enabled: boolean; default_regime: string } }) {
  return (
    <ActionForm action={action} label="Statutory settings" submit="Save" size="sm" hidden={{ section: 'statutory' }} className="space-y-3">
      {(v) => (
        <>
          {check('pf', 'Provident fund (EPF) applies to this company', s.pf_enabled, 'Employer 12% and employee 12% on PF wages up to ₹15,000; per-employee opt-outs on the employee’s profile.')}
          {check('esi', 'ESI applies', s.esi_enabled, 'For employees with gross up to ₹21,000 a month (0.75% / 3.25%).')}
          {check('pt', 'Professional tax applies', s.pt_enabled, 'By the state of the employee’s work location.')}
          <SelectField idPrefix="stat" name="defaultRegime" label="Default tax regime (until the employee declares)" defaultValue={v.defaultRegime ?? s.default_regime}
            options={[{ value: 'new', label: 'New regime' }, { value: 'old', label: 'Old regime' }]} />
        </>
      )}
    </ActionForm>
  );
}

export function DeclarationWindowForm({ action, s }: { action: Action; s: { declaration_open: boolean; declaration_mode: string; declaration_until: string | null; proof_from: string | null; proof_until: string | null } }) {
  return (
    <ActionForm action={action} label="Declaration window" submit="Save" size="sm" hidden={{ section: 'declarations' }} className="space-y-3">
      {(v, e) => (
        <>
          {check('open', 'Employees can submit or change declarations', s.declaration_open)}
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="dw" name="mode" label="Window" defaultValue={v.mode ?? s.declaration_mode}
              options={[{ value: 'yearly', label: 'Yearly (once a year)' }, { value: 'monthly', label: 'Monthly (open every month)' }]} />
            <TextField idPrefix="dw" name="until" label="Declarations close on" type="date" defaultValue={v.until ?? s.declaration_until ?? ''} error={e.until} />
            <TextField idPrefix="dw" name="proofFrom" label="Proof submission from" type="date" defaultValue={v.proofFrom ?? s.proof_from ?? ''} error={e.proofFrom} />
            <TextField idPrefix="dw" name="proofUntil" label="Proof deadline" type="date" defaultValue={v.proofUntil ?? s.proof_until ?? ''} error={e.proofUntil} />
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function BankSettingsForm({ action, s }: { action: Action; s: { bank_name: string | null; account_number: string | null; ifsc: string | null; file_format: string } | null }) {
  return (
    <ActionForm action={action} label="Bank integration" submit="Save" size="sm" hidden={{ section: 'bank' }} className="space-y-3">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField idPrefix="bk" name="bankName" label="Company bank" defaultValue={v.bankName ?? s?.bank_name ?? ''} error={e.bankName} />
          <TextField idPrefix="bk" name="accountNumber" label="Debit account number" inputMode="numeric" defaultValue={v.accountNumber ?? s?.account_number ?? ''} error={e.accountNumber} />
          <TextField idPrefix="bk" name="ifsc" label="IFSC" defaultValue={v.ifsc ?? s?.ifsc ?? ''} error={e.ifsc} />
          <SelectField idPrefix="bk" name="fileFormat" label="Bank advice format" defaultValue={v.fileFormat ?? s?.file_format ?? 'generic'}
            options={[{ value: 'generic', label: 'Generic NEFT (CSV)' }, { value: 'hdfc', label: 'HDFC bulk upload' }, { value: 'icici', label: 'ICICI bulk upload' }, { value: 'axis', label: 'Axis bulk upload' }, { value: 'bob', label: 'Bank of Baroda bulk upload' }, { value: 'sbi', label: 'SBI CMP' }]} />
        </div>
      )}
    </ActionForm>
  );
}

/** Mark selected payouts paid / failed / on hold / pending, with the UTR reference and date. */
export function PayoutBoard({ action, runId, rows, today, canEdit }: {
  action: Action; runId: string; today: string; canEdit: boolean;
  rows: Array<{ employeeId: string; code: string; name: string; bank: string; amount: number; status: string; reference: string | null; paidOn: string | null; note: string | null; mode: string }>;
}) {
  const modes: Record<string, string> = { bank_transfer: 'Bank transfer', cheque: 'Cheque', cash: 'Cash' };
  const [state, formAction] = useActionState(action, initialActionState);
  const [picked, setPicked] = useState<string[]>([]);
  const tone: Record<string, string> = { paid: 'bg-success-soft text-success', pending: 'bg-warning-soft text-warning', failed: 'bg-danger-soft text-danger', on_hold: 'bg-subtle text-muted' };
  return (
    <form action={formAction} aria-label="Payouts" className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="runId" value={runId} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Payouts</caption>
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            {canEdit && <th className="w-8 py-2"><input type="checkbox" aria-label="Select all" className="accent-primary" checked={picked.length === rows.length && rows.length > 0}
              onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.employeeId) : [])} /></th>}
            <th className="py-2 font-semibold">Employee</th><th className="font-semibold">Mode</th><th className="font-semibold">Bank</th><th className="text-right font-semibold">Net pay</th><th className="pl-4 font-semibold">Status</th><th className="font-semibold">Reference</th><th className="font-semibold">Paid on</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.employeeId}>
                {canEdit && <td className="py-2"><input type="checkbox" name="employeeId" value={r.employeeId} aria-label={`Select ${r.name}`} className="accent-primary"
                  checked={picked.includes(r.employeeId)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.employeeId] : picked.filter((x) => x !== r.employeeId))} /></td>}
                <td className="py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted">{r.code}</span></td>
                <td className="text-muted">{modes[r.mode] ?? r.mode}</td>
                <td className="text-muted">{r.bank}</td>
                <td className="text-right tabular-nums font-medium">{inr.format(r.amount)}</td>
                <td className="pl-4"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${tone[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span>{r.note && <span className="ml-2 text-xs text-muted">{r.note}</span>}</td>
                <td className="text-muted">{r.reference ?? '—'}</td>
                <td className="text-muted">{r.paidOn ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-subtle/40 p-3">
          <SelectField idPrefix="po" name="status" label="Mark selected as" defaultValue="paid"
            options={[{ value: 'paid', label: 'Paid' }, { value: 'failed', label: 'Failed' }, { value: 'on_hold', label: 'On hold' }, { value: 'pending', label: 'Pending (release)' }]} />
          <TextField idPrefix="po" name="reference" label="UTR / reference" placeholder="UTR number" />
          <TextField idPrefix="po" name="paidOn" label="Paid on" type="date" defaultValue={today} />
          <TextField idPrefix="po" name="note" label="Note" placeholder="Needed for a hold" />
          <SubmitButton size="sm">Update {picked.length || ''} selected</SubmitButton>
          <span className="mx-1 h-8 w-px bg-line" aria-hidden="true" />
          <SelectField idPrefix="po" name="mode" label="Payment mode" defaultValue="bank_transfer"
            options={[{ value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cheque', label: 'Cheque' }, { value: 'cash', label: 'Cash' }]} />
          <SubmitButton size="sm" variant="secondary" name="op" value="mode">Set mode</SubmitButton>
        </div>
      )}
    </form>
  );
}

/** Bulk status update from a CSV (employee code, status, UTR, paid on, note). */
export function PayoutImportForm({ action, runId }: { action: Action; runId: string }) {
  return (
    <ActionForm action={action} label="Import payout statuses" submit="⬆ Import statuses" size="sm" variant="secondary" hidden={{ runId }} className="flex flex-wrap items-end gap-2">
      {() => (
        <label className="text-xs text-muted">
          <span className="mb-1 block">CSV: employee code, status (paid / failed / on hold / pending), UTR, paid on (YYYY-MM-DD), note</span>
          <input type="file" name="file" accept=".csv,text/csv" aria-label="Payout statuses CSV" className="text-sm" />
        </label>
      )}
    </ActionForm>
  );
}

export function ReviewDeclarationForm({ action, declarationId, items }: {
  action: Action; declarationId: string; items: Array<{ id: string; label: string; section: string; declared: number; approved: number | null; status: string }>;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="space-y-3" aria-label="Review declaration">
      <FormMessage state={state} />
      <input type="hidden" name="declarationId" value={declarationId} />
      <table className="w-full text-sm">
        <caption className="sr-only">Items</caption>
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-1.5">Item</th><th className="text-right">Declared</th><th className="text-right">Approve ₹</th></tr></thead>
        <tbody className="divide-y divide-line">
          {items.map((i) => (
            <tr key={i.id}>
              <td className="py-1.5">{i.label} <span className="text-xs text-muted">{i.section}</span></td>
              <td className="text-right tabular-nums">{inr.format(i.declared)}</td>
              <td className="text-right"><input name={`approved:${i.id}`} aria-label={`Approved amount for ${i.label}`} inputMode="decimal" defaultValue={i.approved ?? i.declared} className={smallInput} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input name="note" aria-label="Note to the employee" placeholder="Note (needed to send back)" className="h-8 w-60 rounded-md border border-line-strong bg-surface px-2 text-sm" />
        <button name="decision" value="approve" className="h-8 rounded-md bg-success px-3 text-xs font-semibold text-white">Approve</button>
        <button name="decision" value="reject" className="h-8 rounded-md border border-danger px-3 text-xs font-semibold text-danger">Send back</button>
      </div>
    </form>
  );
}

export const DECLARATION_FIELDS: Array<{ section: string; group: string; label: string; hint: string; extra?: Array<{ key: string; label: string }>; tds?: boolean }> = [
  { section: 'hra', group: 'HRA', label: 'Rent paid this year', hint: 'Monthly rent × months. Landlord PAN is required above ₹1 lakh a year.', extra: [{ key: 'landlord', label: 'Landlord name' }, { key: 'landlordPan', label: 'Landlord PAN' }] },
  { section: '80C', group: 'Deductions', label: '80C — PPF, ELSS, LIC, EPF top-up, tuition fees, home-loan principal', hint: 'Up to ₹1,50,000 in total.' },
  { section: '80CCD1B', group: 'Deductions', label: '80CCD(1B) — NPS (additional)', hint: 'Up to ₹50,000.' },
  { section: '80D_self', group: 'Deductions', label: '80D — health insurance, self and family', hint: 'Up to ₹25,000 (₹50,000 if senior).' },
  { section: '80D_parents', group: 'Deductions', label: '80D — health insurance, parents', hint: 'Up to ₹25,000 (₹50,000 if senior).' },
  { section: '80E', group: 'Deductions', label: '80E — education loan interest', hint: 'No limit.' },
  { section: '80G', group: 'Deductions', label: '80G — donations (eligible amount)', hint: 'The deductible part of the donation.' },
  { section: '80TTA', group: 'Deductions', label: '80TTA — savings account interest', hint: 'Up to ₹10,000.' },
  { section: 'other', group: 'Deductions', label: 'Other deductions', hint: 'Anything else under Chapter VI-A.' },
  { section: '24B', group: 'House Property', label: 'Home-loan interest (self-occupied)', hint: 'Up to ₹2,00,000.', extra: [{ key: 'lender', label: 'Lender' }] },
  { section: 'lta', group: 'LTA', label: 'Leave travel allowance claimed', hint: 'Travel cost within India, as per the LTA rules.' },
  { section: 'prev_employer', group: 'Prev Employer', label: 'Taxable salary from an earlier employer this year', hint: 'From their Form 16 / Form 12B.', extra: [{ key: 'employer', label: 'Employer' }], tds: true },
];

/** The employee's Tax Center: regime, and what they invest or pay (old-regime reliefs). */
export function MyDeclarationForm({ action, fy, open, declaration }: {
  action: Action; fy: string; open: boolean;
  declaration: { regime: string; status: string; metro: boolean; senior_self: boolean; senior_parents: boolean; review_note: string | null;
    items: Array<{ section: string; declared: number; tds: number | null; approved: number | null; status: string; details: Record<string, string> }> } | null;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [regime, setRegime] = useState(declaration?.regime ?? 'new');
  const item = (s: string) => declaration?.items.find((i) => i.section === s);
  const groups = [...new Set(DECLARATION_FIELDS.map((f) => f.group))];
  const v = state.ok ? {} : (state.values ?? {});
  return (
    <form action={formAction} className="space-y-5" aria-label="Tax declaration">
      <FormMessage state={state} />
      <input type="hidden" name="fy" value={fy} />
      <fieldset disabled={!open} className="space-y-5">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Tax scheme</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tax regime">
            {[['new', 'New regime', 'Lower slabs, ₹75,000 standard deduction, no exemptions. Tax-free up to ₹12 lakh.'],
              ['old', 'Old regime', 'Higher slabs, ₹50,000 standard deduction, plus HRA, 80C, 80D, home-loan interest and LTA.']].map(([k, t, d]) => (
              <label key={k} className={`cursor-pointer rounded-xl border p-3 text-sm ${regime === k ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                <input type="radio" name="regime" value={k} checked={regime === k} onChange={() => setRegime(k!)} className="mr-2 accent-primary" />
                <span className="font-semibold">{t}</span><span className="mt-1 block text-xs text-muted">{d}</span>
              </label>
            ))}
          </div>
        </div>
        {regime === 'old' && groups.map((g) => (
          <fieldset key={g} className="rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold">{g}</legend>
            {g === 'HRA' && (
              <div className="mb-3 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="metro" defaultChecked={declaration?.metro} className="accent-primary" /> I live in a metro (Delhi, Mumbai, Kolkata, Chennai)</label>
              </div>
            )}
            {g === 'Deductions' && (
              <div className="mb-3 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="seniorSelf" defaultChecked={declaration?.senior_self} className="accent-primary" /> I am a senior citizen</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="seniorParents" defaultChecked={declaration?.senior_parents} className="accent-primary" /> My parents are senior citizens</label>
              </div>
            )}
            <div className="space-y-3">
              {DECLARATION_FIELDS.filter((f) => f.group === g).map((f) => {
                const it = item(f.section);
                return (
                  <div key={f.section} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <input type="hidden" name={`label:${f.section}`} value={f.label} />
                    <div>
                      <p className="text-sm font-medium">{f.label}</p>
                      <p className="text-xs text-muted">{f.hint}{it?.status === 'approved' && ` · Approved ${inr.format(Number(it.approved ?? 0))}`}{it?.status === 'rejected' && ' · Not accepted'}</p>
                      {f.extra && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {f.extra.map((x) => <input key={x.key} name={`${x.key}:${f.section}`} aria-label={x.label} placeholder={x.label} defaultValue={v[`${x.key}:${f.section}`] ?? it?.details?.[x.key] ?? ''}
                            className="h-8 w-48 rounded-md border border-line-strong bg-surface px-2 text-sm" />)}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <input name={`declared:${f.section}`} aria-label={`${f.label} (₹ a year)`} inputMode="decimal" placeholder="₹ a year" defaultValue={v[`declared:${f.section}`] ?? (it ? String(it.declared) : '')}
                        className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-right text-sm tabular-nums" />
                      {f.tds && <input name={`tds:${f.section}`} aria-label="TDS already deducted (₹)" inputMode="decimal" placeholder="TDS deducted ₹" defaultValue={v[`tds:${f.section}`] ?? (it?.tds ? String(it.tds) : '')}
                        className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-right text-sm tabular-nums" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        {regime === 'new' && (
          <div className="rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">Prev Employer</p>
            {DECLARATION_FIELDS.filter((f) => f.section === 'prev_employer').map((f) => (
              <div key={f.section} className="mt-2 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <input type="hidden" name={`label:${f.section}`} value={f.label} />
                <p className="text-sm">{f.label}<span className="block text-xs text-muted">{f.hint}</span></p>
                <div className="space-y-2">
                  <input name={`declared:${f.section}`} aria-label={`${f.label} (₹)`} inputMode="decimal" placeholder="₹" defaultValue={item(f.section) ? String(item(f.section)!.declared) : ''}
                    className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-right text-sm tabular-nums" />
                  <input name={`tds:${f.section}`} aria-label="TDS already deducted (₹)" inputMode="decimal" placeholder="TDS deducted ₹" defaultValue={item(f.section)?.tds ? String(item(f.section)!.tds) : ''}
                    className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-right text-sm tabular-nums" />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button name="submit" value="draft" className="h-9 rounded-md border border-line-strong px-4 text-sm font-medium">Save draft</button>
          <button name="submit" value="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-fg">Submit to payroll</button>
        </div>
      </fieldset>
    </form>
  );
}

export function NoteForm({ action, hidden, label, submit, placeholder }: { action: Action; hidden: Record<string, string>; label: string; submit: string; placeholder?: string }) {
  return (
    <ActionForm action={action} label={label} submit={submit} size="sm" hidden={hidden} className="space-y-2">
      {(v) => <TextAreaField idPrefix={label} name="note" label={label} rows={2} placeholder={placeholder} defaultValue={v.note} />}
    </ActionForm>
  );
}
