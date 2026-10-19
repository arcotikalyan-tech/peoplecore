'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Loans and salary advances. The database checks eligibility, who may decide, disburse and foreclose. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const back = (slug: string) => revalidatePath(`/app/${slug}/loans`, 'layout');

export async function applyLoanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const parsed = z.object({
    kind: z.enum(['loan', 'advance']),
    amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(99_999_999),
    tenure: z.coerce.number({ error: 'Choose the tenure' }).int().min(1, 'At least 1 month').max(120),
    purpose: z.string().trim().min(3, 'Say what it’s for').max(500),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_loan', { p_org: ctx.org.id, p_kind: v.kind, p_amount: v.amount, p_tenure: v.tenure, p_purpose: v.purpose });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  await flash('Application sent. Your manager approves first, then payroll.');
  redirect(`/app/${slug}/loans/${data}`);
}

export async function cancelLoanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('loanId'));
  if (!id.success) return { ok: false, message: 'Loan not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_loan', { p_loan: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash('Application withdrawn.');
  return { ok: true, message: 'Application withdrawn.' };
}

export async function disburseLoanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({
    loanId: z.uuid(),
    mode: z.enum(['bank', 'cash', 'payroll']),
    reference: optional(z.string().trim().max(80)),
    firstEmi: z.string().regex(/^\d{4}-\d{2}$/, 'Choose the month'),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('disburse_loan', { p_loan: v.loanId, p_mode: v.mode, p_reference: sqlNull(v.reference), p_first_emi: `${v.firstEmi}-01` });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  await flash(v.mode === 'payroll' ? 'Disbursed with the next payroll run. EMIs are scheduled.' : 'Disbursed. EMIs are scheduled and deducted through payroll.');
  return { ok: true, message: 'Disbursed.' };
}

export async function forecloseLoanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({ loanId: z.uuid(), note: z.string().trim().min(3, 'Say how the balance was settled').max(180) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('foreclose_loan', { p_loan: parsed.data.loanId, p_note: parsed.data.note });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  const message = `Loan closed. ₹${Number(data).toLocaleString('en-IN')} of principal was settled outside payroll.`;
  await flash(message);
  return { ok: true, message };
}

export async function saveLoanSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('payroll.approve', 'org')) return DENIED;
  const parsed = z.object({
    interestRate: z.coerce.number({ error: 'Enter a rate' }).min(0, '0 to 36%').max(36, '0 to 36%'),
    maxAmount: z.coerce.number({ error: 'Enter an amount' }).positive('Enter an amount').max(99_999_999),
    salaryMultiple: z.coerce.number({ error: 'Enter a multiple' }).positive('Above 0').max(24, 'Up to 24'),
    maxTenure: z.coerce.number({ error: 'Enter months' }).int().min(1).max(120, 'Up to 120 months'),
    maxEmiPercent: z.coerce.number({ error: 'Enter a percentage' }).int().min(5, '5 to 100%').max(100, '5 to 100%'),
    minService: z.coerce.number({ error: 'Enter months' }).int().min(0).max(120),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('loan_settings').update({
    enabled: formData.get('enabled') === 'on', allow_multiple: formData.get('allowMultiple') === 'on', interest_rate: v.interestRate,
    max_amount: v.maxAmount, salary_multiple: v.salaryMultiple, max_tenure_months: v.maxTenure, max_emi_percent: v.maxEmiPercent, min_service_months: v.minService,
  }).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Loan policy saved.' };
}

/** Decide a loan application from its page; the decision panel goes away, so the result is flashed. */
export async function decideLoanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({ requestId: z.uuid(), decision: z.enum(['approve', 'reject']), comment: z.string().trim().max(1000).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  if (parsed.data.decision === 'reject' && !parsed.data.comment) {
    return { ok: false, message: 'Give a reason when rejecting.', fieldErrors: { comment: 'Required when rejecting' } };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_approval', { p_request: parsed.data.requestId, p_decision: parsed.data.decision, p_comment: parsed.data.comment });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${slug}`, 'layout');
  const message = data === 'pending' ? 'Approved. It moves to the next approver.' : data === 'approved' ? 'Approved. Payroll can disburse it now.' : 'Rejected.';
  await flash(message);
  return { ok: true, message };
}
