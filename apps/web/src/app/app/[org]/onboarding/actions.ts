'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';

/** Onboarding and policy actions; the database checks onboarding.manage / policy.manage and membership. */

async function hr(orgSlug: string, key: 'onboarding.manage' | 'policy.manage') {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can(key, 'org') ? ctx : null;
}
const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };

export async function startOnboardingAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await hr(orgSlug, 'onboarding.manage'))) return DENIED;
  const parsed = z.object({ employeeId: z.uuid({ error: 'Choose an employee' }), templateId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('start_onboarding', { p_employee: parsed.data.employeeId, p_template: sqlNull(parsed.data.templateId) });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Onboarding started. Everyone involved has their tasks in the Inbox.' };
}

export async function cancelOnboardingAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await hr(orgSlug, 'onboarding.manage'))) return DENIED;
  const id = z.uuid().safeParse(formData.get('planId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_onboarding', { p_plan: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Onboarding cancelled.' };
}

const templateTask = z.object({
  templateId: z.uuid(),
  title: z.string().trim().min(2, 'Title is required').max(200),
  assignee: z.enum(['joiner', 'manager', 'owner']),
  dueOffsetDays: z.coerce.number().int().min(-90).max(365),
});

export async function addTemplateTaskAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'onboarding.manage');
  if (!ctx) return DENIED;
  const parsed = templateTask.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('onboarding_template_tasks').insert({
    organization_id: ctx.org.id, template_id: parsed.data.templateId, title: parsed.data.title, assignee: parsed.data.assignee,
    due_offset_days: parsed.data.dueOffsetDays, position: 100,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/onboarding`);
  return { ok: true, message: 'Task added to the template. New plans include it.' };
}

export async function removeTemplateTaskAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'onboarding.manage');
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('taskId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.from('onboarding_template_tasks').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/onboarding`);
  return { ok: true, message: 'Removed.' };
}

export async function publishPolicyAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'policy.manage');
  if (!ctx) return DENIED;
  const parsed = z.object({
    title: z.string().trim().min(2, 'Title is required').max(120),
    body: z.string().trim().min(10, 'Write the policy (at least a sentence)').max(50000),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  // A new version of an existing title retires the old one.
  const { data: previous } = await supabase.from('policy_documents').select('id, version')
    .eq('organization_id', ctx.org.id).eq('title', parsed.data.title).is('retired_at', null).maybeSingle();
  const { error } = await supabase.from('policy_documents').insert({
    organization_id: ctx.org.id, title: parsed.data.title, body: parsed.data.body, version: (previous?.version ?? 0) + 1,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  if (previous) await supabase.from('policy_documents').update({ retired_at: new Date().toISOString() }).eq('id', previous.id);
  revalidatePath(`/app/${orgSlug}/policies`);
  return { ok: true, message: previous ? `Version ${previous.version + 1} published; everyone needs to acknowledge it again.` : 'Policy published.' };
}

export async function acknowledgePolicyAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!(await getMyEmployee(ctx.org.id, ctx.user.id))) return { ok: false, message: 'Your account isn’t linked to an employee record.' };
  const id = z.uuid().safeParse(formData.get('policyId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('acknowledge_policy', { p_policy: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/policies`);
  return { ok: true, message: 'Acknowledged.' };
}
