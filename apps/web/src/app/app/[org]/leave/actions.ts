'use server';

import { revalidatePath } from 'next/cache';
import {
  applyLeaveSchema, assignLeaveSchema, donateLeaveSchema, encashLeaveSchema, holidaySchema, isIsoDate, leaveRulePayload, leaveRuleSchema,
  leaveSettingsSchema, parseCsv, setBalanceSchema, todayIn,
} from '@peoplecore/shared';
import { z } from 'zod';
import { formDataAll, formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/**
 * Leave actions. Every write goes through a database function or RLS that checks the caller's permission;
 * the checks here only give a friendlier message first.
 */

const done = (orgSlug: string) => revalidatePath(`/app/${orgSlug}`, 'layout');

export async function applyLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = applyLeaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const employeeId = v.employeeId ?? (await getMyEmployee(ctx.org.id, ctx.user.id))?.id;
  if (!employeeId) return { ok: false, message: 'Your account isn’t linked to an employee record. Ask HR to link it.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('apply_leave', {
    p_employee: employeeId, p_type: v.leaveTypeId, p_start: v.startDate, p_end: v.endDate,
    p_half_start: v.halfDayStart, p_half_end: v.halfDayEnd, p_reason: v.reason,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  done(orgSlug);
  return { ok: true, message: v.employeeId ? 'Leave applied. It has gone for approval.' : 'Leave requested. Your manager has been asked to approve it.' };
}

export async function cancelLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('requestId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_leave', { p_request: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  done(orgSlug);
  await flash('Leave cancelled.');
  return { ok: true, message: 'Leave cancelled.' };
}

/** Approve or reject one or many leave approvals (bulk approve / "Approve all"). */
export async function decideLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const ids = formDataAll(formData, 'approvalId').filter((x) => z.uuid().safeParse(x).success);
  const decision = z.enum(['approve', 'reject']).safeParse(formData.get('decision'));
  const comment = String(formData.get('comment') ?? '').trim().slice(0, 1000);
  if (!decision.success || ids.length === 0) return { ok: false, message: 'Select at least one request.' };
  if (decision.data === 'reject' && !comment) return { ok: false, message: 'Give a reason when rejecting.', fieldErrors: { comment: 'Required when rejecting' } };
  const supabase = await createClient();
  let ok = 0;
  let firstError = '';
  for (const id of ids.slice(0, 200)) {
    const { error } = await supabase.rpc('decide_approval', { p_request: id, p_decision: decision.data, p_comment: sqlNull(comment || null) });
    if (error) firstError ||= toUserMessage(error);
    else ok++;
  }
  done(orgSlug);
  const verb = decision.data === 'approve' ? 'Approved' : 'Rejected';
  if (ok === 0) return { ok: false, message: firstError || 'Nothing was changed.' };
  return { ok: true, message: `${verb} ${ok} request${ok === 1 ? '' : 's'}.${firstError ? ` Some couldn’t be: ${firstError}` : ''}` };
}

async function hr(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('leave.manage', 'org') ? ctx : null;
}
const DENIED: ActionState = { ok: false, message: 'You don’t have permission to change leave settings.' };

export async function saveLeaveRuleAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const parsed = leaveRuleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_leave_rule', {
    p_org: ctx.org.id, p_type: sqlNull(parsed.data.typeId), p: leaveRulePayload(parsed.data),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  done(orgSlug);
  return { ok: true, message: parsed.data.typeId ? `“${parsed.data.name}” saved. The new rules apply from today.` : `“${parsed.data.name}” created.` };
}

export async function assignLeaveRuleAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const parsed = assignLeaveSchema.safeParse({ ...Object.fromEntries(formData), employeeIds: formDataAll(formData, 'employeeIds') });
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('leave_type_assignments').upsert(
    v.employeeIds.map((e) => ({ organization_id: ctx.org.id, employee_id: e, leave_type_id: v.leaveTypeId, effective_from: v.effectiveFrom })),
    { onConflict: 'employee_id,leave_type_id' },
  );
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  done(orgSlug);
  return { ok: true, message: `Assigned to ${v.employeeIds.length} employee${v.employeeIds.length === 1 ? '' : 's'}.` };
}

