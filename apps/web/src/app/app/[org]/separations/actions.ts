'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';
import { REASONS, TYPE_LABEL, type SeparationType } from './labels';

/** Separation actions. The database checks who may resign, start, approve, clear and cancel. */

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const reasonCategory = optional(z.enum(REASONS.map((r) => r.value) as [string, ...string[]]));

export async function resignAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({ lastDay: date, reasonCategory, reason: optional(z.string().trim().max(2000)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_resignation', {
    p_org: ctx.org.id, p_last_day: v.lastDay, p_reason_category: sqlNull(v.reasonCategory), p_reason: sqlNull(v.reason),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  await flash('Resignation submitted. Your manager and HR have been asked to approve it.');
  redirect(`/app/${orgSlug}/separations/${data}`);
}

export async function startExitAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    employeeId: z.uuid({ error: 'Choose an employee' }),
    type: z.enum(Object.keys(TYPE_LABEL) as [SeparationType, ...SeparationType[]]),
    lastDay: date,
    reasonCategory,
    reason: optional(z.string().trim().max(2000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('initiate_separation', {
    p_employee: v.employeeId, p_type: v.type, p_last_day: v.lastDay, p_reason_category: sqlNull(v.reasonCategory), p_reason: sqlNull(v.reason),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  await flash('Exit started. It goes to their manager, then HR, for approval.');
  redirect(`/app/${orgSlug}/separations/${data}`);
}

export async function setTermsAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ separationId: z.uuid(), lastDay: date, treatment: optional(z.enum(['waived', 'recovered'])) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_separation_terms', {
    p_separation: parsed.data.separationId, p_last_day: parsed.data.lastDay, p_treatment: sqlNull(parsed.data.treatment),
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/separations`, 'layout');
  return { ok: true, message: 'Terms saved.' };
}

export async function clearItemAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ itemId: z.uuid(), status: z.enum(['cleared', 'waived']), note: optional(z.string().trim().max(500)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('clear_item', { p_item: parsed.data.itemId, p_status: parsed.data.status, p_note: sqlNull(parsed.data.note) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/separations`, 'layout');
  await flash(parsed.data.status === 'cleared' ? 'Cleared.' : 'Waived.'); // the item's buttons go away
  return { ok: true, message: 'Done.' };
}

export async function withdrawAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('separationId'));
  if (!id.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_separation', { p_separation: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/separations`, 'layout');
  await flash('Withdrawn. Nothing changes for the employee.');
  return { ok: true, message: 'Withdrawn.' };
}

export async function exitInterviewAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    separationId: z.uuid(),
    recommend: z.enum(['1', '2', '3', '4', '5'], { error: 'Choose an answer' }),
    wouldReturn: optional(z.enum(['yes', 'maybe', 'no'])),
    improve: optional(z.string().trim().max(2000)),
    liked: optional(z.string().trim().max(2000)),
    alumni: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const { separationId, alumni, recommend, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_exit_interview', {
    p_separation: separationId, p_answers: { recommend: Number(recommend), ...rest }, p_alumni: alumni,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/separations`, 'layout');
  await flash('Thank you. Your answers went to HR.');
  return { ok: true, message: 'Submitted.' };
}

export async function rehireAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ separationId: z.uuid(), eligible: z.enum(['yes', 'no']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose yes or no.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_rehire_eligibility', { p_separation: parsed.data.separationId, p_eligible: parsed.data.eligible === 'yes' });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/separations`, 'layout');
  return { ok: true, message: 'Saved.' };
}
