'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Vendor payouts. The database checks vendor.manage and maker ≠ checker on every write. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s.optional());
const done = (slug: string, message: string): ActionState => { revalidatePath(`/app/${slug}/vendors`); return { ok: true, message }; };
const failed = (e: { code?: string; message?: string }, formData?: FormData): ActionState =>
  ({ ok: false, message: toUserMessage(e), values: formData ? formValues(formData) : undefined });

const vendorSchema = z.object({
  vendorId: optional(z.uuid()),
  name: z.string().trim().min(2, 'Enter the vendor’s name').max(160),
  kind: z.enum(['contractor', 'professional', 'supplier', 'other']),
  pan: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Like ABCDE1234F')),
  gstin: optional(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, 'A 15-character GSTIN')),
  email: optional(z.email('Enter a valid email')),
  phone: optional(z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, 'Digits, spaces and dashes')),
  accountHolder: optional(z.string().trim().min(2).max(160)),
  bankName: optional(z.string().trim().max(120)),
  accountNumber: optional(z.string().trim().regex(/^[0-9]{6,18}$/, '6–18 digits')),
  ifsc: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Like HDFC0001234')),
  tdsSection: z.enum(['none', '194C', '194J', '194H', '194I']),
  tdsRate: z.coerce.number().min(0, '0–30').max(30, '0–30'),
});

export async function saveVendorAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('vendor.manage', 'org')) return DENIED;
  const p = vendorSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const v = p.data;
  const row = {
    organization_id: ctx.org.id, name: v.name, kind: v.kind, pan: v.pan ?? null, gstin: v.gstin ?? null, email: v.email ?? null, phone: v.phone ?? null,
    account_holder: v.accountHolder ?? null, bank_name: v.bankName ?? null, account_number: v.accountNumber ?? null, ifsc: v.ifsc ?? null,
    tds_section: v.tdsSection, tds_rate: v.tdsSection === 'none' ? 0 : v.tdsRate,
  };
  const supabase = await createClient();
  const { error } = v.vendorId
    ? await supabase.from('vendors').update(row).eq('id', v.vendorId).eq('organization_id', ctx.org.id)
    : await supabase.from('vendors').insert(row);
  if (error) return error.code === '23505' ? { ok: false, message: 'A vendor with this name already exists.', values: formValues(formData) } : failed(error, formData);
  return done(slug, v.vendorId ? 'Vendor saved.' : `${v.name} added.`);
}

export async function archiveVendorAction(slug: string, vendorId: string, archive: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('vendor.manage', 'org') || !z.uuid().safeParse(vendorId).success) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.from('vendors').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', vendorId).eq('organization_id', ctx.org.id);
  if (error) return failed(error);
  return done(slug, archive ? 'Vendor archived.' : 'Vendor restored.');
}

export async function recordPaymentAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('vendor.manage', 'org')) return DENIED;
  const p = z.object({
    vendorId: z.uuid('Choose a vendor'), invoiceNumber: z.string().trim().min(1, 'Enter the invoice number').max(60), invoiceDate: date,
    gross: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(99_999_999), dueDate: optional(date),
    description: optional(z.string().trim().max(300)), tds: optional(z.coerce.number().min(0)),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_vendor_payment', {
    p_org: ctx.org.id, p_vendor: p.data.vendorId, p_invoice_number: p.data.invoiceNumber, p_invoice_date: p.data.invoiceDate, p_gross: p.data.gross,
    p_description: sqlNull(p.data.description), p_due_date: sqlNull(p.data.dueDate), p_tds: sqlNull(p.data.tds),
  });
  if (error) return error.code === '23505' ? { ok: false, message: 'This invoice is already recorded for the vendor.', values: formValues(formData) } : failed(error, formData);
  return done(slug, `Invoice ${p.data.invoiceNumber} recorded. Someone else approves it before it’s paid.`);
}

/** Selected payments: approve, reject (with a reason), mark paid (UTR, date) or failed, or cancel. */
export async function paymentsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('vendor.manage', 'org')) return DENIED;
  const ids = formData.getAll('paymentId').map(String).filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return { ok: false, message: 'Select at least one payment.' };
  const op = z.enum(['approve', 'reject', 'paid', 'failed', 'cancelled']).safeParse(formData.get('op'));
  if (!op.success) return { ok: false, message: 'Invalid request.' };
  const note = String(formData.get('note') ?? '').trim();
  const supabase = await createClient();
  const result = op.data === 'approve' || op.data === 'reject'
    ? await supabase.rpc('decide_vendor_payments', { p_org: ctx.org.id, p_ids: ids, p_approve: op.data === 'approve', p_note: note || sqlNull<string>(null) })
    : await supabase.rpc('update_vendor_payments', {
      p_org: ctx.org.id, p_ids: ids, p_status: op.data, p_reference: String(formData.get('reference') ?? '').trim() || sqlNull<string>(null),
      p_paid_on: date.safeParse(formData.get('paidOn')).success ? String(formData.get('paidOn')) : sqlNull<string>(null),
    });
  if (result.error) return failed(result.error);
  const n = result.data as number;
  const verb = { approve: 'Approved', reject: 'Rejected', paid: 'Marked paid', failed: 'Marked failed', cancelled: 'Cancelled' }[op.data];
  return done(slug, n === 0 ? 'Nothing changed: none of the selected payments can move to that status.' : `${verb} ${n} payment${n === 1 ? '' : 's'}.`);
}
