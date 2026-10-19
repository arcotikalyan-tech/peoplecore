'use client';

import { useActionState, useMemo, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
interface Option { value: string; label: string }

const sw = 'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-subtle transition-colors has-[:checked]:bg-primary';

function Toggle({ name, label, note, defaultChecked, disabled, onChange }: { name: string; label: string; note?: string; defaultChecked?: boolean; disabled?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className={`flex items-start justify-between gap-4 py-3 ${disabled ? 'opacity-60' : ''}`}>
      <span><span className="block text-sm font-medium">{label}</span>{note && <span className="block text-xs text-muted">{note}</span>}</span>
      <span className={sw}>
        <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} disabled={disabled} aria-label={label} className="peer sr-only"
          onChange={(e) => onChange?.(e.target.checked)} />
        <span className="ml-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function ExpenseSettingsForm({ action, s, ai }: {
  action: Action; ai: boolean;
  s: { receipt_reading: boolean; multi_level: boolean; threshold: number | null; auto_finalize: boolean; finance_only: boolean; allow_skip: boolean; escalation_days: number };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [multi, setMulti] = useState(s.multi_level);
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Expense settings" className="space-y-5">
      <FormMessage state={state} />
      <fieldset className="divide-y divide-line rounded-2xl border border-line px-4">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">General</legend>
        <Toggle name="receiptReading" label="Receipt auto-fill" defaultChecked={s.receipt_reading}
          note={ai ? 'Read merchant, amount and date from an uploaded receipt (the employee checks before adding).' : 'Needs the AI assistant, which isn’t switched on for this organization.'} />
      </fieldset>
      <fieldset className="divide-y divide-line rounded-2xl border border-line px-4">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Approvals</legend>
        <Toggle name="financeOnly" label="Restrict manager approval" note="Finance approves every claim; managers don’t approve their reports’ claims." defaultChecked={s.finance_only} />
        <Toggle name="allowSkip" label="Enable skip approval" note="Finance can approve a claim directly, skipping the approvers still to act (with a reason)." defaultChecked={s.allow_skip} />
        <Toggle name="multiLevel" label="Expense multi-level approval" note="Manager, then finance. Off: the manager’s approval is final." defaultChecked={s.multi_level} onChange={setMulti} />
        <div className={`grid gap-4 py-3 sm:grid-cols-2 ${multi ? '' : 'pointer-events-none opacity-50'}`}>
          <TextField idPrefix="es" name="threshold" label="Approval threshold (₹)" inputMode="decimal" defaultValue={s.threshold ?? ''} disabled={!multi}
            hint="At or below: manager only. Above: all levels. Blank: all levels." error={e.threshold} />
          <div className="self-end"><Toggle name="autoFinalize" label="Auto-finalize after manager approval" defaultChecked={s.auto_finalize} disabled={!multi} /></div>
        </div>
        <div className="grid gap-4 py-3 sm:grid-cols-2">
          <TextField idPrefix="es" name="escalationDays" label="Auto-escalation (days)" inputMode="numeric" defaultValue={s.escalation_days}
            hint="A claim waiting longer goes to the approver’s manager (1–90)." error={e.escalationDays} />
          <div className="self-end"><Toggle name="rejectionComment" label="Mandatory rejection comment" note="Always on: employees always see why." defaultChecked disabled /></div>
        </div>
      </fieldset>
      <fieldset className="rounded-2xl border border-line px-4 py-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Currency</legend>
        <p className="text-sm">Display currency <span className="ml-2 rounded-md bg-subtle px-2 py-0.5 font-semibold">INR</span> <span className="text-xs text-muted">· claims are in Indian rupees</span></p>
      </fieldset>
      <div className="flex justify-end"><SubmitButton>Save settings</SubmitButton></div>
    </form>
  );
}

