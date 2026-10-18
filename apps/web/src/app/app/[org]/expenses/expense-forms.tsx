'use client';

import { startTransition, useActionState, useRef, useState } from 'react';
import type { ReceiptResult } from '@peoplecore/ai';
import { ActionForm } from '@/components/action-form';
import { AiSuggestion } from '@/components/ai-suggestion';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import { Alert, Badge } from '@/components/ui/surface';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function NewClaimForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} label="New claim" submit="Start claim" className="space-y-4 px-5 py-5">
      {(v, e) => <TextField idPrefix="claim" name="title" label="What is it for?" required placeholder="Client visit, Pune" defaultValue={v.title} error={e.title} />}
    </ActionForm>
  );
}

export interface ReceiptState extends ActionState {
  result?: ReceiptResult;
  suggestionId?: string;
}

/**
 * Add an expense. With `read`, the chosen receipt can be read by AI first: what it found is shown as a
 * suggestion, and "Fill in" copies it into the fields for the employee to check before adding.
 */
export function AddItemForm({ action, read, claimId, categories, today }: {
  action: Action; read?: (prev: ReceiptState, formData: FormData) => Promise<ReceiptState>; claimId: string; categories: Option[]; today: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, initialActionState);
  const [readState, readAction, reading] = useActionState<ReceiptState, FormData>(read ?? (async () => ({ ok: false })), initialActionState);
  const [filled, setFilled] = useState<ReceiptState | null>(null);
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  const r = readState.ok && readState.result?.isReceipt ? readState.result : null;
  const label = (id: string | null) => categories.find((c) => c.value === id)?.label ?? null;

  const readReceipt = () => {
    const file = (formRef.current?.elements.namedItem('receipt') as HTMLInputElement | null)?.files?.[0];
    const fd = new FormData();
    if (file) fd.set('receipt', file);
    startTransition(() => readAction(fd));
  };
  const fill = () => {
    if (!r) return;
    const set = (name: string, value: string | number | null) => {
      const el = formRef.current?.elements.namedItem(name);
      if (value != null && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) el.value = String(value);
    };
    set('categoryId', r.categoryId);
    set('expenseDate', r.date);
    set('amount', r.currency === 'INR' || r.currency === null ? r.total : null);
    set('merchant', r.merchant);
    setFilled(readState);
  };

  return (
    <form ref={formRef} action={formAction} noValidate aria-label="Add an expense" className="space-y-4 border-t border-line px-5 py-5">
      <FormMessage state={state} />
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="suggestionId" value={filled?.suggestionId ?? ''} />
      <div className="space-y-2">
        <TextField idPrefix="item" name="receipt" label="Receipt" type="file" accept="application/pdf,image/jpeg,image/png"
          hint="PDF, JPEG or PNG up to 5 MB. Required for most categories." error={e.receipt} className="[&_input]:h-auto [&_input]:py-2" />
        {read && <Button type="button" size="sm" variant="secondary" onClick={readReceipt} disabled={reading}>{reading ? 'Reading…' : 'Read the receipt with AI'}</Button>}
        {!readState.ok && readState.message && <FormMessage state={readState} />}
        {readState.ok && readState.result && !readState.result.isReceipt && <Alert tone="warning" title="That doesn’t look like a receipt." />}
        {r && (
          <AiSuggestion title="Read from the receipt" note="Check the amount and date before adding."
            actions={filled === readState ? <span className="text-xs text-muted">Filled in below. Check it, then add the expense.</span>
              : <Button type="button" size="sm" onClick={fill}>Fill in the form</Button>}>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-4" aria-label="Fields read">
              {[['Merchant', r.merchant, 'merchant'], ['Date', r.date, 'date'], ['Amount', r.total != null ? `${r.currency ?? ''} ${r.total.toLocaleString('en-IN')}`.trim() : null, 'total'],
                ['Category', label(r.categoryId), 'category']].map(([name, value, key]) => (
                <div key={name} className="min-w-0">
                  <dt className="text-xs text-muted">{name}</dt>
                  <dd className="truncate">{value ?? <span className="text-muted">Not found</span>}
                    {r.lowConfidence.includes(key as never) && <> <Badge tone="warning">Check</Badge></>}</dd>
                </div>
              ))}
            </dl>
            {r.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-warning" aria-label="To check">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          </AiSuggestion>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField idPrefix="item" name="categoryId" label="Category" required options={categories} placeholder="Choose…" defaultValue={v.categoryId ?? ''} error={e.categoryId} />
        <TextField idPrefix="item" name="expenseDate" label="Date" type="date" required max={today} defaultValue={v.expenseDate ?? today} error={e.expenseDate} />
        <TextField idPrefix="item" name="amount" label="Amount (₹)" required inputMode="decimal" defaultValue={v.amount} error={e.amount} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField idPrefix="item" name="merchant" label="Merchant" defaultValue={v.merchant} />
        <TextField idPrefix="item" name="description" label="Notes" defaultValue={v.description} />
      </div>
      <SubmitButton pendingLabel="Adding…">Add expense</SubmitButton>
    </form>
  );
}

export function SmallForm({ action, label, submit, hidden, variant = 'ghost' }: { action: Action; label: string; submit: string; hidden: Record<string, string>; variant?: 'primary' | 'ghost' }) {
  return <ActionForm action={action} label={label} submit={submit} hidden={hidden} variant={variant} size={variant === 'ghost' ? 'sm' : 'md'} className="inline-flex flex-wrap items-center gap-2" />;
}
