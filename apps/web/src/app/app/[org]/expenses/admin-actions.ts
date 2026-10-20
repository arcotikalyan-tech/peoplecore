'use server';

import { revalidatePath } from 'next/cache';
import { parseCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext, type OrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Expense Admin actions (finance: expense.manage) and the hold / answer / skip steps of an approval. RLS and the database functions decide. */

const base = (slug: string) => `/app/${slug}/expenses`;
const uuid = z.uuid();
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const errorsOf = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message]));

async function finance(slug: string): Promise<OrgContext | null> {
  const ctx = await getOrgContext(slug);
  return ctx.can('expense.manage', 'org') ? ctx : null;
}
const denied: ActionState = { ok: false, message: 'Only finance can do this.' };

// ─── Settings ───────────────────────────────────────────────────────────────

export async function saveExpenseSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const parsed = z.object({
    threshold: z.preprocess(blank, z.coerce.number().positive('Enter an amount above 0').max(9_999_999).optional()),
    escalationDays: z.coerce.number().int().min(1, 'Between 1 and 90 days').max(90, 'Between 1 and 90 days'),
    mileageRate: z.coerce.number({ error: 'Enter the rate' }).positive('Enter a rate above 0').max(1000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: errorsOf(parsed.error), values: formValues(formData) };
  const on = (k: string) => formData.get(k) === 'on';
  const supabase = await createClient();
  const { error } = await supabase.from('expense_settings').upsert({
    organization_id: ctx.org.id, receipt_reading: on('receiptReading'), multi_level: on('multiLevel'), threshold: on('multiLevel') ? (parsed.data.threshold ?? null) : null,
    auto_finalize: on('multiLevel') && on('autoFinalize'), finance_only: on('financeOnly'), allow_skip: on('allowSkip'), escalation_days: parsed.data.escalationDays,
    mileage_enabled: on('mileageEnabled'), mileage_rate: parsed.data.mileageRate,
  }, { onConflict: 'organization_id' });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(base(slug));
  return { ok: true, message: 'Expense settings saved. New claims follow them; claims already submitted keep their approvers.' };
}

// ─── Categories ─────────────────────────────────────────────────────────────

const subs = (v: unknown) => [...new Set(String(v ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 30);
const categorySchema = z.object({
  categoryId: z.preprocess(blank, uuid.optional()),
  code: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_') : v), z.string().regex(/^[A-Z0-9_]{2,20}$/, '2–20 letters, digits or _')),
  name: z.string().trim().min(2, 'Name the category').max(60),
  description: z.preprocess(blank, z.string().trim().max(200).optional()),
  maxPerItem: z.preprocess(blank, z.coerce.number().positive('Enter an amount above 0').max(9_999_999).optional()),
});

export async function saveCategoryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: errorsOf(parsed.error), values: formValues(formData) };
  const v = parsed.data;
  const row = { code: v.code, name: v.name, description: v.description ?? null, max_per_item: v.maxPerItem ?? null,
    requires_receipt: formData.get('requiresReceipt') === 'on', subcategories: subs(formData.get('subcategories')) };
  const supabase = await createClient();
  const { error } = v.categoryId
    ? await supabase.from('expense_categories').update(row).eq('id', v.categoryId).eq('organization_id', ctx.org.id)
    : await supabase.from('expense_categories').insert({ ...row, organization_id: ctx.org.id });
  if (error) return { ok: false, message: error.code === '23505' ? 'Another category already uses that code.' : toUserMessage(error), values: formValues(formData) };
  revalidatePath(base(slug));
  if (!v.categoryId) await flash(`Category “${v.name}” added.`);
  return { ok: true, message: v.categoryId ? 'Category saved.' : `Category “${v.name}” added.` };
}

export async function toggleCategoryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const id = uuid.safeParse(formData.get('categoryId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('expense_categories').update({ is_active: formData.get('active') === 'yes' }).eq('id', id.data).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(base(slug));
  return { ok: true, message: formData.get('active') === 'yes' ? 'Category restored.' : 'Category archived.' };
}

/** CSV with columns code, name, requires_receipt (yes/no), max_per_item, sub_categories (separated by ;). */
export async function importCategoriesAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 200_000) return { ok: false, message: 'The file is too large (200 KB at most).' };
  let rows: string[][];
  try { rows = parseCsv(await file.text()); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' }; }
  const [head, ...body] = rows;
  const col = (n: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_') === n);
  const [ci, ni, ri, mi, si] = ['code', 'name', 'requires_receipt', 'max_per_item', 'sub_categories'].map(col) as [number, number, number, number, number];
  if (ci < 0 || ni < 0) return { ok: false, message: 'The file needs “code” and “name” columns. Download the template.' };
  const problems: string[] = [];
  const records = body.slice(0, 200).flatMap((r, i) => {
    const parsed = categorySchema.safeParse({ code: r[ci], name: r[ni], maxPerItem: mi >= 0 ? r[mi] : undefined });
    if (!parsed.success) { problems.push(`Row ${i + 2}: ${parsed.error.issues[0]!.message}`); return []; }
    return [{ organization_id: ctx.org.id, code: parsed.data.code, name: parsed.data.name, max_per_item: parsed.data.maxPerItem ?? null,
      requires_receipt: ri < 0 ? true : !/^(no|n|false|0)$/i.test((r[ri] ?? '').trim()), subcategories: si >= 0 ? subs(r[si]) : [] }];
  });
  if (problems.length) return { ok: false, message: `Nothing imported. ${problems.slice(0, 3).join(' ')}` };
  const supabase = await createClient();
  const { error } = await supabase.from('expense_categories').upsert(records, { onConflict: 'organization_id,code' });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(base(slug));
  return { ok: true, message: `Imported ${records.length} categor${records.length === 1 ? 'y' : 'ies'}.` };
}

// ─── Finance records expenses ───────────────────────────────────────────────

const recordSchema = z.object({
  employeeId: uuid,
  categoryId: z.uuid({ error: 'Choose a category' }),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(9_999_999),
  merchant: z.preprocess(blank, z.string().trim().max(120).optional()),
  description: z.preprocess(blank, z.string().trim().max(500).optional()),
  subcategory: z.preprocess(blank, z.string().trim().max(60).optional()),
});

export async function recordExpenseAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const parsed = recordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: errorsOf(parsed.error), values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_expense', {
    p_org: ctx.org.id, p_employee: v.employeeId, p_category: v.categoryId, p_date: v.expenseDate, p_amount: v.amount,
    p_merchant: sqlNull(v.merchant), p_description: sqlNull(v.description), p_subcategory: sqlNull(v.subcategory),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(base(slug));
  return { ok: true, message: 'Expense added. It is approved and ready to pay.' };
}

/** CSV with columns employee_code, date (YYYY-MM-DD), category_code, amount, merchant, description. All rows or none. */
export async function importExpensesAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 500_000) return { ok: false, message: 'The file is too large (500 KB at most).' };
  let rows: string[][];
  try { rows = parseCsv(await file.text()); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' }; }
  const [head, ...body] = rows;
  const col = (n: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_') === n);
  const idx = Object.fromEntries(['employee_code', 'date', 'category_code', 'amount', 'merchant', 'description'].map((n) => [n, col(n)]));
  if (idx.employee_code! < 0 || idx.date! < 0 || idx.category_code! < 0 || idx.amount! < 0) return { ok: false, message: 'The file needs employee_code, date, category_code and amount columns.' };
  if (body.length > 500) return { ok: false, message: 'Import at most 500 expenses at a time.' };
  const supabase = await createClient();
  const [{ data: emps }, { data: cats }] = await Promise.all([
    supabase.from('employees').select('id, employee_code').eq('organization_id', ctx.org.id),
    supabase.from('expense_categories').select('id, code').eq('organization_id', ctx.org.id).eq('is_active', true),
  ]);
  const emp = new Map((emps ?? []).map((e) => [e.employee_code.toLowerCase(), e.id]));
  const cat = new Map((cats ?? []).map((c) => [c.code, c.id]));
  const problems: string[] = [];
  const records = body.flatMap((r, i) => {
    const get = (k: string) => (idx[k]! >= 0 ? (r[idx[k]!] ?? '').trim() : '');
    const parsed = recordSchema.safeParse({ employeeId: emp.get(get('employee_code').toLowerCase()) ?? '', categoryId: cat.get(get('category_code').toUpperCase()) ?? '',
      expenseDate: get('date'), amount: get('amount'), merchant: get('merchant'), description: get('description') });
    if (!parsed.success) {
      const why = !emp.has(get('employee_code').toLowerCase()) ? `unknown employee “${get('employee_code')}”` : !cat.has(get('category_code').toUpperCase())
        ? `unknown category “${get('category_code')}”` : parsed.error.issues[0]!.message;
      problems.push(`Row ${i + 2}: ${why}.`); return [];
    }
    return [parsed.data];
  });
  if (problems.length) return { ok: false, message: `Nothing imported. ${problems.slice(0, 3).join(' ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}` };
  let done = 0;
  for (const v of records) {
    const { error } = await supabase.rpc('record_expense', { p_org: ctx.org.id, p_employee: v.employeeId, p_category: v.categoryId, p_date: v.expenseDate, p_amount: v.amount,
      p_merchant: sqlNull(v.merchant), p_description: sqlNull(v.description), p_subcategory: sqlNull(undefined) });
    if (error) return { ok: false, message: `Imported ${done}; stopped at row ${done + 2}: ${toUserMessage(error)}` };
    done += 1;
  }
  revalidatePath(base(slug));
  return { ok: true, message: `Imported ${done} expense${done === 1 ? '' : 's'}, approved and ready to pay.` };
}

// ─── Payouts ────────────────────────────────────────────────────────────────

export async function payClaimsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await finance(slug);
  if (!ctx) return denied;
  const ids = formDataAll(formData, 'claimId').filter((x) => uuid.safeParse(x).success);
  const mode = z.enum(['bank', 'cash']).safeParse(formData.get('mode'));
  if (ids.length === 0) return { ok: false, message: 'Select the claims to mark as paid.' };
  if (!mode.success) return { ok: false, message: 'Choose bank transfer or cash.' };
  const reference = String(formData.get('reference') ?? '').trim().slice(0, 80);
  if (mode.data === 'bank' && !reference) return { ok: false, message: 'Enter the bank reference (UTR) for the transfer.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pay_expense_claims', { p_claims: ids, p_mode: mode.data, p_reference: reference });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(base(slug));
  await flash(`Marked ${data} claim${data === 1 ? '' : 's'} as paid.`);
  return { ok: true, message: `Marked ${data} claim${data === 1 ? '' : 's'} as paid.` };
}

