'use server';

import { revalidatePath } from 'next/cache';
import { parseCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Group health insurance: the policy, coverage and endorsements (insurance.manage; RLS and the database enforce). */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const money = optional(z.coerce.number({ error: 'Enter an amount' }).min(0, 'Enter an amount').max(99_999_999));
const back = (slug: string) => revalidatePath(`/app/${slug}/insurance`, 'layout');

export async function savePolicyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('insurance.manage', 'org')) return DENIED;
  const parsed = z.object({
    insurer: optional(z.string().trim().min(2).max(120)),
    policyNumber: optional(z.string().trim().max(60)),
    validFrom: optional(z.iso.date({ error: 'Enter a valid date' })),
    validTo: optional(z.iso.date({ error: 'Enter a valid date' })),
    maternityNormal: money, maternityCsection: money,
    roomNormal: optional(z.coerce.number().int().min(1).max(10)), roomIcu: optional(z.coerce.number().int().min(1).max(10)),
    coverType: z.enum(['ESC', 'ESCP']),
    sumInsured: optional(z.coerce.number({ error: 'Enter an amount' }).positive('Enter an amount').max(99_999_999)),
    sumInsuredType: z.enum(['fixed', 'grade']),
    ambulance: money,
    claimProcess: optional(z.string().trim().max(2000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  if (v.validFrom && v.validTo && v.validTo <= v.validFrom) return { ok: false, message: 'The policy must end after it starts.', fieldErrors: { validTo: 'After the start date' }, values: formValues(formData) };
  const on = (k: string) => formData.get(k) === 'yes';
  const hidden = formData.getAll('hide').map(String).filter((k) => /^[a-z_]{2,40}$/.test(k));
  const hiddenColumns = hidden.flatMap((k) => k === 'maternity' ? ['maternity_normal', 'maternity_csection'] : k === 'room_rent' ? ['room_rent_normal_pct', 'room_rent_icu_pct'] : k === 'valid_from' ? ['valid_from', 'valid_to'] : [k]);
  const supabase = await createClient();
  const { error } = await supabase.from('insurance_policies').upsert({
    organization_id: ctx.org.id, insurer: v.insurer ?? null, policy_number: v.policyNumber ?? null, valid_from: v.validFrom ?? null, valid_to: v.validTo ?? null,
    maternity_normal: v.maternityNormal ?? null, maternity_csection: v.maternityCsection ?? null, room_rent_normal_pct: v.roomNormal ?? null, room_rent_icu_pct: v.roomIcu ?? null,
    cover_type: v.coverType, sum_insured: v.sumInsured ?? null, sum_insured_type: v.sumInsuredType, ambulance_per_incident: v.ambulance ?? null, claim_process: v.claimProcess ?? null,
    wellness: on('wellness'), e_consultation: on('e_consultation'), health_checkup: on('health_checkup'), pre_existing_covered: on('pre_existing_covered'),
    waiting_period_waived: on('waiting_period_waived'), exclusions_waived: on('exclusions_waived'), pre_post_hospitalisation: on('pre_post_hospitalisation'),
    hidden_fields: hiddenColumns,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Policy saved.' };
}

export async function setCoverageAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('insurance.manage', 'org')) return DENIED;
  const parsed = z.object({
    employeeId: z.uuid(),
    covered: z.enum(['yes', 'no']),
    sumInsured: optional(z.coerce.number({ error: 'Enter an amount' }).positive('Enter an amount').max(99_999_999)),
    coveredFrom: optional(z.iso.date({ error: 'Enter a valid date' })),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('insurance_coverage').upsert({
    organization_id: ctx.org.id, employee_id: v.employeeId, covered: v.covered === 'yes', sum_insured: v.sumInsured ?? null, covered_from: v.coveredFrom ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.covered === 'yes' ? 'Covered.' : 'Not covered.' };
}

/** Cover every current employee who has no coverage record yet. */
export async function coverAllAction(slug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('insurance.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const [emps, cov] = await Promise.all([
    supabase.from('employees').select('id').eq('organization_id', ctx.org.id).in('status', ['active', 'on_notice']),
    supabase.from('insurance_coverage').select('employee_id').eq('organization_id', ctx.org.id),
  ]);
  const have = new Set((cov.data ?? []).map((c) => c.employee_id));
  const rows = (emps.data ?? []).filter((e) => !have.has(e.id)).map((e) => ({ organization_id: ctx.org.id, employee_id: e.id }));
  if (rows.length === 0) return { ok: true, message: 'Everyone already has a coverage record.' };
  const { error } = await supabase.from('insurance_coverage').insert(rows);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: `Covered ${rows.length} employee${rows.length === 1 ? '' : 's'}.` };
}

export async function lockEndorsementAction(slug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('lock_insurance_endorsement', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  const r = data as { additions: number; deletions: number };
  const message = `Endorsement locked and marked synced: ${r.additions} addition${r.additions === 1 ? '' : 's'}, ${r.deletions} deletion${r.deletions === 1 ? '' : 's'}.`;
  await flash(message);
  return { ok: true, message };
}

/** CSV with employee_code, covered (yes/no) and optionally sum_insured and covered_from. */
export async function importCoverageAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('insurance.manage', 'org')) return DENIED;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  let rows: string[][];
  try { rows = parseCsv(await file.text()); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' }; }
  const [head, ...body] = rows;
  if (!head || body.length === 0) return { ok: false, message: 'The file has no rows.' };
  const col = (k: string) => head.findIndex((h) => h.trim().toLowerCase().replace(/\s+/g, '_') === k);
  const [ci, cv, si, fi] = ['employee_code', 'covered', 'sum_insured', 'covered_from'].map(col) as [number, number, number, number];
  if (ci < 0) return { ok: false, message: 'The file needs an employee_code column.' };
  const supabase = await createClient();
  const { data: emps } = await supabase.from('employees').select('id, employee_code').eq('organization_id', ctx.org.id);
  const byCode = new Map((emps ?? []).map((e) => [e.employee_code.toLowerCase(), e.id]));
  const problems: string[] = [];
  const records = body.flatMap((r, i) => {
    if (r.every((c) => !c.trim())) return [];
    const code = (r[ci] ?? '').trim(); const id = byCode.get(code.toLowerCase());
    const sum = si >= 0 ? (r[si] ?? '').replace(/[,₹\s]/g, '') : ''; const from = fi >= 0 ? (r[fi] ?? '').trim() : '';
    if (!id) problems.push(`Line ${i + 2}: no employee ${code || '(blank)'}.`);
    if (sum && !(Number(sum) > 0)) problems.push(`Line ${i + 2}: sum insured isn’t a number.`);
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) problems.push(`Line ${i + 2}: covered_from must be YYYY-MM-DD.`);
    return id ? [{ organization_id: ctx.org.id, employee_id: id, covered: cv < 0 || !/^(no|n|false|0)$/i.test((r[cv] ?? '').trim()), sum_insured: sum ? Number(sum) : null, covered_from: from || null }] : [];
  });
  if (problems.length) return { ok: false, message: `Nothing imported. ${problems.slice(0, 3).join(' ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}` };
  const { error } = await supabase.from('insurance_coverage').upsert(records);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: `Updated coverage for ${records.length} employee${records.length === 1 ? '' : 's'}.` };
}

export type ReconcileState = ActionState & { result?: { missing: string[][]; extra: string[][]; matched: number } };

/** Compare the insurer's member list (CSV: employee_code, member_name, relationship) with the roster. Nothing is stored. */
export async function reconcileAction(slug: string, _prev: ReconcileState, formData: FormData): Promise<ReconcileState> {
  const ctx = await getOrgContext(slug);
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose the insurer’s CSV.' };
  let rows: string[][];
  try { rows = parseCsv(await file.text()); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' }; }
  const [head, ...body] = rows;
  const col = (k: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase().replace(/\s+/g, '_') === k);
  const [ci, ni, ri] = ['employee_code', 'member_name', 'relationship'].map(col) as [number, number, number];
  if (ci < 0 || ni < 0) return { ok: false, message: 'The file needs employee_code and member_name columns.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('insurance_endorsement', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  const norm = (code: string, name: string) => `${code.trim().toLowerCase()}|${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const ours = new Map(data.filter((r) => r.change !== 'deletion').map((r) => [norm(r.employee_code, r.member_name), r]));
  const theirs = new Map(body.filter((r) => r.some((c) => c.trim())).map((r) => [norm(r[ci] ?? '', r[ni] ?? ''), r]));
  const missing = [...ours.entries()].filter(([k]) => !theirs.has(k)).map(([, r]) => [r.employee_code, r.member_name, r.relationship]);
  const extra = [...theirs.entries()].filter(([k]) => !ours.has(k)).map(([, r]) => [r[ci] ?? '', r[ni] ?? '', ri >= 0 ? r[ri] ?? '' : '']);
  return { ok: true, message: `${ours.size - missing.length} matched · ${missing.length} missing at the insurer · ${extra.length} only at the insurer.`, result: { missing, extra, matched: ours.size - missing.length } };
}
