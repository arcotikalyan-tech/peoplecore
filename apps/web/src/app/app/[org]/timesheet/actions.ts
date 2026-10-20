'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';
import { requestIp } from '@/server/timesheet';

/**
 * Timesheet. Time entries go through the database functions (which apply the organization's rules and decide who may
 * log, approve or invoice); workspace and settings writes are plain table writes that RLS restricts to timesheet.manage.
 */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
const money = optional(z.coerce.number({ error: 'Enter a number' }).min(0, 'Can’t be negative').max(10_000_000));
const back = (slug: string) => revalidatePath(`/app/${slug}/timesheet`, 'layout');
const strings = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const admin = async (slug: string) => {
  const ctx = await getOrgContext(slug);
  return { ctx, ok: ctx.can('timesheet.manage', 'org') };
};

// ─── Time entries ────────────────────────────────────────────────────────────

export async function logTimeAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({
    projectId: z.uuid({ error: 'Choose a project' }),
    taskId: optional(z.uuid()),
    date: z.iso.date({ error: 'Choose a date' }),
    mode: z.enum(['start_end', 'total']),
    start: optional(z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time')),
    end: optional(z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time')),
    duration: optional(z.string().trim().regex(/^(\d{1,2})(?::([0-5]\d))?$|^\d{1,2}(\.\d{1,2})?$/, 'Enter hours like 1:30 or 1.5')),
    description: optional(z.string().trim().max(500, 'At most 500 characters')),
    billable: optional(z.literal('on')),
    employeeId: optional(z.uuid()),
  }).superRefine((v, c) => {
    if (v.mode === 'start_end' && (!v.start || !v.end)) c.addIssue({ code: 'custom', path: [v.start ? 'end' : 'start'], message: 'Enter the start and end times' });
    if (v.mode === 'total' && !v.duration) c.addIssue({ code: 'custom', path: ['duration'], message: 'Enter the hours' });
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  let minutes: number | null = null;
  if (v.mode === 'total' && v.duration) {
    const [h, m] = v.duration.includes(':') ? v.duration.split(':').map(Number) as [number, number] : [Number(v.duration), 0];
    minutes = v.duration.includes(':') ? h * 60 + m : Math.round(h * 60);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ts_log_time', {
    p_project: v.projectId, p_task: v.taskId ?? (null as unknown as string), p_date: v.date,
    p_start: v.mode === 'start_end' ? v.start! : (null as unknown as string), p_end: v.mode === 'start_end' ? v.end! : (null as unknown as string),
    p_minutes: minutes as number, p_description: v.description ?? (null as unknown as string), p_billable: v.billable === 'on',
    p_employee: v.employeeId, p_ip: (await requestIp()) ?? undefined,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  const r = data as { minutes: number; warning: string | null };
  return { ok: true, message: `Logged ${Math.floor(r.minutes / 60)}h ${String(r.minutes % 60).padStart(2, '0')}m.${r.warning ? ` ${r.warning}` : ''}` };
}

export async function deleteEntryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const id = z.uuid().safeParse(formData.get('entryId'));
  if (!id.success) return { ok: false, message: 'Entry not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('ts_delete_entry', { p_entry: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Entry deleted.' };
}

export async function startTimerAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({ projectId: z.uuid({ error: 'Choose a project' }), taskId: optional(z.uuid()), description: optional(z.string().trim().max(500)), billable: optional(z.literal('on')) })
    .safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('ts_start_timer', {
    p_project: parsed.data.projectId, p_task: parsed.data.taskId ?? (null as unknown as string),
    p_description: parsed.data.description ?? (null as unknown as string), p_billable: parsed.data.billable === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Timer started.' };
}

export async function stopTimerAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  if (formData.get('discard') === '1') {
    const { error } = await supabase.rpc('ts_discard_timer', { p_org: ctx.org.id });
    if (error) return { ok: false, message: toUserMessage(error) };
    back(slug);
    return { ok: true, message: 'Timer discarded.' };
  }
  const { data, error } = await supabase.rpc('ts_stop_timer', { p_org: ctx.org.id, p_ip: (await requestIp()) ?? undefined });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  const r = data as { minutes: number };
  await flash(r.minutes ? `Timer stopped: ${Math.floor(r.minutes / 60)}h ${String(r.minutes % 60).padStart(2, '0')}m logged.` : 'Timer stopped (under a minute, nothing logged).');
  return { ok: true, message: 'Stopped.' };
}

export async function copyLastWeekAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const week = z.iso.date().safeParse(formData.get('weekStart'));
  if (!week.success) return { ok: false, message: 'Choose a week.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ts_copy_last_week', { p_org: ctx.org.id, p_week_start: week.data, p_ip: (await requestIp()) ?? undefined });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  const r = data as { copied: number; skipped: number };
  await flash(r.copied ? `Copied ${r.copied} entr${r.copied === 1 ? 'y' : 'ies'} from last week${r.skipped ? ` (${r.skipped} skipped by the rules)` : ''}.` : 'Nothing to copy from last week.');
  return { ok: true, message: 'Copied.' };
}

// ─── Approvals ───────────────────────────────────────────────────────────────

export async function decideAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const ids = formData.getAll('entryId').filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);
  const decision = formData.get('decision') === 'reject' ? 'reject' : 'approve';
  if (ids.length === 0) return { ok: false, message: 'Select at least one log.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ts_decide', { p_entries: ids, p_decision: decision, p_reason: String(formData.get('reason') ?? '').trim() || undefined });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash(`${data} log${data === 1 ? '' : 's'} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
  return { ok: true, message: 'Done.' };
}

export async function adjustEntryAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({
    entryId: z.uuid(), hours: z.string().trim().regex(/^\d{1,2}(:[0-5]\d)?$/, 'Enter hours like 1:30'),
    description: optional(z.string().trim().max(500)), billable: optional(z.literal('on')),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const [h, m = 0] = parsed.data.hours.split(':').map(Number) as [number, number?];
  const supabase = await createClient();
  const { error } = await supabase.rpc('ts_adjust_entry', {
    p_entry: parsed.data.entryId, p_minutes: h * 60 + m, p_billable: parsed.data.billable === 'on', p_description: parsed.data.description ?? (null as unknown as string),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Entry updated.' };
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export async function addMembersAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const ids = formData.getAll('employeeId').filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);
  const rate = money.safeParse(formData.get('rate'));
  if (ids.length === 0) return { ok: false, message: 'Choose at least one person.' };
  if (!rate.success) return { ok: false, message: 'Enter a valid hourly rate.' };
  const supabase = await createClient();
  const { error } = await supabase.from('ts_members').upsert(ids.map((employee_id) => ({ organization_id: ctx.org.id, employee_id, rate: rate.data ?? null, active: true })));
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: `${ids.length} member${ids.length === 1 ? '' : 's'} added.` };
}

export async function updateMemberAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ employeeId: z.uuid(), rate: money, active: z.enum(['true', 'false']) }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('ts_members').update({ rate: parsed.data.rate ?? null, active: parsed.data.active === 'true' })
    .eq('organization_id', ctx.org.id).eq('employee_id', parsed.data.employeeId);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Saved.' };
}

export async function saveClientAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    clientId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the client').max(120),
    organisation: optional(z.string().trim().max(200)),
    email: optional(z.email({ error: 'Enter a valid email' })),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Two-letter country code'),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Three-letter currency code'),
    gstin: optional(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN')),
    financePoc: optional(z.string().trim().max(120)),
    rate: money,
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const row = { organization_id: ctx.org.id, name: v.name, organisation: v.organisation ?? null, email: v.email ?? null, country: v.country, currency: v.currency,
    gstin: v.gstin ?? null, finance_poc: v.financePoc ?? null, rate: v.rate ?? null };
  const supabase = await createClient();
  const { error } = v.clientId ? await supabase.from('ts_clients').update(row).eq('id', v.clientId).eq('organization_id', ctx.org.id)
    : await supabase.from('ts_clients').insert(row);
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a client with that name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.clientId ? 'Client saved.' : `${v.name} added.` };
}

export async function saveProjectAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    projectId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the project').max(120),
    clientId: optional(z.uuid()),
    kind: z.enum(['external', 'internal']),
    budgetType: z.enum(['hours', 'fees', 'none']),
    budgetAmount: money,
    managerId: optional(z.uuid()),
    rate: money,
    status: z.enum(['active', 'completed', 'archived']).default('active'),
  }).superRefine((v, c) => {
    if (v.kind === 'external' && !v.clientId) c.addIssue({ code: 'custom', path: ['clientId'], message: 'External projects need a client' });
    if (v.budgetType !== 'none' && !v.budgetAmount) c.addIssue({ code: 'custom', path: ['budgetAmount'], message: 'Enter the budget' });
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const members = formData.getAll('memberId').filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);
  const row = {
    organization_id: ctx.org.id, name: v.name, kind: v.kind, client_id: v.kind === 'internal' ? null : v.clientId!, budget_type: v.budgetType,
    budget_amount: v.budgetType === 'none' ? null : v.budgetAmount!, manager_employee_id: v.managerId ?? null, rate: v.rate ?? null, status: v.status,
  };
  const supabase = await createClient();
  const saved = v.projectId
    ? await supabase.from('ts_projects').update(row).eq('id', v.projectId).eq('organization_id', ctx.org.id).select('id').single()
    : await supabase.from('ts_projects').insert(row).select('id').single();
  if (saved.error) return { ok: false, message: saved.error.code === '23505' ? 'There is already a project with that name.' : toUserMessage(saved.error), values: formValues(formData) };
  const id = saved.data.id;
  // Members: replace the set with the one chosen.
  const del = await supabase.from('ts_project_members').delete().eq('project_id', id).not('employee_id', 'in', `(${members.length ? members.join(',') : '00000000-0000-0000-0000-000000000000'})`);
  if (del.error) return { ok: false, message: toUserMessage(del.error) };
  if (members.length) {
    const ins = await supabase.from('ts_project_members').upsert(members.map((employee_id) => ({ organization_id: ctx.org.id, project_id: id, employee_id })), { ignoreDuplicates: true });
    if (ins.error) return { ok: false, message: toUserMessage(ins.error) };
  }
  back(slug);
  return { ok: true, message: v.projectId ? 'Project saved.' : `${v.name} created.` };
}

export async function saveTaskAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    taskId: optional(z.uuid()), projectId: z.uuid({ error: 'Choose a project' }), name: z.string().trim().min(2, 'Name the task').max(120),
    billable: optional(z.literal('on')), rate: money, archive: optional(z.literal('1')),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = { organization_id: ctx.org.id, project_id: v.projectId, name: v.name, billable: v.billable === 'on', rate: v.rate ?? null,
    ...(v.archive ? { archived_at: new Date().toISOString() } : {}) };
  const { error } = v.taskId ? await supabase.from('ts_tasks').update(row).eq('id', v.taskId).eq('organization_id', ctx.org.id) : await supabase.from('ts_tasks').insert(row);
  if (error) return { ok: false, message: error.code === '23505' ? 'That project already has a task with this name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.archive ? 'Task archived.' : v.taskId ? 'Task saved.' : `${v.name} added.` };
}

// ─── Finance ─────────────────────────────────────────────────────────────────

export async function generateInvoiceAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ clientId: z.uuid({ error: 'Choose a client' }), projectId: optional(z.uuid()), from: z.iso.date({ error: 'Choose a start date' }), to: z.iso.date({ error: 'Choose an end date' }) })
    .safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('ts_generate_invoice', {
    p_org: ctx.org.id, p_client: parsed.data.clientId, p_project: parsed.data.projectId ?? (null as unknown as string), p_from: parsed.data.from, p_to: parsed.data.to,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  await flash('Invoice generated as a draft.');
  return { ok: true, message: 'Generated.' };
}

export async function invoiceStatusAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ invoiceId: z.uuid(), status: z.enum(['sent', 'paid', 'void']) }).safeParse(strings(formData));
  if (!parsed.success) return { ok: false, message: 'Invoice not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('ts_set_invoice_status', { p_invoice: parsed.data.invoiceId, p_status: parsed.data.status });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: `Marked ${parsed.data.status}.` };
}

// ─── Settings ────────────────────────────────────────────────────────────────

const pick = (fd: FormData, name: string, allowed: string[]) => fd.getAll(name).filter((x): x is string => typeof x === 'string' && allowed.includes(x));

export async function saveLogSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    maxBillable: z.enum(['day', 'week', 'none']), maxBillableHours: z.coerce.number({ error: 'Enter hours' }).min(0.5, 'At least half an hour').max(168),
    period: z.enum(['days', 'weeks', 'months']), overlap: z.enum(['allow', 'warn', 'restrict']), rounding: z.enum(['0', '6', '15']),
    lockBefore: optional(z.iso.date()), autoLock: optional(z.literal('on')), defaultBillable: z.enum(['true', 'false']), captureLocation: z.enum(['true', 'false']),
    dailyTarget: z.coerce.number({ error: 'Enter hours' }).min(0.5).max(24),
  }).safeParse(strings(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const methods = pick(formData, 'methods', ['start_end', 'total', 'timer']);
  if (methods.length === 0) return { ok: false, message: 'Choose at least one way to log time.', values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('timesheet_settings').upsert({
    organization_id: ctx.org.id, methods, timer_edit: pick(formData, 'timerEdit', ['self', 'manager', 'admin']), capture_location: v.captureLocation === 'true',
    max_billable: v.maxBillable, max_billable_hours: v.maxBillableHours, restrict_days: pick(formData, 'restrict', ['future', 'past', 'weekend', 'holidays', 'leave']),
    period: v.period, overlap: v.overlap, rounding: Number(v.rounding), lock_before: v.lockBefore ?? null, auto_lock: v.autoLock === 'on',
    default_billable: v.defaultBillable === 'true', daily_target_minutes: Math.round(v.dailyTarget * 60),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Time log settings saved.' };
}

export async function savePermissionSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const creators = pick(formData, 'creators', ['self', 'manager', 'admin']);
  if (creators.length === 0) return { ok: false, message: 'Choose who can create time logs.' };
  const flow = formData.get('approvalFlow') === 'manager_then_admin' ? 'manager_then_admin' : 'manager_or_admin';
  const supabase = await createClient();
  const { error } = await supabase.from('timesheet_settings').upsert({
    organization_id: ctx.org.id, creators, approval_flow: flow, approver_can_edit: formData.get('approverCanEdit') === 'on',
    rejection_reason_required: formData.get('reasonRequired') === 'on', remind_submit: formData.get('remindSubmit') === 'on', remind_missing: formData.get('remindMissing') === 'on',
  });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Permission settings saved.' };
}

const IP = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{2,39}$/i;
export async function saveIntegrationSettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await admin(slug);
  if (!ok) return DENIED;
  const ips = String(formData.get('ips') ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const bad = ips.find((ip) => !IP.test(ip));
  if (bad) return { ok: false, message: `“${bad}” isn’t an IP address.`, values: formValues(formData) };
  if (ips.length > 50) return { ok: false, message: 'At most 50 addresses.', values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from('timesheet_settings').upsert({
    organization_id: ctx.org.id, restrict_networks: formData.get('restrictNetworks') === 'on', allowed_ips: [...new Set(ips)],
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Network settings saved.' };
}
