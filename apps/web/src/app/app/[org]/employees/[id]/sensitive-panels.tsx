'use client';

import { useActionState, useState } from 'react';
import { BANK_ACCOUNT_TYPES, BANK_ACCOUNT_TYPE_LABELS } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/fields';
import { DetailList } from '@/components/ui/surface';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { formatDate } from '@/lib/format';
import type { BankValues, IdentityValues, RevealState } from './actions';

type RevealAction<T> = (prev: RevealState<T>, formData: FormData) => Promise<RevealState<T>>;
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const AUDIT_NOTE = 'Showing full numbers is recorded in the audit log.';

function RevealButton({ action, intent, label, onSubmit }: { action: (fd: FormData) => void; intent: 'view' | 'edit'; label: string; onSubmit: () => void }) {
  return (
    <form action={action} onSubmit={onSubmit}>
      <input type="hidden" name="intent" value={intent} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Loading…">{label}</SubmitButton>
    </form>
  );
}

export interface IdentitySummaryView {
  pan: string | null;
  aadhaar_last4: string | null;
  uan: string | null;
  esic_number: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  can_edit: boolean;
}

export function IdentityPanel({ summary, reveal, save }: { summary: IdentitySummaryView; reveal: RevealAction<IdentityValues>; save: RevealAction<IdentityValues> }) {
  const [revealed, revealAction] = useActionState<RevealState<IdentityValues>, FormData>(reveal, { ok: false });
  const [saved, saveAction] = useActionState<RevealState<IdentityValues>, FormData>(save, { ok: false });
  const [hidden, setHidden] = useState(false);
  const open = revealed.ok && !hidden;
  const mode = !open ? 'masked' : revealed.intent === 'edit' ? 'editing' : 'shown';
  const hasAny = Boolean(summary.pan || summary.aadhaar_last4 || summary.uan || summary.esic_number || summary.passport_number);

  if (mode === 'editing') {
    const current = revealed.revealed;
    const failed = saved.ok ? {} : (saved.values ?? {});
    const e = saved.fieldErrors ?? {};
    const val = (key: string, fallback: string | null | undefined) => failed[key] ?? fallback ?? '';
    return (
      <form action={saveAction} noValidate className="space-y-4 px-5 py-4">
        <FormMessage state={saved} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField idPrefix="id" name="pan" label="PAN" autoComplete="off" defaultValue={val('pan', current?.pan)} error={e.pan} />
          <TextField idPrefix="id" name="aadhaarLast4" label="Aadhaar (last 4 digits only)" inputMode="numeric" maxLength={4} autoComplete="off" defaultValue={val('aadhaarLast4', current?.aadhaar_last4)} error={e.aadhaarLast4} hint="Full Aadhaar numbers are never stored." />
          <TextField idPrefix="id" name="uan" label="UAN (PF)" inputMode="numeric" autoComplete="off" defaultValue={val('uan', current?.uan)} error={e.uan} />
          <TextField idPrefix="id" name="esicNumber" label="ESIC number" inputMode="numeric" autoComplete="off" defaultValue={val('esicNumber', current?.esic_number)} error={e.esicNumber} />
          <TextField idPrefix="id" name="passportNumber" label="Passport number" autoComplete="off" defaultValue={val('passportNumber', current?.passport_number)} error={e.passportNumber} />
          <TextField idPrefix="id" name="passportExpiry" label="Passport expiry" type="date" defaultValue={val('passportExpiry', current?.passport_expiry)} error={e.passportExpiry} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setHidden(true)}>Cancel</Button>
          <SubmitButton>Save identity details</SubmitButton>
        </div>
      </form>
    );
  }

  const shown = mode === 'shown' ? revealed.revealed : null;
  const pick = (full: string | null | undefined, masked: string | null) => (mode === 'shown' ? (full ?? null) : masked);
  return (
    <div>
      {!hasAny ? (
        <p className="px-5 py-4 text-sm text-muted">No identity details recorded.</p>
      ) : (
        <DetailList
          items={[
            { label: 'PAN', value: pick(shown?.pan, summary.pan) },
            { label: 'Aadhaar', value: summary.aadhaar_last4 ? `XXXX XXXX ${summary.aadhaar_last4}` : null },
            { label: 'UAN (PF)', value: pick(shown?.uan, summary.uan) },
            { label: 'ESIC number', value: pick(shown?.esic_number, summary.esic_number) },
            { label: 'Passport', value: pick(shown?.passport_number, summary.passport_number) },
            { label: 'Passport expiry', value: summary.passport_expiry ? formatDate(summary.passport_expiry) : null },
          ]}
        />
      )}
      {revealed.message && !revealed.ok && <p role="alert" className="px-5 text-xs text-danger">{revealed.message}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <span className="mr-auto text-xs text-muted">{AUDIT_NOTE}</span>
        {hasAny && (mode === 'shown'
          ? <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>Hide</Button>
          : <RevealButton action={revealAction} intent="view" label="Show full numbers" onSubmit={() => setHidden(false)} />)}
        {summary.can_edit && <RevealButton action={revealAction} intent="edit" label={hasAny ? 'Edit' : 'Add identity details'} onSubmit={() => setHidden(false)} />}
      </div>
    </div>
  );
}

