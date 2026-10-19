'use server';

import { revalidatePath } from 'next/cache';
import { structureBreakup, type StructureLine } from '@peoplecore/payroll';
import { z } from 'zod';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';
import type { Database } from '@peoplecore/db/types';

/**
 * Payroll workspace actions. Every write is checked again by the database (permissions, maker ≠ checker,
 * frozen months); these only shape the input and report the outcome.
 */

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const money = (label: string) => z.coerce.number({ error: `Enter ${label}` }).finite().min(0, `${label} can’t be negative`).max(99_999_999);
const optionalNumber = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().finite().min(0).nullable());
const done = (slug: string, message: string): ActionState => { revalidatePath(`/app/${slug}/payroll`); return { ok: true, message }; };
/** For actions whose form disappears once they succeed: the message survives as a page-level notice. */
const doneFlash = async (slug: string, message: string): Promise<ActionState> => { await flash(message); return done(slug, message); };
const failed = (e: { code?: string; message?: string }, formData?: FormData): ActionState =>
  ({ ok: false, message: toUserMessage(e), values: formData ? formValues(formData) : undefined });
const invalid = (error: z.ZodError, formData: FormData): ActionState => ({
  ok: false, message: 'Please fix the highlighted fields.', values: formValues(formData),
  fieldErrors: Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message])),
});

// ─── Cycle ─────────────────────────────────────────────────────────────────

export async function startCycleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const m = month.safeParse(formData.get('month'));
  if (!m.success) return { ok: false, message: 'Choose a month.' };
  const supabase = await createClient();
  const { data: settings } = await supabase.from('payroll_settings').select('lop_from_absence').eq('organization_id', ctx.org.id).maybeSingle();
  const { error } = await supabase.rpc('create_payroll_run', { p_org: ctx.org.id, p_month: m.data, p_lop_from_absence: settings?.lop_from_absence ?? false });
  if (error) return failed(error);
  return doneFlash(slug, 'Payroll cycle started. Review the inputs, then calculate.');
}

// ─── Per-month inputs ──────────────────────────────────────────────────────

const inputSchema = z.object({
  employeeId: z.uuid(),
  month,
  field: z.enum(['lop_days', 'tds_override', 'units']),
  value: optionalNumber,
});

/** Sets or clears one input (LOP days, TDS override, days/hours worked) for an employee's month. */
export async function saveInputAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = inputSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: 'Enter a number (or leave it empty to clear it).', values: formValues(formData) };
  if (p.data.field === 'lop_days' && p.data.value !== null && p.data.value > 31) return { ok: false, message: 'LOP days can’t exceed the month.' };
  const supabase = await createClient();
  const field: Partial<Record<'lop_days' | 'tds_override' | 'units', number | null>> = { [p.data.field]: p.data.value };
  const { error } = await supabase.from('payroll_employee_inputs').upsert({
    organization_id: ctx.org.id, employee_id: p.data.employeeId, period_month: p.data.month, ...field,
  }, { onConflict: 'employee_id,period_month' });
  if (error) return failed(error, formData);
  return done(slug, p.data.value === null ? 'Cleared.' : 'Saved. Recalculate to apply it.');
}