/** Bulk delete: removes the selected employees' assignments (of one rule, or all of them). */
export async function removeAssignmentsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const ids = formDataAll(formData, 'employeeIds').filter((x) => z.uuid().safeParse(x).success);
  const typeId = z.uuid().safeParse(formData.get('leaveTypeId'));
  if (ids.length === 0) return { ok: false, message: 'Select at least one employee.' };
  const supabase = await createClient();
  let q = supabase.from('leave_type_assignments').delete().eq('organization_id', ctx.org.id).in('employee_id', ids);
  if (typeId.success) q = q.eq('leave_type_id', typeId.data);
  const { data, error } = await q.select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  done(orgSlug);
  return { ok: true, message: `Removed ${data.length} assignment${data.length === 1 ? '' : 's'}.` };
}

/** Import assignments from a CSV: Employee code, Leave rule (code or name), Effective from. */
export async function importAssignmentsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 1_000_000) return { ok: false, message: 'The file is larger than 1 MB.' };
  const rows = parseCsv(await file.text());
  const [header, ...body] = rows;
  if (!header || body.length === 0) return { ok: false, message: 'The file has no rows.' };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iCode = col('employee code');
  const iRule = col('leave rule');
  const iFrom = col('effective from');
  if (iCode < 0 || iRule < 0) return { ok: false, message: 'Use the template: Employee code, Leave rule, Effective from.' };
  const supabase = await createClient();
  const [emps, types] = await Promise.all([
    supabase.from('employees').select('id, employee_code').eq('organization_id', ctx.org.id),
    supabase.from('leave_types').select('id, code, name').eq('organization_id', ctx.org.id),
  ]);
  const emp = new Map((emps.data ?? []).map((e) => [e.employee_code.toLowerCase(), e.id]));
  const type = new Map<string, string>();
  for (const t of types.data ?? []) { type.set(t.code.toLowerCase(), t.id); type.set(t.name.toLowerCase(), t.id); }
  const today = todayIn(ctx.org.timezone);
  const errors: string[] = [];
  const upserts: { organization_id: string; employee_id: string; leave_type_id: string; effective_from: string }[] = [];
  body.slice(0, 5000).forEach((r, i) => {
    if (r.every((c) => !c.trim())) return;
    const e = emp.get((r[iCode] ?? '').trim().toLowerCase());
    const t = type.get((r[iRule] ?? '').trim().toLowerCase());
    const from = iFrom >= 0 && (r[iFrom] ?? '').trim() ? (r[iFrom] ?? '').trim() : today;
    if (!e) errors.push(`Row ${i + 2}: no employee with code “${r[iCode] ?? ''}”`);
    else if (!t) errors.push(`Row ${i + 2}: no leave rule “${r[iRule] ?? ''}”`);
    else if (!isIsoDate(from)) errors.push(`Row ${i + 2}: effective from must be YYYY-MM-DD`);
    else upserts.push({ organization_id: ctx.org.id, employee_id: e, leave_type_id: t, effective_from: from });
  });
  if (errors.length) return { ok: false, message: `Nothing imported. ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` and ${errors.length - 5} more` : ''}.` };
  const { error } = await supabase.from('leave_type_assignments').upsert(upserts, { onConflict: 'employee_id,leave_type_id' });
  if (error) return { ok: false, message: toUserMessage(error) };
  done(orgSlug);
  return { ok: true, message: `Imported ${upserts.length} assignment${upserts.length === 1 ? '' : 's'}.` };
}

export async function setBalanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await hr(orgSlug))) return DENIED;
  const parsed = setBalanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_leave_balance', {
    p_employee: v.employeeId, p_type: v.leaveTypeId, p_carried: v.carried, p_credited: v.credited, p_penalty: v.penalty, p_note: v.note,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  done(orgSlug);
  return { ok: true, message: 'Balance saved.' };
}

export async function recalculateLeaveAction(orgSlug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recalculate_leave', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  done(orgSlug);
  const r = data as { credited?: number; lapsed?: number } | null;
  return { ok: true, message: `Balances recalculated: ${r?.credited ?? 0} credit${r?.credited === 1 ? '' : 's'} and ${r?.lapsed ?? 0} lapse${r?.lapsed === 1 ? '' : 's'} added.` };
}