export function CategoryForm({ action, category }: {
  action: Action;
  category?: { id: string; code: string; name: string; description: string | null; requires_receipt: boolean; max_per_item: number | null; subcategories: string[] };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const p = category?.id ?? 'new';
  return (
    <form action={formAction} noValidate aria-label={category ? `Edit ${category.name}` : 'Add category'} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="categoryId" value={category?.id ?? ''} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField idPrefix={`cat${p}`} name="name" label="Category" required defaultValue={v.name ?? category?.name} error={e.name} />
        <TextField idPrefix={`cat${p}`} name="code" label="Code" required placeholder="TRAVEL" defaultValue={v.code ?? category?.code} error={e.code} />
        <TextField idPrefix={`cat${p}`} name="maxPerItem" label="Limit per item (₹)" inputMode="decimal" defaultValue={v.maxPerItem ?? category?.max_per_item ?? ''} error={e.maxPerItem} />
        <TextField idPrefix={`cat${p}`} name="subcategories" label="Sub-categories (comma-separated)" className="sm:col-span-2" placeholder="Flight, Train, Bus"
          defaultValue={v.subcategories ?? category?.subcategories.join(', ')} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="requiresReceipt" defaultChecked={category?.requires_receipt ?? true} className="size-4 accent-primary" />Receipt required</label>
        <TextField idPrefix={`cat${p}`} name="description" label="Description" className="sm:col-span-3" defaultValue={v.description ?? category?.description ?? ''} error={e.description} />
      </div>
      <div className="flex justify-end"><SubmitButton size="sm">{category ? 'Save category' : '＋ Add category'}</SubmitButton></div>
    </form>
  );
}

export function SmallAction({ action, fields, label, aria, variant = 'ghost' }: { action: Action; fields: Record<string, string>; label: string; aria?: string; variant?: 'ghost' | 'secondary' | 'primary' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
      <SubmitButton size="sm" variant={variant} pendingLabel="…" aria-label={aria}>{label}</SubmitButton>
    </form>
  );
}

export function ImportForm({ action, label, templateHref }: { action: Action; label: string; templateHref: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label} className="space-y-2 rounded-xl border border-dashed border-line p-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm"><span className="mb-1 block text-xs font-medium text-muted">{label} (CSV)</span>
          <input type="file" name="file" accept=".csv,text/csv" aria-label={`${label} file`} className="block w-full text-sm" /></label>
        <a href={templateHref} className="text-sm text-primary hover:underline" download>⬇ Template</a>
        <SubmitButton size="sm" pendingLabel="Importing…">⬆ Import</SubmitButton>
      </div>
    </form>
  );
}

/** Finance adds an expense for someone (approved, ready to pay). */
export function RecordExpenseForm({ action, people, categories, today }: {
  action: Action; people: Option[]; today: string;
  categories: Array<{ id: string; name: string; subcategories: string[] }>;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [cat, setCat] = useState('');
  const subs = categories.find((c) => c.id === cat)?.subcategories ?? [];
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Add expense" className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField idPrefix="rec" name="employeeId" label="Employee" required options={people} placeholder="Choose…" defaultValue={v.employeeId ?? ''} error={e.employeeId} />
        <SelectField idPrefix="rec" name="categoryId" label="Category" required options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose…"
          value={cat} onChange={(ev) => setCat(ev.target.value)} error={e.categoryId} />
        {subs.length > 0
          ? <SelectField idPrefix="rec" name="subcategory" label="Sub-category" options={subs.map((s) => ({ value: s, label: s }))} placeholder="—" />
          : <span className="hidden sm:block" />}
        <TextField idPrefix="rec" name="expenseDate" label="Date" type="date" required max={today} defaultValue={v.expenseDate ?? today} error={e.expenseDate} />
        <TextField idPrefix="rec" name="amount" label="Amount (₹)" required inputMode="decimal" defaultValue={v.amount} error={e.amount} />
        <TextField idPrefix="rec" name="merchant" label="Merchant" defaultValue={v.merchant} />
        <TextField idPrefix="rec" name="description" label="Notes" className="sm:col-span-3" defaultValue={v.description} />
      </div>
      <div className="flex justify-end"><SubmitButton size="sm">＋ Add Expense</SubmitButton></div>
    </form>
  );
}

export interface QueueRow { id: string; employee: string; code: string; category: string; amount: number; state: string; mode: string | null; reference: string | null; claimHref: string }