export async function holdAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({ employeeId: z.uuid(), month, hold: z.enum(['on', 'off']), reason: z.string().trim().max(300).optional() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: 'Invalid request.' };
  if (p.data.hold === 'on' && !p.data.reason) return { ok: false, message: 'Say why the salary is on hold.', fieldErrors: { reason: 'Required' }, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('payroll_employee_inputs').upsert({
    organization_id: ctx.org.id, employee_id: p.data.employeeId, period_month: p.data.month,
    on_hold: p.data.hold === 'on', hold_reason: p.data.hold === 'on' ? p.data.reason! : null,
  }, { onConflict: 'employee_id,period_month' });
  if (error) return failed(error, formData);
  return doneFlash(slug, p.data.hold === 'on' ? 'Salary put on hold. It is calculated but not paid until released.' : 'Hold released.');
}

/** LOP import: a CSV of employee code and LOP days (header row optional). Nothing is saved if any line is wrong. */
export async function lopImportAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const m = month.safeParse(formData.get('month'));
  const file = formData.get('file');
  if (!m.success || !(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 512 * 1024) return { ok: false, message: 'The file is too large (512 KB at most).' };
  const supabase = await createClient();
  const { data: emps } = await supabase.from('employees').select('id, employee_code').eq('organization_id', ctx.org.id);
  const byCode = new Map((emps ?? []).map((e) => [e.employee_code.toUpperCase(), e.id]));
  const problems: string[] = [];
  const rows: Array<{ organization_id: string; employee_id: string; period_month: string; lop_days: number }> = [];
  (await file.text()).split(/\r?\n/).forEach((line, i) => {
    const [code = '', days = ''] = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    if (!code || (i === 0 && /code/i.test(code))) return;
    const id = byCode.get(code.toUpperCase());
    const n = Number(days);
    if (!id) problems.push(`Line ${i + 1}: unknown employee code ${code}`);
    else if (!Number.isFinite(n) || n < 0 || n > 31 || Math.round(n * 2) !== n * 2) problems.push(`Line ${i + 1}: LOP days must be 0–31 in half days`);
    else rows.push({ organization_id: ctx.org.id, employee_id: id, period_month: m.data, lop_days: n });
  });
  if (problems.length) return { ok: false, message: problems.slice(0, 8).join(' · ') + (problems.length > 8 ? ` · and ${problems.length - 8} more` : '') };
  if (rows.length === 0) return { ok: false, message: 'The file has no rows. Use: employee code, LOP days.' };
  const { error } = await supabase.from('payroll_employee_inputs').upsert(rows, { onConflict: 'employee_id,period_month' });
  if (error) return failed(error);
  return done(slug, `Imported LOP for ${rows.length} employee${rows.length === 1 ? '' : 's'}. Recalculate to apply it.`);
}

// ─── Structures and salaries ───────────────────────────────────────────────

const CALCS = ['percent_of_gross', 'percent_of_basic', 'fixed', 'balance'] as const;

/** Reads `calc:<componentId>` and `value:<componentId>` pairs; a component without a calc isn't in the structure. */
function structureLinesFrom(formData: FormData) {
  const lines: Array<{ component_id: string; calc: (typeof CALCS)[number]; value: number; position: number }> = [];
  let position = 0;
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith('calc:') || typeof v !== 'string' || v === '') continue;
    const id = k.slice(5);
    if (!z.uuid().safeParse(id).success || !CALCS.includes(v as never)) continue;
    const value = Number(formData.get(`value:${id}`) ?? 0) || 0;
    lines.push({ component_id: id, calc: v as (typeof CALCS)[number], value, position: ++position });
  }
  return lines;
}

