'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { computeAll, ENGINE_VERSION, fetchInputs } from '@/server/payroll';
import { createClient } from '@/server/supabase';

/** Payroll actions. The database enforces payroll.prepare / payroll.approve, maker ≠ checker and immutability. */

const runId = z.uuid();
const err = (e: unknown): ActionState => ({ ok: false, message: toUserMessage(e as { code?: string; message?: string }) });

export async function createRunAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(formData.get('month'));
  if (!month.success) return { ok: false, message: 'Choose a month.', values: formValues(formData) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_payroll_run', {
    p_org: ctx.org.id, p_month: `${month.data}-01`, p_lop_from_absence: formData.get('lopFromAbsence') === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  redirect(`/app/${orgSlug}/payroll/${data}`);
}

export async function computeRunAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = runId.parse(formData.get('runId'));
  try {
    const { inputs, hash } = await fetchInputs(id);
    const results = computeAll(inputs);
    const supabase = await createClient();
    const { error } = await supabase.rpc('store_payroll_results', { p_run: id, p_engine_version: ENGINE_VERSION, p_inputs_hash: hash, p_results: results as never });
    if (error) return err(error);
    revalidatePath(`/app/${orgSlug}/payroll`, 'layout');
    const blocking = results.filter((r) => r.exceptions.some((e) => e.blocking)).length;
    return { ok: blocking === 0, message: `Computed ${results.length} payslips.${blocking ? ` ${blocking} need attention before approval.` : ''}` };
  } catch (e) {
    return err(e);
  }
}

/** The checker reproduces the run from the current inputs; approval names that fingerprint. */
export async function approveRunAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = runId.parse(formData.get('runId'));
  try {
    const { hash } = await fetchInputs(id);
    const supabase = await createClient();
    const { error } = await supabase.rpc('approve_payroll_run', { p_run: id, p_inputs_hash: hash });
    if (error) return err(error);
    revalidatePath(`/app/${orgSlug}/payroll`, 'layout');
    return { ok: true, message: 'Approved. Lock the run to release payslips.' };
  } catch (e) {
    return err(e);
  }
}

export async function lockRunAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const supabase = await createClient();
  const { error } = await supabase.rpc('lock_payroll_run', { p_run: runId.parse(formData.get('runId')) });
  if (error) return err(error);
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Locked. Payslips are released and the bank file is available.' };
}

export async function cancelRunAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_payroll_run', { p_run: runId.parse(formData.get('runId')) });
  if (error) return err(error);
  revalidatePath(`/app/${orgSlug}/payroll`, 'layout');
  return { ok: true, message: 'Run cancelled.' };
}

const compensationSchema = z.object({
  employeeId: z.uuid(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  note: z.string().trim().max(500).optional(),
});

export async function setCompensationAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = compensationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Check the form.', fieldErrors: { effectiveFrom: 'Choose a date' }, values: formValues(formData) };
  const lines = [...formData.entries()]
    .filter(([k, v]) => k.startsWith('component:') && typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => ({ component_id: k.slice('component:'.length), monthly_amount: Number(v) }));
  if (lines.some((l) => !Number.isFinite(l.monthly_amount) || l.monthly_amount < 0)) {
    return { ok: false, message: 'Amounts must be positive numbers.', values: formValues(formData) };
  }
  const monthly = lines.reduce((s, l) => s + l.monthly_amount, 0);
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_compensation', {
    p_employee: parsed.data.employeeId, p_effective_from: parsed.data.effectiveFrom, p_annual_ctc: monthly * 12, p_lines: lines,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/employees/${parsed.data.employeeId}`);
  return { ok: true, message: 'Compensation saved.' };
}

export async function setStatutoryAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    employeeId: z.uuid(),
    pf: z.enum(['yes', 'no']),
    esi: z.enum(['auto', 'yes', 'no']),
    ptState: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Check the form (state is a 2-letter code, e.g. KA).', values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('employee_statutory_profiles').upsert({
    organization_id: ctx.org.id, employee_id: parsed.data.employeeId, pf_applicable: parsed.data.pf === 'yes',
    esi_applicable: parsed.data.esi === 'auto' ? null : parsed.data.esi === 'yes', pt_state: parsed.data.ptState ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/employees/${parsed.data.employeeId}`);
  return { ok: true, message: 'Statutory settings saved.' };
}

const adjustmentSchema = z.object({
  employeeId: z.uuid({ error: 'Choose an employee' }),
  type: z.enum(['ARREAR', 'BONUS', 'RECOVERY', 'OTHER_DEDUCTION']),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(99_999_999),
  reason: z.string().trim().min(3, 'Say what it is for').max(500),
});
const ADJUSTMENT_TYPES = {
  ARREAR: { name: 'Salary arrears', kind: 'earning', taxable: true },
  BONUS: { name: 'Bonus', kind: 'earning', taxable: true },
  RECOVERY: { name: 'Recovery', kind: 'deduction', taxable: false },
  OTHER_DEDUCTION: { name: 'Other deduction', kind: 'deduction', taxable: false },
} as const;

export async function addAdjustmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('payroll.prepare', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])), values: formValues(formData) };
  }
  const t = ADJUSTMENT_TYPES[parsed.data.type];
  const supabase = await createClient();
  const { error } = await supabase.from('payroll_adjustments').insert({
    organization_id: ctx.org.id, employee_id: parsed.data.employeeId, code: parsed.data.type, name: t.name, kind: t.kind,
    amount: parsed.data.amount, taxable: t.taxable, reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/payroll`);
  return { ok: true, message: 'Adjustment recorded. It will be paid (or recovered) in the next run.' };
}

export async function removeAdjustmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('adjustmentId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('payroll_adjustments').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/payroll`);
  return { ok: true, message: 'Removed.' };
}