export interface BankSummaryView {
  account_holder_name: string | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  account_type: string | null;
  since: string | null;
  previous_accounts: number;
  can_edit: boolean;
}

const accountTypes = BANK_ACCOUNT_TYPES.map((t) => ({ value: t, label: BANK_ACCOUNT_TYPE_LABELS[t] }));

export function BankPanel({ summary, reveal, save }: { summary: BankSummaryView; reveal: RevealAction<BankValues>; save: Action }) {
  const [revealed, revealAction] = useActionState<RevealState<BankValues>, FormData>(reveal, { ok: false });
  const [saved, saveAction] = useActionState(save, initialActionState);
  const [hidden, setHidden] = useState(false);
  const [changing, setChanging] = useState(false);
  const hasAccount = Boolean(summary.account_number);
  const shown = revealed.ok && !hidden ? revealed.revealed : null;

  if (changing) {
    const v = saved.ok ? {} : (saved.values ?? {});
    const e = saved.fieldErrors ?? {};
    return (
      <form action={saveAction} noValidate className="space-y-4 px-5 py-4">
        <FormMessage state={saved} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField idPrefix="bank" name="accountHolderName" label="Account holder name" required defaultValue={v.accountHolderName} error={e.accountHolderName} />
          <TextField idPrefix="bank" name="bankName" label="Bank name" required defaultValue={v.bankName} error={e.bankName} />
          <TextField idPrefix="bank" name="accountNumber" label="Account number" inputMode="numeric" autoComplete="off" required defaultValue={v.accountNumber} error={e.accountNumber} />
          <TextField idPrefix="bank" name="confirmAccountNumber" label="Confirm account number" inputMode="numeric" autoComplete="off" required defaultValue={v.confirmAccountNumber} error={e.confirmAccountNumber} />
          <TextField idPrefix="bank" name="ifsc" label="IFSC" autoComplete="off" required placeholder="HDFC0001234" defaultValue={v.ifsc} error={e.ifsc} />
          <SelectField idPrefix="bank" name="accountType" label="Account type" options={accountTypes} defaultValue={v.accountType ?? 'savings'} error={e.accountType} />
        </div>
        <p className="text-xs text-muted">The current account will be archived and kept for payment history.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setChanging(false)}>Cancel</Button>
          <SubmitButton>Save bank account</SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <div>
      {!hasAccount ? (
        <p className="px-5 py-4 text-sm text-muted">No bank account recorded.</p>
      ) : (
        <DetailList
          items={[
            { label: 'Account holder', value: summary.account_holder_name },
            { label: 'Bank', value: summary.bank_name },
            { label: 'Account number', value: shown?.account_number ?? summary.account_number },
            { label: 'IFSC', value: summary.ifsc },
            { label: 'Type', value: summary.account_type ? BANK_ACCOUNT_TYPE_LABELS[summary.account_type as keyof typeof BANK_ACCOUNT_TYPE_LABELS] : null },
            { label: 'Since', value: summary.since ? formatDate(summary.since) : null },
          ]}
        />
      )}
      {summary.previous_accounts > 0 && (
        <p className="px-5 text-xs text-muted">{summary.previous_accounts} earlier account{summary.previous_accounts === 1 ? '' : 's'} archived.</p>
      )}
      {revealed.message && !revealed.ok && <p role="alert" className="px-5 text-xs text-danger">{revealed.message}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <span className="mr-auto text-xs text-muted">{AUDIT_NOTE}</span>
        {hasAccount && (shown
          ? <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>Hide</Button>
          : <RevealButton action={revealAction} intent="view" label="Show full number" onSubmit={() => setHidden(false)} />)}
        {summary.can_edit && <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>{hasAccount ? 'Change bank account' : 'Add bank account'}</Button>}
      </div>
    </div>
  );
}
