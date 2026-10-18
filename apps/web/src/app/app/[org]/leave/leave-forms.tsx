'use client';

import { useActionState, useMemo, useState } from 'react';
import { LEAVE_CATEGORIES, LEAVE_CATEGORY_LABELS, MONTH_NAMES } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Checkbox({ name, label, hint, defaultChecked, checked, onChange }: {
  name: string; label: string; hint?: string; defaultChecked?: boolean; checked?: boolean; onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked === undefined ? defaultChecked : undefined} checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="space-y-4 border-t border-line pt-5 first:border-0 first:pt-0">
    <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">{title}</legend>
    {children}
  </fieldset>
);

// ─── Applying ───────────────────────────────────────────────────────────────

export function ApplyLeaveForm({ action, types, today, employees, title = 'Request leave' }: {
  action: Action; types: Option[]; today: string; employees?: Option[]; title?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label={title} className="space-y-4">
      <FormMessage state={state} />
      {employees && <SelectField idPrefix="leave" name="employeeId" label="Employee" required options={employees} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />}
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
      <TextAreaField idPrefix="leave" name="reason" label="Reason" required rows={2} placeholder="Brief reason…" defaultValue={v.reason} error={e.reason} />
      <p className="text-xs text-muted">Weekly offs and holidays inside the dates aren’t counted, unless the leave rule counts them.</p>
      <SubmitButton pendingLabel="Requesting…">{employees ? 'Apply leave' : 'Request leave'}</SubmitButton>
    </form>
  );
}

