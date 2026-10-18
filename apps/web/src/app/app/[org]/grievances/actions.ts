'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formDataAll, formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { flash } from '@/server/flash';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';
import { CATEGORY_LABEL, type GrievanceCategory } from './labels';

/** Grievance actions. The database decides who may see, write on, move or staff a case. */

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const CATEGORIES = Object.keys(CATEGORY_LABEL) as [GrievanceCategory, ...GrievanceCategory[]];

export async function raiseGrievanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({
    category: z.enum(CATEGORIES, { error: 'Choose what it is about' }),
    subject: z.string().trim().min(3, 'Give it a short title').max(160),
    description: z.string().trim().min(20, 'Describe what happened in a few sentences').max(10000),
    incidentOn: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const respondents = [...new Set(formDataAll(formData, 'respondents'))];
  if (!respondents.every((r) => z.uuid().safeParse(r).success)) return { ok: false, message: 'Choose people from the list.', values: formValues(formData) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('raise_grievance', {
    p_org: ctx.org.id, p_category: v.category, p_subject: v.subject, p_description: v.description,
    p_incident_on: sqlNull(v.incidentOn), p_respondents: respondents,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  await flash('Submitted in confidence. You’ll hear back here.');
  redirect(`/app/${orgSlug}/grievances/${data}`);
}

export async function grievanceMessageAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    caseId: z.uuid(),
    body: z.string().trim().min(1, 'Write a message').max(5000),
    internal: z.preprocess((v) => v === 'on', z.boolean()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_grievance_note', { p_case: parsed.data.caseId, p_body: parsed.data.body, p_internal: parsed.data.internal });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: parsed.data.internal ? 'Internal note added.' : 'Message sent.' };
}

export async function updateGrievanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({
    caseId: z.uuid(),
    status: z.enum(['in_review', 'investigating', 'resolved', 'closed']),
    outcome: optional(z.string().trim().max(5000)),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_grievance', { p_case: v.caseId, p_status: v.status, p_outcome: sqlNull(v.outcome) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances`, 'layout');
  if (v.status === 'closed') {
    await flash('Case closed.'); // the update form goes away with it
    return { ok: true, message: 'Case closed.' };
  }
  return { ok: true, message: 'Case updated. The person who raised it has been told.' };
}

export async function withdrawGrievanceAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), reason: optional(z.string().trim().max(1000)) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_grievance', { p_case: parsed.data.caseId, p_reason: sqlNull(parsed.data.reason) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances`, 'layout');
  await flash('Withdrawn.');
  return { ok: true, message: 'Withdrawn.' };
}

export async function addInvestigatorAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), userId: z.uuid({ error: 'Choose someone' }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_grievance_access', { p_case: parsed.data.caseId, p_user: parsed.data.userId, p_allow: true });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: 'Added. They’ve been told.' };
}

export async function removeInvestigatorAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), userId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_grievance_access', { p_case: parsed.data.caseId, p_user: parsed.data.userId, p_allow: false });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  await flash('Removed from the case.');
  return { ok: true, message: 'Removed.' };
}

export async function addRespondentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ caseId: z.uuid(), employeeId: z.uuid({ error: 'Choose someone' }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_grievance_respondent', { p_case: parsed.data.caseId, p_employee: parsed.data.employeeId });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/grievances/${parsed.data.caseId}`);
  return { ok: true, message: 'Added. They can’t see this case.' };
}