export async function saveStructureAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({
    structureId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    name: z.string().trim().min(2, 'Name it').max(80),
    description: z.string().trim().max(300).optional(),
    payBasis: z.enum(['monthly', 'daily', 'hourly']),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const lines = structureLinesFrom(formData);
  if (lines.length === 0) return { ok: false, message: 'Add at least one component.', values: formValues(formData) };
  if (lines.filter((l) => l.calc === 'balance').length > 1) return { ok: false, message: 'Only one component can take the balance.', values: formValues(formData) };
  if (lines.some((l) => l.calc.startsWith('percent') && (l.value < 0 || l.value > 100))) return { ok: false, message: 'Percentages must be between 0 and 100.', values: formValues(formData) };
  const supabase = await createClient();
  let id = p.data.structureId;
  if (id) {
    const { error } = await supabase.from('salary_structures').update({ name: p.data.name, description: p.data.description || null, pay_basis: p.data.payBasis })
      .eq('organization_id', ctx.org.id).eq('id', id);
    if (error) return failed(error, formData);
    const del = await supabase.from('salary_structure_lines').delete().eq('structure_id', id);
    if (del.error) return failed(del.error, formData);
  } else {
    const { data, error } = await supabase.from('salary_structures').insert({ organization_id: ctx.org.id, name: p.data.name, description: p.data.description || null, pay_basis: p.data.payBasis })
      .select('id').single();
    if (error) return failed(error, formData);
    id = data.id;
  }
  const { error } = await supabase.from('salary_structure_lines').insert(lines.map((l) => ({ ...l, organization_id: ctx.org.id, structure_id: id! })));
  if (error) return failed(error, formData);
  return done(slug, 'Salary structure saved.');
}

export async function structureFlagAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({ structureId: z.uuid(), op: z.enum(['default', 'archive', 'restore']) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  if (p.data.op === 'default') {
    const off = await supabase.from('salary_structures').update({ is_default: false }).eq('organization_id', ctx.org.id).eq('is_default', true);
    if (off.error) return failed(off.error);
    const on = await supabase.from('salary_structures').update({ is_default: true, archived_at: null }).eq('organization_id', ctx.org.id).eq('id', p.data.structureId);
    if (on.error) return failed(on.error);
    return doneFlash(slug, 'Set as the default structure.');
  }
  const { error } = await supabase.from('salary_structures').update({ archived_at: p.data.op === 'archive' ? new Date().toISOString() : null, ...(p.data.op === 'archive' ? { is_default: false } : {}) })
    .eq('organization_id', ctx.org.id).eq('id', p.data.structureId);
  if (error) return failed(error);
  return done(slug, p.data.op === 'archive' ? 'Archived.' : 'Restored.');
}

/** The component lines for a CTC (monthly) or a wage rate (daily/hourly) under a structure. */
async function salaryLines(orgId: string, structureId: string, amount: number) {
  const supabase = await createClient();
  const [s, lines, comps] = await Promise.all([
    supabase.from('salary_structures').select('id, pay_basis').eq('organization_id', orgId).eq('id', structureId).single(),
    supabase.from('salary_structure_lines').select('component_id, calc, value, position').eq('structure_id', structureId).order('position'),
    supabase.from('salary_components').select('id, code, name').eq('organization_id', orgId),
  ]);
  if (s.error || lines.error || comps.error) throw new Error('Unknown salary structure.');
  const byId = new Map((comps.data ?? []).map((c) => [c.id, c]));
  if (s.data.pay_basis !== 'monthly') {
    // Wage-based: the rate goes on the base component (BASIC, or the structure's first line).
    const base = lines.data.find((l) => byId.get(l.component_id)?.code === 'BASIC') ?? lines.data[0];
    if (!base) throw new Error('This structure has no components.');
    return { basis: s.data.pay_basis, lines: [{ component_id: base.component_id, monthly_amount: amount }], annual: amount * (s.data.pay_basis === 'daily' ? 26 : 208) * 12 };
  }
  const monthly = amount / 12;
  const breakup = structureBreakup(monthly, lines.data.map((l): StructureLine => ({
    componentId: l.component_id, code: byId.get(l.component_id)?.code ?? '', name: byId.get(l.component_id)?.name ?? '', calc: l.calc, value: Number(l.value),
  })));
  if (breakup.overflow) throw new Error('The structure’s fixed amounts are more than this salary. Raise the CTC or change the structure.');
  return { basis: s.data.pay_basis, lines: breakup.lines.map((l) => ({ component_id: l.componentId, monthly_amount: l.amount })), annual: amount };
}

const salarySchema = z.object({
  employeeId: z.uuid({ error: 'Choose an employee' }),
  structureId: z.uuid({ error: 'Choose a structure' }),
  amount: money('the amount').refine((n) => n > 0, 'Enter the amount'),
  effectiveFrom: date,
  reason: z.string().trim().max(500).optional(),
});

/** First salary (direct) or a revision (waits for sign-off by another payroll approver). */
export async function salaryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = salarySchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const supabase = await createClient();
  let built;
  try {
    built = await salaryLines(ctx.org.id, p.data.structureId, p.data.amount);
  } catch (e) {
    return { ok: false, message: (e as Error).message, values: formValues(formData) };
  }
  const { count } = await supabase.from('compensation_records').select('id', { count: 'exact', head: true }).eq('employee_id', p.data.employeeId);
  if (!count) {
    const { error } = await supabase.rpc('assign_salary', {
      p_employee: p.data.employeeId, p_effective_from: p.data.effectiveFrom, p_structure: p.data.structureId, p_annual_ctc: built.annual,
      p_lines: built.lines, p_note: p.data.reason || undefined,
    });
    if (error) return failed(error, formData);
    return done(slug, 'Salary assigned.');
  }
  if (!p.data.reason || p.data.reason.length < 3) return { ok: false, message: 'Say why the salary is being revised.', fieldErrors: { reason: 'Required' }, values: formValues(formData) };
  const { error } = await supabase.rpc('request_salary_revision', {
    p_employee: p.data.employeeId, p_effective_from: p.data.effectiveFrom, p_structure: p.data.structureId, p_annual_ctc: built.annual,
    p_lines: built.lines, p_reason: p.data.reason,
  });
  if (error) return failed(error, formData);
  return done(slug, 'Revision sent for sign-off. Another payroll approver must approve it.');
}

export async function decideRevisionAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const p = z.object({ revisionId: z.uuid(), decision: z.enum(['approve', 'reject', 'withdraw']), note: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = p.data.decision === 'withdraw'
    ? await supabase.rpc('cancel_salary_revision', { p_revision: p.data.revisionId })
    : await supabase.rpc('decide_salary_revision', { p_revision: p.data.revisionId, p_approve: p.data.decision === 'approve', p_note: p.data.note || undefined });
  if (error) return failed(error, formData);
  return doneFlash(slug, { approve: 'Approved. The new salary is saved; arrears, if any, are added to the next run.', reject: 'Rejected.', withdraw: 'Withdrawn.' }[p.data.decision]);
}

// ─── Components ────────────────────────────────────────────────────────────

export async function saveComponentAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({
    componentId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, '2–20 letters, digits or _'),
    name: z.string().trim().min(2, 'Name it').max(80),
    kind: z.enum(['earning', 'deduction']),
    category: z.enum(['base', 'recurring', 'variable', 'adhoc']),
    taxable: z.enum(['yes', 'no']),
    pfWage: z.enum(['yes', 'no']),
    active: z.enum(['yes', 'no']).default('yes'),
    description: z.string().trim().max(300).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return invalid(p.error, formData);
  const row = {
    code: p.data.code, name: p.data.name, kind: p.data.kind, category: p.data.category, taxable: p.data.taxable === 'yes',
    pf_wage: p.data.pfWage === 'yes', is_active: p.data.active === 'yes', description: p.data.description || null,
  };
  const supabase = await createClient();
  const { error } = p.data.componentId
    ? await supabase.from('salary_components').update(row).eq('organization_id', ctx.org.id).eq('id', p.data.componentId)
    : await supabase.from('salary_components').insert({ ...row, organization_id: ctx.org.id, position: 50 });
  if (error) return failed(error, formData);
  return done(slug, 'Component saved.');
}

// ─── Settings ──────────────────────────────────────────────────────────────

const yes = z.enum(['on']).optional().transform((v) => v === 'on');
const optionalDate = z.preprocess((v) => (v === '' ? null : v), date.nullable());

export async function saveSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const section = formData.get('section');
  const supabase = await createClient();
  let patch: Database['public']['Tables']['payroll_settings']['Update'];
  if (section === 'pay') {
    const p = z.object({
      payDay: z.preprocess((v) => (v === '' || v === 'last' ? null : v), z.coerce.number().int().min(1).max(31).nullable()),
      lopFromAbsence: yes, payslipTemplate: z.enum(['modern', 'classic', 'compact']), payslipShowYtd: yes,
    }).safeParse(Object.fromEntries(formData));
    if (!p.success) return invalid(p.error, formData);
    patch = { pay_day: p.data.payDay, lop_from_absence: p.data.lopFromAbsence, payslip_template: p.data.payslipTemplate, payslip_show_ytd: p.data.payslipShowYtd };
  } else if (section === 'statutory') {
    const p = z.object({ pf: yes, esi: yes, pt: yes, defaultRegime: z.enum(['old', 'new']) }).safeParse(Object.fromEntries(formData));
    if (!p.success) return invalid(p.error, formData);
    patch = { pf_enabled: p.data.pf, esi_enabled: p.data.esi, pt_enabled: p.data.pt, default_regime: p.data.defaultRegime };
  } else if (section === 'declarations') {
    const p = z.object({
      open: yes, mode: z.enum(['monthly', 'yearly']), until: optionalDate, proofFrom: optionalDate, proofUntil: optionalDate,
    }).safeParse(Object.fromEntries(formData));
    if (!p.success) return invalid(p.error, formData);
    if (p.data.proofFrom && p.data.proofUntil && p.data.proofUntil < p.data.proofFrom) return { ok: false, message: 'The proof window must end after it starts.', values: formValues(formData) };
    patch = { declaration_open: p.data.open, declaration_mode: p.data.mode, declaration_until: p.data.until, proof_from: p.data.proofFrom, proof_until: p.data.proofUntil };
  } else if (section === 'bank') {
    const p = z.object({
      bankName: z.string().trim().max(120).optional(),
      accountNumber: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^[0-9]{6,18}$/, '6–18 digits').optional()),
      ifsc: z.preprocess((v) => (v === '' ? undefined : String(v).toUpperCase()), z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Like HDFC0001234').optional()),
      fileFormat: z.enum(['generic', 'hdfc', 'icici', 'sbi']),
    }).safeParse(Object.fromEntries(formData));
    if (!p.success) return invalid(p.error, formData);
    const { error } = await supabase.from('payroll_bank_settings').update({
      bank_name: p.data.bankName || null, account_number: p.data.accountNumber ?? null, ifsc: p.data.ifsc ?? null, file_format: p.data.fileFormat,
    }).eq('organization_id', ctx.org.id);
    if (error) return failed(error, formData);
    return done(slug, 'Bank settings saved.');
  } else {
    return { ok: false, message: 'Invalid request.' };
  }
  const { data, error } = await supabase.from('payroll_settings').update(patch).eq('organization_id', ctx.org.id).select('organization_id');
  if (error) return failed(error, formData);
  if (!data?.length) return { ok: false, message: 'You don’t have permission to do that.' };
  return done(slug, 'Settings saved.');
}

