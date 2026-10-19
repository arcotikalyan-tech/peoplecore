'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { findOrInviteUser } from '@/server/admin-users';
import { flash } from '@/server/flash';
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
  await flash('Onboarding cancelled.');
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

// ─── Company onboarding: guided plan and activation ─────────────────────────

export async function markSetupStepAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('org.manage', 'org') && !ctx.can('onboarding.manage', 'org')) return DENIED;
  const parsed = z.object({ step: z.string().regex(/^[a-z_]{3,40}$/), done: z.enum(['yes', 'no']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Step not found.' };
  const supabase = await createClient();
  const { error } = parsed.data.done === 'yes'
    ? await supabase.from('org_setup_steps').upsert({ organization_id: ctx.org.id, step_key: parsed.data.step })
    : await supabase.from('org_setup_steps').delete().eq('organization_id', ctx.org.id).eq('step_key', parsed.data.step);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/onboarding`);
  return { ok: true, message: parsed.data.done === 'yes' ? 'Marked done.' : 'Marked not done.' };
}

/** Invite employees without a sign-in, with the Employee role, linked to their record (at most 25 at a time). */
export async function activateEmployeesAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('member.manage', 'org')) return DENIED;
  const ids = formData.getAll('employeeId').map(String).filter((v) => z.uuid().safeParse(v).success).slice(0, 25);
  if (ids.length === 0) return { ok: false, message: 'Choose who to invite.' };
  const supabase = await createClient();
  const [{ data: grantable, error: gErr }, { data: emps }] = await Promise.all([
    supabase.rpc('grantable_roles', { p_org: ctx.org.id }),
    supabase.from('employees').select('id, work_email, user_id').eq('organization_id', ctx.org.id).in('id', ids),
  ]);
  if (gErr) return { ok: false, message: toUserMessage(gErr) };
  const role = (grantable ?? []).find((r) => r.key === 'employee');
  if (!role) return { ok: false, message: 'You can’t grant the Employee role.' };
  const origin = (await headers()).get('origin') ?? '';
  let invited = 0; const problems: string[] = [];
  for (const e of emps ?? []) {
    if (e.user_id) continue;
    if (!e.work_email) { problems.push('someone has no work email'); continue; }
    // Authorization was checked above; only now is the secret-key client used (CLAUDE.md).
    const account = await findOrInviteUser(e.work_email, `${origin}/auth/callback?next=/app`);
    if (!account.ok) { problems.push(account.message); continue; }
    const { error } = await supabase.rpc('add_member', { p_org: ctx.org.id, p_user_id: account.userId, p_role_ids: [role.id], p_employee_id: e.id });
    if (error) { problems.push(toUserMessage(error)); continue; }
    invited += 1;
  }
  revalidatePath(`/app/${orgSlug}`, 'layout');
  const message = `Invited ${invited} employee${invited === 1 ? '' : 's'}.${problems.length ? ` Not invited: ${[...new Set(problems)].slice(0, 2).join('; ')}.` : ''}`;
  return { ok: invited > 0 || problems.length === 0, message };
}