/** The payout queue: approved claims to pay (by payroll automatically, or by bank/cash now) and what was paid this cycle. */
export function PayoutQueue({ rows, bankHref, pay, canBank }: { rows: QueueRow[]; bankHref: string; pay: Action; canBank: boolean }) {
  const [state, formAction] = useActionState(pay, initialActionState);
  const ready = rows.filter((r) => r.state === 'Approved');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'bank' | 'cash'>('bank');
  const total = useMemo(() => ready.filter((r) => picked.has(r.id)).reduce((a, r) => a + r.amount, 0), [ready, picked]);
  const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Payout queue">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all ready to pay" className="size-4 accent-primary" checked={ready.length > 0 && picked.size === ready.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(ready.map((r) => r.id)) : new Set())} /></th>
              <th className="px-3">Employee</th><th className="px-3">Category</th><th className="px-3 text-right">Amount</th><th className="px-3">Mode</th><th className="px-3">Status</th><th className="px-3">Action</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted">💸 No payout entries. Approved claims ready for reimbursement show up here.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.state === 'Approved' && <input type="checkbox" aria-label={`Select ${r.employee} ${fmt(r.amount)}`} className="size-4 accent-primary" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                <td className="px-3"><span className="font-medium">{r.employee}</span><span className="block text-xs text-muted">{r.code}</span></td>
                <td className="px-3">{r.category}</td>
                <td className="px-3 text-right tabular-nums">{fmt(r.amount)}</td>
                <td className="px-3">{r.state === 'Approved' ? 'Payroll (next run)' : r.mode === 'bank' ? `Bank${r.reference ? ` · ${r.reference}` : ''}` : r.mode === 'cash' ? 'Cash' : 'Payroll'}</td>
                <td className="px-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.state === 'Approved' ? 'bg-primary-soft text-primary' : 'bg-success/15 text-success'}`}>{r.state === 'Approved' ? 'Awaiting payout' : 'Paid'}</span></td>
                <td className="px-3"><a className="text-primary hover:underline" href={r.claimHref}>Open</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ready.length > 0 && (
        <form action={formAction} aria-label="Pay selected claims" className="space-y-2 rounded-xl border border-line p-3">
          <FormMessage state={state} />
          {[...picked].map((id) => <input key={id} type="hidden" name="claimId" value={id} />)}
          <p className="text-sm"><span className="font-semibold">{picked.size}</span> selected · <span className="tabular-nums">{fmt(total)}</span>
            <span className="text-muted"> — unselected claims are paid with the next payroll automatically.</span></p>
          <div className="flex flex-wrap items-end gap-2">
            {canBank && <a aria-disabled={picked.size === 0} className={`rounded-lg border border-line px-3 py-2 text-sm font-medium ${picked.size ? 'hover:bg-subtle' : 'pointer-events-none opacity-50'}`}
              href={`${bankHref}?claims=${[...picked].join(',')}`} download>↓ Bank file</a>}
            <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted">Paid by</span>
              <select name="mode" aria-label="Paid by" value={mode} onChange={(e) => setMode(e.target.value as 'bank' | 'cash')} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
                <option value="bank">Bank transfer</option><option value="cash">Cash</option></select></label>
            {mode === 'bank' && <label className="text-sm"><span className="mb-1 block text-xs font-medium text-muted">Bank reference (UTR)</span>
              <input name="reference" aria-label="Bank reference" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" /></label>}
            <SubmitButton size="sm" pendingLabel="Saving…">Mark selected as paid</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

/** Ask the employee for more information (claim stays pending). */
export function HoldForm({ action, claimId }: { action: Action; claimId: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Put on hold" className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="claimId" value={claimId} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField idPrefix={`hold-${claimId}`} name="note" label="Need more information?" placeholder="e.g. Which client was this for?" className="min-w-56 flex-1" error={state.fieldErrors?.note} />
        <SubmitButton size="sm" variant="secondary">⏸ Put on hold</SubmitButton>
      </div>
    </form>
  );
}

export function ReplyForm({ action, claimId }: { action: Action; claimId: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Answer" className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="claimId" value={claimId} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField idPrefix="reply" name="reply" label="Your answer" className="min-w-56 flex-1" error={state.fieldErrors?.reply} />
        <SubmitButton size="sm">Send answer</SubmitButton>
      </div>
    </form>
  );
}

export function FinalizeForm({ action, claimId }: { action: Action; claimId: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setOpen(true)}>⏭ Approve as finance (skip remaining approvers)</button>;
  return (
    <form action={formAction} aria-label="Skip approvers" className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="claimId" value={claimId} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField idPrefix="skip" name="comment" label="Why skip the remaining approvers?" className="min-w-56 flex-1" error={state.fieldErrors?.comment} />
        <SubmitButton size="sm">Approve now</SubmitButton>
      </div>
    </form>
  );
}