export function CancelLeave({ action, requestId, label, text = 'Cancel' }: { action: Action; requestId: string; label: string; text?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton size="sm" variant="ghost" pendingLabel={`${text}…`} aria-label={`${text} ${label}`}>{text}</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

// ─── Rule editor ────────────────────────────────────────────────────────────

export interface RuleValues {
  typeId?: string; name: string; category: string; shortName: string; description: string; annualDays: number;
  countWeekends: boolean; countHolidays: boolean; accrueOverYear: boolean; creditOnPresentDays: boolean;
  accrualFrequency: string; accrualTiming: string; carryForward: boolean; carryForwardMax: number | null; encashable: boolean;
  appliesDuringProbation: boolean; allowedOnNotice: boolean; maxPerMonth: number | null; maxContinuous: number | null;
  allowNegative: boolean; allowHalfDay: boolean; isPaid: boolean; allowFuture: boolean; futureNoticeDays: number;
  allowBackdated: boolean; backdatedMaxDays: number | null; nextYearUntil: number | null; appliesTo: string;
}

export function LeaveRuleEditor({ action, rule }: { action: Action; rule: RuleValues }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const str = (k: string, fallback: string | number | null | undefined) => v[k] ?? (fallback === null || fallback === undefined ? '' : String(fallback));
  const was = (k: keyof RuleValues) => (v[k] !== undefined ? v[k] === 'on' : Boolean(rule[k]));
  const [accrue, setAccrue] = useState(was('accrueOverYear'));
  const [carry, setCarry] = useState(was('carryForward'));
  const [carryMode, setCarryMode] = useState(v.carryForwardMode ?? (rule.carryForwardMax === null ? 'all' : 'max'));
  const [future, setFuture] = useState(was('allowFuture'));
  const [back, setBack] = useState(was('allowBackdated'));
  return (
    <form action={formAction} noValidate aria-label={rule.typeId ? `Edit rule ${rule.name}` : 'New leave rule'} className="space-y-5">
      {rule.typeId && <input type="hidden" name="typeId" value={rule.typeId} />}
      <FormMessage state={state} />
      <Section title="General">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField idPrefix="lr" name="name" label="Leave name" required defaultValue={str('name', rule.name)} error={e.name} />
          <SelectField idPrefix="lr" name="category" label={rule.typeId ? 'Leave type' : 'Leave type'} defaultValue={str('category', rule.category)}
            options={LEAVE_CATEGORIES.map((c) => ({ value: c, label: LEAVE_CATEGORY_LABELS[c] }))} error={e.category} />
          <TextField idPrefix="lr" name="shortName" label="Short name (≤ 2)" maxLength={2} placeholder="CL" defaultValue={str('shortName', rule.shortName)} error={e.shortName} />
          <SelectField idPrefix="lr" name="appliesTo" label="Who gets it" defaultValue={str('appliesTo', rule.appliesTo)}
            options={[{ value: 'everyone', label: 'Everyone' }, { value: 'assigned', label: 'Only employees it’s assigned to' }]} error={e.appliesTo} />
        </div>
        <TextField idPrefix="lr" name="description" label="Description" defaultValue={str('description', rule.description)} error={e.description} />
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="isPaid" label="Paid leave" defaultChecked={was('isPaid')} />
          <Checkbox name="allowHalfDay" label="Half days allowed" defaultChecked={was('allowHalfDay')} />
        </div>
      </Section>

      <Section title="Leaves count">
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <TextField idPrefix="lr" name="annualDays" label="Allowed in a year" type="number" min={0} max={366} step="0.5" required defaultValue={str('annualDays', rule.annualDays)} error={e.annualDays} />
          <div className="space-y-2 pb-1">
            <Checkbox name="countWeekends" label="Count weekends between leaves" defaultChecked={was('countWeekends')} />
            <Checkbox name="countHolidays" label="Count holidays between leaves" defaultChecked={was('countHolidays')} />
          </div>
        </div>
      </Section>

      <Section title="Accrual">
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox name="accrueOverYear" label="Accrue this leave over the year (instead of granting it all upfront)" checked={accrue} onChange={setAccrue} />
          <Checkbox name="creditOnPresentDays" label="Credit on present days instead of a fixed schedule" hint="Each period’s credit scales with days present; credited at the period’s end." defaultChecked={was('creditOnPresentDays')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField idPrefix="lr" name="accrualFrequency" label="Accrual frequency" disabled={!accrue} defaultValue={str('accrualFrequency', rule.accrualFrequency)}
            options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'half_yearly', label: 'Half yearly' }]} error={e.accrualFrequency} />
          <SelectField idPrefix="lr" name="accrualTiming" label="Accrual period" defaultValue={str('accrualTiming', rule.accrualTiming)}
            options={[{ value: 'start', label: 'Start (credited on the first day)' }, { value: 'end', label: 'End (credited on the last day)' }]} error={e.accrualTiming} />
        </div>
        {!accrue && <input type="hidden" name="accrualFrequency" value={str('accrualFrequency', rule.accrualFrequency)} />}
      </Section>

      <Section title="Carry-forward & encashment">
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <div className="space-y-3">
            <Checkbox name="carryForward" label="Enable carry-forward" checked={carry} onChange={setCarry} />
            <Checkbox name="encashable" label="Allow encashment" defaultChecked={was('encashable')} />
            <Checkbox name="appliesDuringProbation" label="Applies during probation" defaultChecked={was('appliesDuringProbation')} />
            <Checkbox name="allowedOnNotice" label="Allowed under notice period" defaultChecked={was('allowedOnNotice')} />
          </div>
          {carry && (
            <div className="space-y-3">
              <SelectField idPrefix="lr" name="carryForwardMode" label="How much carries forward" value={carryMode} onChange={(ev) => setCarryMode(ev.target.value)}
                options={[{ value: 'all', label: 'All remaining leaves' }, { value: 'max', label: 'Up to a maximum' }]} />
              {carryMode === 'max' && <TextField idPrefix="lr" name="carryForwardMax" label="Maximum days carried" type="number" min={0} max={366} step="0.5" defaultValue={str('carryForwardMax', rule.carryForwardMax)} error={e.carryForwardMax} />}
            </div>
          )}
        </div>
      </Section>

      <Section title="Advanced · leaves count">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField idPrefix="lr" name="maxPerMonth" label="Max. leaves allowed in a month (0–31)" type="number" min={0} max={31} step="0.5" hint="0 or empty: no limit." defaultValue={str('maxPerMonth', rule.maxPerMonth)} error={e.maxPerMonth} />
          <TextField idPrefix="lr" name="maxContinuous" label="Continuous leaves allowed" type="number" min={0} max={366} step="0.5" hint="Days in one request. 0 or empty: no limit." defaultValue={str('maxContinuous', rule.maxContinuous)} error={e.maxContinuous} />
        </div>
      </Section>

      <Section title="Advanced · applicability">
        <Checkbox name="allowNegative" label="Negative leaves allowed" hint="Requests don’t need a balance (for example loss of pay)." defaultChecked={was('allowNegative')} />
      </Section>

      <Section title="Advanced · miscellaneous">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Checkbox name="allowFuture" label="Future-dated leaves allowed" checked={future} onChange={setFuture} />
            {future && <TextField idPrefix="lr" name="futureNoticeDays" label="Future-dated leaves allowed after (days)" type="number" min={0} max={365} hint="How many days ahead people must apply." defaultValue={str('futureNoticeDays', rule.futureNoticeDays)} error={e.futureNoticeDays} />}
          </div>
          <div className="space-y-3">
            <Checkbox name="allowBackdated" label="Backdated leaves allowed" checked={back} onChange={setBack} />
            {back && <TextField idPrefix="lr" name="backdatedMaxDays" label="Backdated leaves allowed up to (days)" type="number" min={0} max={366} hint="Empty: no limit." defaultValue={str('backdatedMaxDays', rule.backdatedMaxDays)} error={e.backdatedMaxDays} />}
          </div>
        </div>
        <SelectField idPrefix="lr" name="nextYearUntil" label="Apply leaves for next year till" className="sm:max-w-xs" defaultValue={str('nextYearUntil', rule.nextYearUntil ?? '')}
          options={[{ value: '', label: '— (no limit)' }, ...MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))]} error={e.nextYearUntil} />
      </Section>

      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton pendingLabel="Saving…">{rule.typeId ? 'Save changes' : 'Create rule'}</SubmitButton>
      </div>
    </form>
  );
}

