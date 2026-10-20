'use server';

import { revalidatePath } from 'next/cache';
import { CANDIDATE_SOURCES } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Hiring OS: plans, talent pools, email templates, spend and automations. recruitment.manage; RLS decides. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
const back = (slug: string) => revalidatePath(`/app/${slug}/recruitment`, 'layout');
const manager = async (slug: string) => {
  const ctx = await getOrgContext(slug);
  return { ctx, ok: ctx.can('recruitment.manage', 'org') };
};
const uuids = (fd: FormData, name: string) => fd.getAll(name).filter((x): x is string => typeof x === 'string' && z.uuid().safeParse(x).success);

export async function createPlanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    name: z.string().trim().min(2, 'Name the plan').max(120),
    periodKind: z.enum(['month', 'quarter', 'year']),
    periodStart: z.string().regex(/^\d{4}-\d{2}$/, 'Choose the first month'),
    note: optional(z.string().trim().max(500)),
  }).safeParse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === 'string')));
  if (!parsed.success) return invalid(parsed.error, formData);
  const lines = [...formData.entries()].flatMap(([k, v]) => {
    const m = /^hc_([0-9a-f-]{36})$/.exec(k);
    const n = Number(v);
    return m && typeof v === 'string' && v.trim() !== '' && Number.isInteger(n) && n > 0 ? [{ department_id: m[1]!, headcount: Math.min(n, 10000) }] : [];
  });
  if (lines.length === 0) return { ok: false, message: 'Enter the headcount for at least one department.', values: formValues(formData) };
  const supabase = await createClient();
  const plan = await supabase.from('hiring_plans').insert({
    organization_id: ctx.org.id, name: parsed.data.name, period_kind: parsed.data.periodKind, period_start: `${parsed.data.periodStart}-01`, note: parsed.data.note ?? null,
  }).select('id').single();
  if (plan.error) return { ok: false, message: toUserMessage(plan.error), values: formValues(formData) };
  const { error } = await supabase.from('hiring_plan_lines').insert(lines.map((l) => ({ ...l, organization_id: ctx.org.id, plan_id: plan.data.id })));
  if (error) {
    await supabase.from('hiring_plans').delete().eq('id', plan.data.id);
    return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  }
  back(slug);
  return { ok: true, message: `${parsed.data.name} created.` };
}

export async function deletePlanAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('planId'));
  if (!id.success) return { ok: false, message: 'Plan not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('hiring_plans').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Plan deleted.' };
}

export async function createPoolAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const parsed = z.object({ name: z.string().trim().min(2, 'Name the pool').max(80), description: optional(z.string().trim().max(300)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('talent_pools').insert({ organization_id: ctx.org.id, name: parsed.data.name, description: parsed.data.description ?? null });
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a pool with that name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: `${parsed.data.name} created.` };
}

export async function deletePoolAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('poolId'));
  if (!id.success) return { ok: false, message: 'Pool not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('talent_pools').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash('Pool deleted. The candidates stay in Candidates.');
  return { ok: true, message: 'Deleted.' };
}

export async function addToPoolAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const pool = z.uuid().safeParse(formData.get('poolId'));
  const ids = uuids(formData, 'candidateId');
  if (!pool.success) return { ok: false, message: 'Choose a pool.' };
  if (ids.length === 0) return { ok: false, message: 'Select at least one candidate.' };
  const supabase = await createClient();
  const { error } = await supabase.from('talent_pool_members').upsert(ids.map((candidate_id) => ({ organization_id: ctx.org.id, pool_id: pool.data, candidate_id })), { ignoreDuplicates: true });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: `${ids.length} candidate${ids.length === 1 ? '' : 's'} added to the pool.` };
}

export async function removeFromPoolAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const pool = z.uuid().safeParse(formData.get('poolId'));
  const cand = z.uuid().safeParse(formData.get('candidateId'));
  if (!pool.success || !cand.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('talent_pool_members').delete().eq('organization_id', ctx.org.id).eq('pool_id', pool.data).eq('candidate_id', cand.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Removed.' };
}

export async function saveTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    templateId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the template').max(80),
    kind: z.enum(['application_received', 'interview_invite', 'rejection', 'offer', 'follow_up', 'custom']),
    subject: z.string().trim().min(2, 'Enter a subject').max(200),
    body: z.string().trim().min(2, 'Write the message').max(5000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const row = { organization_id: ctx.org.id, name: v.name, kind: v.kind, subject: v.subject, body: v.body };
  const { error } = v.templateId ? await supabase.from('recruiting_email_templates').update(row).eq('organization_id', ctx.org.id).eq('id', v.templateId)
    : await supabase.from('recruiting_email_templates').insert(row);
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a template with that name.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.templateId ? 'Template saved.' : `${v.name} added.` };
}

export async function deleteTemplateAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('templateId'));
  if (!id.success) return { ok: false, message: 'Template not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('recruiting_email_templates').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Template deleted.' };
}

export async function addSpendAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const parsed = z.object({
    source: z.enum(CANDIDATE_SOURCES, { error: 'Choose a source' }),
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Choose a month'),
    amount: z.coerce.number({ error: 'Enter an amount' }).positive('Enter an amount').max(999_999_999),
    note: optional(z.string().trim().max(200)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('recruiting_spend').insert({
    organization_id: ctx.org.id, source: parsed.data.source, month: `${parsed.data.month}-01`, amount: parsed.data.amount, note: parsed.data.note ?? null,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: 'Spend recorded.' };
}

export async function deleteSpendAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const id = z.uuid().safeParse(formData.get('spendId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('recruiting_spend').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Removed.' };
}

export async function saveAutomationsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, ok } = await manager(slug);
  if (!ok) return DENIED;
  const days = z.coerce.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days').safeParse(formData.get('stallDays'));
  if (!days.success) return { ok: false, message: 'Stalled after must be between 1 and 90 days.', values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_recruiting_automations', { p_org: ctx.org.id, p_stall_days: days.data, p_notify: formData.get('notify') === 'on' });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: 'Automations saved.' };
}