// ─── Approval steps ─────────────────────────────────────────────────────────

export async function holdClaimAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = uuid.safeParse(formData.get('claimId'));
  const note = String(formData.get('note') ?? '').trim();
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  if (!note) return { ok: false, message: 'Say what information you need.', fieldErrors: { note: 'Required' } };
  const supabase = await createClient();
  const { error } = await supabase.rpc('hold_expense_claim', { p_claim: id.data, p_note: note });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(base(slug), 'layout');
  await flash('On hold. The employee has been asked for the information.');
  return { ok: true, message: 'On hold. The employee has been asked for the information.' };
}

export async function replyClaimAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = uuid.safeParse(formData.get('claimId'));
  const reply = String(formData.get('reply') ?? '').trim();
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  if (!reply) return { ok: false, message: 'Write your answer.', fieldErrors: { reply: 'Required' } };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reply_expense_claim', { p_claim: id.data, p_reply: reply });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(base(slug), 'layout');
  await flash('Sent. Your approver has been notified.');
  return { ok: true, message: 'Sent. Your approver has been notified.' };
}

export async function finalizeClaimAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = uuid.safeParse(formData.get('claimId'));
  const comment = String(formData.get('comment') ?? '').trim();
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  if (!comment) return { ok: false, message: 'Say why the remaining approvers are skipped.', fieldErrors: { comment: 'Required' } };
  const supabase = await createClient();
  const { error } = await supabase.rpc('finalize_expense_claim', { p_claim: id.data, p_comment: comment });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(base(slug), 'layout');
  await flash('Approved by finance.');
  return { ok: true, message: 'Approved by finance.' };
}

/** Approve or reject from the claim page (the decision panel leaves the page once decided, so the result is flashed). */
export async function decideClaimAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({ requestId: uuid, decision: z.enum(['approve', 'reject']), comment: z.string().trim().max(1000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  if (parsed.data.decision === 'reject' && !parsed.data.comment) return { ok: false, message: 'Give a reason when rejecting.', fieldErrors: { comment: 'Required when rejecting' } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_approval', { p_request: parsed.data.requestId, p_decision: parsed.data.decision, p_comment: parsed.data.comment });
  if (error) return { ok: false, message: toUserMessage(error) };
  const message = data === 'pending' ? 'Approved. It moves to the next approver.' : data === 'approved' ? 'Claim approved.' : 'Claim rejected.';
  revalidatePath(base(slug), 'layout');
  await flash(message);
  return { ok: true, message };
}
