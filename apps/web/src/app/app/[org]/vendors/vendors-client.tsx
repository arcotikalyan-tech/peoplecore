'use client';

import { useActionState, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export interface VendorRow {
  id: string; name: string; kind: string; pan: string | null; gstin: string | null; email: string | null; phone: string | null;
  account_holder: string | null; bank_name: string | null; account_number: string | null; ifsc: string | null;
  tds_section: string; tds_rate: number; archived_at: string | null;
}

/** Common TDS rates (Income-tax Act): the form suggests them; payroll can set any rate the vendor's case needs. */
const TDS = [
  { value: 'none', label: 'No TDS' },
  { value: '194C', label: '194C · Contractors (1% individual / 2% others)' },
  { value: '194J', label: '194J · Professional or technical fees (10% / 2%)' },
  { value: '194H', label: '194H · Commission or brokerage (2%)' },
  { value: '194I', label: '194I · Rent (10% land/building, 2% plant)' },
];

export function VendorForm({ action, vendor }: { action: Action; vendor?: VendorRow }) {
  const [section, setSection] = useState(vendor?.tds_section ?? 'none');
  const suggested: Record<string, string> = { none: '0', '194C': '2', '194J': '10', '194H': '2', '194I': '10' };
  return (
    <ActionForm action={action} label={vendor ? `Edit ${vendor.name}` : 'Add a vendor'} submit={vendor ? 'Save vendor' : '＋ Add vendor'} size="sm"
      hidden={vendor ? { vendorId: vendor.id } : undefined} className="space-y-4">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="name" label="Vendor name" required defaultValue={v.name ?? vendor?.name ?? ''} error={e.name} />
            <SelectField idPrefix={`v${vendor?.id ?? 'new'}`} name="kind" label="Type" defaultValue={v.kind ?? vendor?.kind ?? 'contractor'}
              options={[{ value: 'contractor', label: 'Contractor' }, { value: 'professional', label: 'Professional / consultant' }, { value: 'supplier', label: 'Supplier' }, { value: 'other', label: 'Other' }]} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="pan" label="PAN" defaultValue={v.pan ?? vendor?.pan ?? ''} error={e.pan} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="gstin" label="GSTIN" defaultValue={v.gstin ?? vendor?.gstin ?? ''} error={e.gstin} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="email" label="Email" type="email" defaultValue={v.email ?? vendor?.email ?? ''} error={e.email} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="phone" label="Phone" type="tel" defaultValue={v.phone ?? vendor?.phone ?? ''} error={e.phone} />
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-4"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Bank account</legend>
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="accountHolder" label="Account holder" defaultValue={v.accountHolder ?? vendor?.account_holder ?? ''} error={e.accountHolder} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="bankName" label="Bank" defaultValue={v.bankName ?? vendor?.bank_name ?? ''} error={e.bankName} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="accountNumber" label="Account number" inputMode="numeric" defaultValue={v.accountNumber ?? vendor?.account_number ?? ''} error={e.accountNumber} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="ifsc" label="IFSC" defaultValue={v.ifsc ?? vendor?.ifsc ?? ''} error={e.ifsc} />
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SelectField idPrefix={`v${vendor?.id ?? 'new'}`} name="tdsSection" label="TDS section" value={section} onChange={(ev) => setSection(ev.target.value)} options={TDS} />
            <TextField idPrefix={`v${vendor?.id ?? 'new'}`} name="tdsRate" label="TDS rate (%)" inputMode="decimal" key={section}
              defaultValue={v.tdsRate ?? (vendor && vendor.tds_section === section ? String(Number(vendor.tds_rate)) : suggested[section])} error={e.tdsRate} disabled={section === 'none'} />
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function PaymentForm({ action, vendors, today }: { action: Action; vendors: Array<{ id: string; name: string; tds: string }>; today: string }) {
  return (
    <ActionForm action={action} label="Record a vendor invoice" submit="Record invoice" size="sm" className="space-y-4">
      {(v, e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField idPrefix="vp" name="vendorId" label="Vendor" required placeholder="Choose a vendor" defaultValue={v.vendorId ?? ''} error={e.vendorId}
            options={vendors.map((x) => ({ value: x.id, label: `${x.name} · ${x.tds}` }))} />
          <TextField idPrefix="vp" name="invoiceNumber" label="Invoice number" required defaultValue={v.invoiceNumber ?? ''} error={e.invoiceNumber} />
          <TextField idPrefix="vp" name="invoiceDate" label="Invoice date" type="date" required defaultValue={v.invoiceDate ?? today} error={e.invoiceDate} />
          <TextField idPrefix="vp" name="gross" label="Invoice amount (₹)" inputMode="decimal" required defaultValue={v.gross ?? ''} error={e.gross} />
          <TextField idPrefix="vp" name="tds" label="TDS (₹, optional)" inputMode="decimal" hint="Empty: the vendor’s TDS rate" defaultValue={v.tds ?? ''} error={e.tds} />
          <TextField idPrefix="vp" name="dueDate" label="Pay by" type="date" defaultValue={v.dueDate ?? ''} error={e.dueDate} />
          <TextField idPrefix="vp" name="description" label="What it’s for" className="sm:col-span-3" defaultValue={v.description ?? ''} error={e.description} />
        </div>
      )}
    </ActionForm>
  );
}

export interface PaymentRow {
  id: string; vendor: string; invoice: string; invoiceDate: string; gross: number; tds: number; net: number; section: string;
  due: string | null; status: string; reference: string | null; paidOn: string | null; note: string | null; mine: boolean;
}

const TONES: Record<string, string> = {
  submitted: 'bg-warning-soft text-warning', approved: 'bg-primary-soft text-primary', paid: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger', rejected: 'bg-subtle text-muted', cancelled: 'bg-subtle text-muted',
};

/** Select payments, then approve / reject / mark paid / failed / cancel. */
export function PaymentBoard({ action, rows, today }: { action: Action; rows: PaymentRow[]; today: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [picked, setPicked] = useState<string[]>([]);
  // Keep the result visible when the last open payment moves on and the list empties.
  if (rows.length === 0) return <div className="space-y-3"><FormMessage state={state} /><p className="text-sm text-muted">No payments here yet.</p></div>;
  return (
    <form action={formAction} aria-label="Vendor payments" className="space-y-3">
      <FormMessage state={state} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">Vendor payments</caption>
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="w-8 py-2"><input type="checkbox" aria-label="Select all" className="accent-primary" checked={picked.length === rows.length}
              onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
            <th className="py-2 font-semibold">Vendor</th><th className="font-semibold">Invoice</th><th className="text-right font-semibold">Amount</th>
            <th className="text-right font-semibold">TDS</th><th className="text-right font-semibold">To pay</th><th className="pl-4 font-semibold">Status</th><th className="font-semibold">Pay by / paid</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2"><input type="checkbox" name="paymentId" value={r.id} aria-label={`Select ${r.vendor} ${r.invoice}`} className="accent-primary"
                  checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} /></td>
                <td className="py-2 font-medium">{r.vendor}</td>
                <td><span className="font-medium">{r.invoice}</span> <span className="text-xs text-muted">{r.invoiceDate}</span></td>
                <td className="text-right tabular-nums">{inr.format(r.gross)}</td>
                <td className="text-right tabular-nums text-muted">{r.tds ? `${inr.format(r.tds)} · ${r.section}` : '—'}</td>
                <td className="text-right font-medium tabular-nums">{inr.format(r.net)}</td>
                <td className="pl-4"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${TONES[r.status] ?? ''}`}>{r.status}</span>
                  {r.mine && r.status === 'submitted' && <span className="ml-2 text-xs text-muted">Entered by you</span>}
                  {r.note && <span className="ml-2 text-xs text-muted">{r.note}</span>}</td>
                <td className="text-muted">{r.status === 'paid' ? `${r.paidOn ?? ''}${r.reference ? ` · ${r.reference}` : ''}` : r.due ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-subtle/40 p-3">
        <SubmitButton size="sm" name="op" value="approve">Approve {picked.length || ''}</SubmitButton>
        <TextField idPrefix="pb" name="note" label="Reason (to reject)" placeholder="Wrong amount" />
        <SubmitButton size="sm" variant="secondary" name="op" value="reject">Reject</SubmitButton>
        <span className="mx-1 h-8 w-px bg-line" aria-hidden="true" />
        <TextField idPrefix="pb" name="reference" label="UTR / reference" placeholder="UTR number" />
        <TextField idPrefix="pb" name="paidOn" label="Paid on" type="date" defaultValue={today} />
        <SubmitButton size="sm" variant="secondary" name="op" value="paid">Mark paid</SubmitButton>
        <SubmitButton size="sm" variant="ghost" name="op" value="failed">Mark failed</SubmitButton>
        <SubmitButton size="sm" variant="ghost" name="op" value="cancelled">Cancel</SubmitButton>
      </div>
    </form>
  );
}