// ─── Payouts ───────────────────────────────────────────────────────────────

export async function payoutAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const p = z.object({
    runId: z.uuid(), status: z.enum(['pending', 'paid', 'failed', 'on_hold']),
    reference: z.string().trim().max(60).optional(), paidOn: z.preprocess((v) => (v === '' ? undefined : v), date.optional()), note: z.string().trim().max(300).optional(),
  }).safeParse(Object.fromEntries(formData));
  const ids = formData.getAll('employeeId').map(String).filter((id) => z.uuid().safeParse(id).success);
  if (!p.success) return invalid(p.error, formData);
  if (ids.length === 0) return { ok: false, message: 'Select at least one employee.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_payouts', {
    p_run: p.data.runId, p_employees: ids, p_status: p.data.status, p_reference: p.data.reference || undefined, p_paid_on: p.data.paidOn, p_note: p.data.note || undefined,
  });
  if (error) return failed(error, formData);
  return done(slug, `Updated ${data} payout${data === 1 ? '' : 's'}.`);
}

// ─── Declarations ──────────────────────────────────────────────────────────

export async function reviewDeclarationAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const p = z.object({ declarationId: z.uuid(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: 'Invalid request.' };
  const items = [...formData.entries()].filter(([k]) => k.startsWith('approved:')).map(([k, v]) => ({ id: k.slice(9), approved: Number(v) || 0 }))
    .filter((i) => z.uuid().safeParse(i.id).success);
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_tax_declaration', {
    p_declaration: p.data.declarationId, p_approve: p.data.decision === 'approve', p_items: items, p_note: p.data.note || undefined,
  });
  if (error) return failed(error, formData);
  return doneFlash(slug, p.data.decision === 'approve' ? 'Declaration approved. TDS uses the approved amounts from the next calculation.' : 'Sent back to the employee.');
}

