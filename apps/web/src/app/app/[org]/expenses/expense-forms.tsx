'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function NewClaimForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} label="New claim" submit="Start claim" className="space-y-4 px-5 py-5">
      {(v, e) => <TextField idPrefix="claim" name="title" label="What is it for?" required placeholder="Client visit, Pune" defaultValue={v.title} error={e.title} />}
    </ActionForm>
  );
}

export function AddItemForm({ action, claimId, categories, today }: { action: Action; claimId: string; categories: Option[]; today: string }) {
  return (
    <ActionForm action={action} label="Add an expense" submit="Add expense" hidden={{ claimId }} className="space-y-4 border-t border-line px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField idPrefix="item" name="categoryId" label="Category" required options={categories} placeholder="Choose…" defaultValue={v.categoryId ?? ''} error={e.categoryId} />
            <TextField idPrefix="item" name="expenseDate" label="Date" type="date" required max={today} defaultValue={v.expenseDate ?? today} error={e.expenseDate} />
            <TextField idPrefix="item" name="amount" label="Amount (₹)" required inputMode="decimal" defaultValue={v.amount} error={e.amount} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="item" name="merchant" label="Merchant" defaultValue={v.merchant} />
            <TextField idPrefix="item" name="description" label="Notes" defaultValue={v.description} />
          </div>
          <TextField idPrefix="item" name="receipt" label="Receipt" type="file" accept="application/pdf,image/jpeg,image/png"
            hint="PDF, JPEG or PNG up to 5 MB. Required for most categories." error={e.receipt} className="[&_input]:h-auto [&_input]:py-2" />
        </>
      )}
    </ActionForm>
  );
}

export function SmallForm({ action, label, submit, hidden, variant = 'ghost' }: { action: Action; label: string; submit: string; hidden: Record<string, string>; variant?: 'primary' | 'ghost' }) {
  return <ActionForm action={action} label={label} submit={submit} hidden={hidden} variant={variant} size={variant === 'ghost' ? 'sm' : 'md'} className="inline-flex flex-wrap items-center gap-2" />;
}