// ─── Assigning ──────────────────────────────────────────────────────────────

export interface PickEmployee { id: string; code: string; name: string; department: string | null; rules: number }

function useSelection(rows: PickEmployee[]) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const visible = useMemo(() => rows.filter((r) => (!dept || r.department === dept)
    && (!q || `${r.name} ${r.code}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, dept]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = () => setPicked(new Set(visible.map((r) => r.id)));
  const clear = () => setPicked(new Set());
  const depts = [...new Set(rows.map((r) => r.department).filter((d): d is string => !!d))].sort();
  return { q, setQ, dept, setDept, picked, toggle, all, clear, visible, depts };
}

function PickerTable({ s, extra }: { s: ReturnType<typeof useSelection>; extra?: (r: PickEmployee) => React.ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <input type="search" value={s.q} onChange={(e) => s.setQ(e.target.value)} placeholder="Search name or ID…" aria-label="Search employees"
          className="h-9 min-w-48 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
        <select value={s.dept} onChange={(e) => s.setDept(e.target.value)} aria-label="Department" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
          <option value="">All departments</option>
          {s.depts.map((d) => <option key={d}>{d}</option>)}
        </select>
        <span className="text-sm text-muted"><span className="font-semibold text-fg">{s.picked.size}</span> selected ·{' '}
          <button type="button" onClick={s.all} className="text-primary hover:underline">Select all</button> ·{' '}
          <button type="button" onClick={s.clear} className="text-primary hover:underline">Clear</button></span>
      </div>
      <div className="max-h-[420px] overflow-auto border-y border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">Employees</caption>
          <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="w-10 px-5 py-2"><span className="sr-only">Select</span></th><th className="py-2">ID</th><th className="py-2">Employee</th><th className="py-2">Department</th><th className="py-2 pr-5">Rules applied</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {s.visible.map((r) => (
              <tr key={r.id} className={cn(s.picked.has(r.id) && 'bg-primary-soft')}>
                <td className="px-5 py-2"><input type="checkbox" name="employeeIds" value={r.id} checked={s.picked.has(r.id)} onChange={() => s.toggle(r.id)} aria-label={`Select ${r.name}`} className="size-4 accent-primary" /></td>
                <td className="py-2 font-mono text-xs text-muted">{r.code}</td>
                <td className="py-2 font-medium">{r.name}</td>
                <td className="py-2 text-muted">{r.department ?? '—'}</td>
                <td className="py-2 pr-5 text-muted">{extra ? extra(r) : `${r.rules} rule${r.rules === 1 ? '' : 's'}`}</td>
              </tr>
            ))}
            {s.visible.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No employees match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AssignRuleForm({ action, rules, employees, today, ruleId }: {
  action: Action; rules: Option[]; employees: PickEmployee[]; today: string; ruleId?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const s = useSelection(employees);
  return (
    <form action={formAction} noValidate aria-label="Assign leave rules">
      <div className="space-y-4 px-5 pb-2">
        <p className="text-sm text-muted">Pick a leave rule, select employees, set the effective date, then assign.</p>
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <SelectField idPrefix="as" name="leaveTypeId" label="Leave rule" required options={rules} defaultValue={ruleId ?? ''} placeholder="Choose…" error={state.fieldErrors?.leaveTypeId} />
          <TextField idPrefix="as" name="effectiveFrom" label="Effective" type="date" required defaultValue={today} error={state.fieldErrors?.effectiveFrom} />
        </div>
      </div>
      <PickerTable s={s} />
      {state.fieldErrors?.employeeIds && <p className="px-5 pt-2 text-xs font-medium text-danger">{state.fieldErrors.employeeIds}</p>}
      <div className="flex justify-end px-5 py-3"><SubmitButton pendingLabel="Assigning…">{`Assign ${s.picked.size}×`}</SubmitButton></div>
    </form>
  );
}

export function AssignmentsBoard({ removeAction, rows, rules }: {
  removeAction: Action; rows: Array<PickEmployee & { ruleNames: string[] }>; rules: Option[];
}) {
  const [state, formAction] = useActionState(removeAction, initialActionState);
  const s = useSelection(rows);
  const names = new Map(rows.map((r) => [r.id, r.ruleNames]));
  return (
    <form action={formAction} aria-label="Assignments">
      <div className="px-5"><FormMessage state={state} /></div>
      <PickerTable s={s} extra={(r) => (
        <span className="flex flex-wrap gap-1">{(names.get(r.id) ?? []).map((n) => <span key={n} className="rounded-md bg-subtle px-1.5 py-0.5 text-xs text-fg">{n}</span>)}
          {(names.get(r.id) ?? []).length === 0 && <span className="text-xs text-warning">No policy</span>}</span>
      )} />
      <div className="flex flex-wrap items-end justify-end gap-3 px-5 py-3">
        <SelectField idPrefix="rm" name="leaveTypeId" label="Remove" className="w-64" options={[{ value: '', label: 'All assigned rules' }, ...rules]} defaultValue="" />
        <SubmitButton variant="danger" pendingLabel="Removing…">Bulk delete</SubmitButton>
      </div>
    </form>
  );
}

export function ImportAssignmentsForm({ action, templateHref }: { action: Action; templateHref: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Import assignments" className="flex flex-wrap items-end gap-3">
      <div className="w-full"><FormMessage state={state} /></div>
      <label className="text-sm">
        <span className="mb-1 block font-medium">CSV file</span>
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-subtle file:px-3 file:py-2 file:text-sm" />
      </label>
      <SubmitButton variant="secondary" pendingLabel="Importing…">Import</SubmitButton>
      <a href={templateHref} className="text-sm text-primary hover:underline">Download the template</a>
    </form>
  );
}

// ─── Balances ───────────────────────────────────────────────────────────────

export interface BalanceRow { typeId: string; name: string; carried: number; credited: number; applied: number; penalty: number; other: number }

export function BalanceEditor({ action, employeeId, employeeName, rows }: { action: Action; employeeId: string; employeeName: string; rows: BalanceRow[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map((r) => [r.typeId, { c: r.carried, cr: r.credited, p: r.penalty }])));
  const set = (id: string, k: 'c' | 'cr' | 'p', n: string) => setVals((v) => ({ ...v, [id]: { ...v[id]!, [k]: Number(n) || 0 } }));
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      <p className="text-sm text-muted">Adjust carry-forward, credited or penalty days per leave type for {employeeName}; the balance recomputes as you type. Every change is added to the ledger with your reason.</p>
      <ul className="space-y-3" aria-label="Leave types">
        {rows.map((r) => {
          const x = vals[r.typeId]!;
          const total = x.c + x.cr - r.applied - x.p - r.other;
          return (
            <li key={r.typeId}>
              <form action={formAction} noValidate aria-label={`Balance: ${r.name}`} className="rounded-xl border border-line p-4">
                <input type="hidden" name="employeeId" value={employeeId} />
                <input type="hidden" name="leaveTypeId" value={r.typeId} />
                <div className="mb-3 flex items-center justify-between"><span className="font-medium">{r.name}</span><span className="text-lg font-semibold tabular-nums">{total.toFixed(2)}</span></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <TextField idPrefix={`b-${r.typeId}`} name="carried" label="Carry-forward" type="number" step="0.5" min={0} value={x.c} onChange={(e) => set(r.typeId, 'c', e.target.value)} />
                  <TextField idPrefix={`b-${r.typeId}`} name="credited" label="Credited" type="number" step="0.01" min={0} value={x.cr} onChange={(e) => set(r.typeId, 'cr', e.target.value)} />
                  <TextField idPrefix={`b-${r.typeId}`} name="applied" label="Applied" type="number" value={r.applied} readOnly disabled />
                  <TextField idPrefix={`b-${r.typeId}`} name="penalty" label="Penalty" type="number" step="0.5" min={0} value={x.p} onChange={(e) => set(r.typeId, 'p', e.target.value)} />
                  <TextField idPrefix={`b-${r.typeId}`} name="total" label="Total" type="number" value={total.toFixed(2)} readOnly disabled />
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <TextField idPrefix={`b-${r.typeId}`} name="note" label="Reason" required className="min-w-56 flex-1" placeholder="Opening balance from the previous system" />
                  <SubmitButton size="sm" pendingLabel="Saving…">Save balance</SubmitButton>
                </div>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RunButton({ action, label, pending = 'Working…', variant = 'secondary' }: { action: (prev: ActionState) => Promise<ActionState>; label: string; pending?: string; variant?: 'primary' | 'secondary' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <SubmitButton size="sm" variant={variant} pendingLabel={pending}>{label}</SubmitButton>
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={cn('text-xs', state.ok ? 'text-success' : 'text-danger')}>{state.message}</span>}
    </form>
  );
}

// ─── Approvals board ────────────────────────────────────────────────────────

export interface BoardRow {
  id: string; approvalId: string | null; canDecide: boolean; code: string; name: string; department: string; type: string;
  from: string; to: string; days: number; reason: string | null; status: string; statusTone: string; actionedBy: string | null; comment: string | null;
  canCancel: boolean; cancelLabel: string;
}

const TONE: Record<string, string> = { warning: 'bg-warning/15 text-warning', success: 'bg-success/15 text-success', danger: 'bg-danger/15 text-danger', neutral: 'bg-subtle text-muted' };

export function ApprovalsBoard({ decideAction, cancelAction, rows }: { decideAction: Action; cancelAction: Action; rows: BoardRow[] }) {
  const [state, formAction] = useActionState(decideAction, initialActionState);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState(false);
  const decidable = rows.filter((r) => r.canDecide && r.approvalId);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div>
      <form action={formAction} id="leave-decide" aria-label="Decide leave requests" className="space-y-3 px-5 pb-3">
        <FormMessage state={state} />
        {[...picked].map((id) => <input key={id} type="hidden" name="approvalId" value={id} />)}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={decidable.length === 0}
            onClick={() => setPicked(new Set(decidable.map((r) => r.approvalId!)))}>Select all pending ({decidable.length})</Button>
          <SubmitButton size="sm" name="decision" value="approve" pendingLabel="Approving…" disabled={picked.size === 0}>{`✓ Approve ${picked.size || ''}`.trim()}</SubmitButton>
          {!rejecting ? (
            <Button type="button" size="sm" variant="danger" disabled={picked.size === 0} onClick={() => setRejecting(true)}>✕ Reject</Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <input name="comment" required placeholder="Reason for rejecting" aria-label="Reason for rejecting" className="h-8 w-64 rounded-lg border border-line bg-surface px-2 text-sm" />
              <SubmitButton size="sm" variant="danger" name="decision" value="reject" pendingLabel="Rejecting…">Reject {picked.size}</SubmitButton>
            </span>
          )}
          {picked.size > 0 && <button type="button" onClick={() => { setPicked(new Set()); setRejecting(false); }} className="text-sm text-muted hover:underline">Clear</button>}
          <span className="ml-auto text-xs text-muted">{picked.size} selected</span>
        </div>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <caption className="sr-only">Leave requests</caption>
          <thead className="border-y border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="w-10 px-5 py-2"><span className="sr-only">Select</span></th><th className="py-2">ID</th><th className="py-2">Employee</th><th className="py-2">Department</th>
              <th className="py-2">Leave type</th><th className="py-2">From</th><th className="py-2">To</th><th className="py-2">Days</th><th className="py-2">Reason</th>
              <th className="py-2">Status</th><th className="py-2">Actioned by</th><th className="py-2 pr-5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2.5">{r.canDecide && r.approvalId && (
                  <input type="checkbox" checked={picked.has(r.approvalId)} onChange={() => toggle(r.approvalId!)} aria-label={`Select ${r.name} ${r.type} ${r.from}`} className="size-4 accent-primary" />
                )}</td>
                <td className="py-2.5 font-mono text-xs text-muted">{r.code}</td>
                <td className="py-2.5 font-medium">{r.name}</td>
                <td className="py-2.5 text-muted">{r.department}</td>
                <td className="py-2.5">{r.type}</td>
                <td className="whitespace-nowrap py-2.5">{r.from}</td>
                <td className="whitespace-nowrap py-2.5">{r.to}</td>
                <td className="py-2.5 tabular-nums">{r.days} {r.days === 1 ? 'day' : 'days'}</td>
                <td className="max-w-48 truncate py-2.5 text-muted" title={r.reason ?? ''}>{r.reason ?? '—'}</td>
                <td className="py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONE[r.statusTone])}>{r.status}</span></td>
                <td className="py-2.5 text-muted" title={r.comment ?? ''}>{r.actionedBy ?? '—'}</td>
                <td className="py-2.5 pr-5 text-right">
                  <span className="inline-flex items-center gap-1">
                    {r.canDecide && r.approvalId && (
                      <>
                        <RowApprove action={decideAction} approvalId={r.approvalId} label={`${r.name} ${r.type} ${r.from}`} />
                        <button type="button" onClick={() => { setPicked(new Set([r.approvalId!])); setRejecting(true); }}
                          aria-label={`Reject ${r.name} ${r.type} ${r.from}`} className="rounded-md bg-danger/15 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/25">✕ Reject</button>
                      </>
                    )}
                    {r.canCancel && <CancelLeave action={cancelAction} requestId={r.id} label={`${r.name} ${r.type} ${r.from}`} text={r.cancelLabel} />}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="py-8 text-center text-muted">No leave requests match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RowApprove({ action, approvalId, label }: { action: Action; approvalId: string; label: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="decision" value="approve" />
      <button type="submit" aria-label={`Approve ${label}`} className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success hover:bg-success/25">✓ Approve</button>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

// ─── Settings, encashment, donation, holidays ───────────────────────────────

export function LeaveSettingsForm({ action, settings }: {
  action: Action; settings: { year_start_month: number; carry_forward_expiry: string; skip_level_approval: boolean; donation_enabled: boolean };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} noValidate aria-label="Leave settings" className="space-y-6">
      <FormMessage state={state} />
      <Section title="Leave cycle">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField idPrefix="ls" name="yearStartMonth" label="Year start" defaultValue={String(settings.year_start_month)}
            options={[{ value: '4', label: 'April (Financial Year)' }, { value: '1', label: 'January (Calendar Year)' }]} />
          <SelectField idPrefix="ls" name="carryForwardExpiry" label="Carry-forward expiry" defaultValue={settings.carry_forward_expiry}
            options={[{ value: 'year_end', label: 'End of leave year' }, { value: 'never', label: 'Never' }, { value: '12_months', label: '12 months after credit' }]}
            hint="Carried leave not used by then lapses when the next leave year starts." />
        </div>
      </Section>
      <Section title="Approval workflow">
        <p className="text-sm"><span className="text-muted">Level 1 approver:</span> <span className="font-medium">Direct manager</span> <span className="text-xs text-muted">· fixed (HR when there’s no manager)</span></p>
        <Checkbox name="skipLevelApproval" label="Enable skip-level approval" hint="Also route the request to the manager’s manager after the manager approves." defaultChecked={settings.skip_level_approval} />
      </Section>
      <Section title="Leave donation">
        <Checkbox name="donationEnabled" label="Enable peer-to-peer donation" hint="Employees can give some of their paid leave balance to a colleague." defaultChecked={settings.donation_enabled} />
      </Section>
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
    </form>
  );
}

export function EncashForm({ action, types }: { action: Action; types: Option[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  if (types.length === 0) return <p className="text-sm text-muted">None of your leave types can be encashed.</p>;
  return (
    <form action={formAction} noValidate aria-label="Encash leave" className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <SelectField idPrefix="enc" name="leaveTypeId" label="Leave type" required options={types} placeholder="Choose…" defaultValue={v.leaveTypeId ?? ''} error={e.leaveTypeId} />
        <TextField idPrefix="enc" name="days" label="Days" type="number" step="0.5" min={0.5} required defaultValue={v.days} error={e.days} />
      </div>
      <TextField idPrefix="enc" name="reason" label="Note (optional)" defaultValue={v.reason} error={e.reason} />
      <SubmitButton pendingLabel="Requesting…">Request encashment</SubmitButton>
    </form>
  );
}

export function DonateForm({ action, types, colleagues }: { action: Action; types: Option[]; colleagues: Option[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Donate leave" className="space-y-4">
      <FormMessage state={state} />
      <SelectField idPrefix="don" name="toEmployeeId" label="Colleague" required options={colleagues} placeholder="Choose…" defaultValue={v.toEmployeeId ?? ''} error={e.toEmployeeId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <SelectField idPrefix="don" name="leaveTypeId" label="From your" required options={types} placeholder="Choose…" defaultValue={v.leaveTypeId ?? ''} error={e.leaveTypeId} />
        <TextField idPrefix="don" name="days" label="Days" type="number" step="0.5" min={0.5} max={30} required defaultValue={v.days} error={e.days} />
      </div>
      <TextField idPrefix="don" name="note" label="Message (optional)" defaultValue={v.note} error={e.note} />
      <SubmitButton pendingLabel="Donating…">Donate leave</SubmitButton>
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

export function PrintButton({ label = '⬇ Download PDF' }: { label?: string }) {
  return <Button type="button" size="sm" variant="secondary" onClick={() => window.print()} className="print:hidden">{label}</Button>;
}