/** Tells people with unused leave to plan time off (at most once a week; nudge_leave decides who). */
export async function nudgeLeaveAction(orgSlug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('nudge_leave', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  const n = Number(data);
  return { ok: true, message: n ? `${n} ${n === 1 ? 'person was' : 'people were'} nudged to plan leave.` : 'Nobody has much unused leave right now.' };
}

/** Standard leave types to add in one click: Kredily's Event leave, and maternity and paternity leave. */
const STANDARD_TYPES = {
  event: { name: 'Event leave', category: 'event', short_name: 'EV', description: 'For personal occasions such as a wedding or a bereavement in the family.',
    annual_days: 3, accrue_over_year: false, carry_forward: false, allow_half_day: true },
  maternity: { name: 'Maternity leave', category: 'maternity', short_name: 'ML', description: 'Up to 26 weeks under the Maternity Benefit Act, counted in calendar days.',
    annual_days: 182, accrue_over_year: false, carry_forward: false, count_weekends: true, count_holidays: true, allow_half_day: false, applies_to: 'assigned' },
  paternity: { name: 'Paternity leave', category: 'paternity', short_name: 'PT', description: 'For the birth or adoption of a child.',
    annual_days: 5, accrue_over_year: false, carry_forward: false, allow_half_day: false },
} as const;

export async function addStandardLeaveTypeAction(orgSlug: string, kind: keyof typeof STANDARD_TYPES): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const preset = STANDARD_TYPES[kind];
  if (!preset) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data: existing } = await supabase.from('leave_types').select('id').eq('organization_id', ctx.org.id).eq('category', preset.category).eq('is_active', true).limit(1);
  if (existing?.length) return { ok: false, message: `There is already a ${preset.name.toLowerCase()} rule.` };
  const { error } = await supabase.rpc('save_leave_rule', { p_org: ctx.org.id, p_type: null as unknown as string, p: preset });
  if (error) return { ok: false, message: toUserMessage(error) };
  done(orgSlug);
  return { ok: true, message: `${preset.name} added${'applies_to' in preset ? '; assign it to the people it applies to' : ''}.` };
}

export async function saveLeaveSettingsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const parsed = leaveSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from('leave_settings').update({
    year_start_month: v.yearStartMonth, carry_forward_expiry: v.carryForwardExpiry, skip_level_approval: v.skipLevelApproval, donation_enabled: v.donationEnabled,
  }).eq('organization_id', ctx.org.id).select('organization_id');
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (data.length === 0) return DENIED;
  done(orgSlug);
  return { ok: true, message: 'Leave settings saved.' };
}

export async function encashLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = encashLeaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (!me) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_leave_encashment', {
    p_employee: me.id, p_type: parsed.data.leaveTypeId, p_days: parsed.data.days, p_reason: sqlNull(parsed.data.reason),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  done(orgSlug);
  return { ok: true, message: 'Encashment requested. HR has been asked to approve it; it’s paid with payroll.' };
}

export async function donateLeaveAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = donateLeaveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('donate_leave', { p_to: v.toEmployeeId, p_type: v.leaveTypeId, p_days: v.days, p_note: sqlNull(v.note) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  done(orgSlug);
  return { ok: true, message: `Donated ${v.days} day${v.days === 1 ? '' : 's'}. They’ve been told.` };
}

export async function addHolidayAction(orgSlug: string, calendarId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const parsed = holidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').insert({
    organization_id: ctx.org.id, calendar_id: z.uuid().parse(calendarId), holiday_date: parsed.data.holidayDate,
    name: parsed.data.name, is_optional: parsed.data.isOptional,
  });
  if (error) {
    const message = error.code === '23505' ? 'There is already a holiday on that date.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  done(orgSlug);
  return { ok: true, message: `“${parsed.data.name}” added.` };
}

export async function removeHolidayAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug);
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('holidayId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  done(orgSlug);
  return { ok: true, message: 'Holiday removed.' };
}