const SECTIONS = ['hra', '80C', '80CCD1B', '80D_self', '80D_parents', '80E', '80G', '80TTA', '24B', 'lta', 'prev_employer', 'other'] as const;

/** The employee's own declaration (Tax Center). */
export async function saveMyDeclarationAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const p = z.object({
    fy: z.string().regex(/^\d{4}-\d{2}$/), regime: z.enum(['old', 'new']), metro: yes, seniorSelf: yes, seniorParents: yes, submit: z.enum(['draft', 'submit']),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, message: 'Choose a tax regime.', values: formValues(formData) };
  const items = [];
  for (const s of SECTIONS) {
    const declared = Number(formData.get(`declared:${s}`) || 0);
    const tds = Number(formData.get(`tds:${s}`) || 0);
    if (!Number.isFinite(declared) || declared < 0 || !Number.isFinite(tds) || tds < 0) {
      return { ok: false, message: 'Amounts must be positive numbers.', values: formValues(formData) };
    }
    if (declared > 0 || tds > 0) {
      const details: Record<string, string> = {};
      for (const key of ['landlord', 'landlordPan', 'lender', 'employer']) {
        const v = formData.get(`${key}:${s}`);
        if (typeof v === 'string' && v.trim()) details[key] = v.trim().slice(0, 120);
      }
      items.push({ section: s, label: String(formData.get(`label:${s}`) || s), declared, tds, details });
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_tax_declaration', {
    p_org: ctx.org.id, p_fy: p.data.fy, p_regime: p.data.regime, p_metro: p.data.metro, p_senior_self: p.data.seniorSelf,
    p_senior_parents: p.data.seniorParents, p_items: items, p_submit: p.data.submit === 'submit',
  });
  if (error) return failed(error, formData);
  revalidatePath(`/app/${slug}/payslips`);
  return { ok: true, message: p.data.submit === 'submit' ? 'Submitted to payroll for review.' : 'Saved as a draft.' };
}

/** Approves every submitted declaration for the year at the declared amounts (Kredily's "Bulk Approve"). */
export async function bulkApproveDeclarationsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const fy = z.string().regex(/^\d{4}-\d{2}$/).safeParse(formData.get('fy'));
  if (!fy.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('tax_declarations').select('id').eq('organization_id', ctx.org.id).eq('fy', fy.data).eq('status', 'submitted');
  if (error) return failed(error);
  let ok = 0;
  const problems: string[] = [];
  for (const d of data ?? []) {
    const r = await supabase.rpc('review_tax_declaration', { p_declaration: d.id, p_approve: true, p_items: [], p_note: 'Bulk approved' });
    if (r.error) problems.push(toUserMessage(r.error)); else ok += 1;
  }
  revalidatePath(`/app/${slug}/payroll`);
  if (problems.length) return { ok: ok > 0, message: `Approved ${ok}. ${[...new Set(problems)].join(' ')}` };
  return { ok: true, message: ok ? `Approved ${ok} declaration${ok === 1 ? '' : 's'}.` : 'Nothing waiting for review.' };
}
