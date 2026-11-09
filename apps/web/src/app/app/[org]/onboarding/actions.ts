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
import { invitationFrom } from '@/server/invitation';
import { STARTER_POLICIES, unfilled } from '@/lib/policy-library';
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

const PolicyText = z.object({
  title: z.string().trim().min(2, 'Title is required').max(120),
  body: z.string().trim().min(10, 'Write the policy (at least a sentence)').max(50000),
});

/** Publishes a policy, or the next version of one with the same title (which everyone acknowledges again). */
async function publish(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, title: string, body: string) {
  // A new version of an existing title retires the old one.
  const { data: previous } = await supabase.from('policy_documents').select('id, version')
    .eq('organization_id', orgId).eq('title', title).is('retired_at', null).maybeSingle();
  const { error } = await supabase.from('policy_documents').insert({ organization_id: orgId, title, body, version: (previous?.version ?? 0) + 1 });
  if (error) return { error };
  if (previous) await supabase.from('policy_documents').update({ retired_at: new Date().toISOString() }).eq('id', previous.id);
  return { error: null, message: previous ? `Version ${previous.version + 1} published; everyone needs to acknowledge it again.` : 'Policy published.' };
}

/** Parts still marked [[like this]] (from a starter policy) must be filled in before anyone sees the policy. */
const unfinished = (body: string) => {
  const left = unfilled(body);
  return left.length ? `Fill in the parts in double brackets first: ${left.slice(0, 4).join(', ')}${left.length > 4 ? ` and ${left.length - 4} more` : ''}.` : null;
};

export async function publishPolicyAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'policy.manage');
  if (!ctx) return DENIED;
  const parsed = PolicyText.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const left = unfinished(parsed.data.body);
  if (left) return { ok: false, message: left, fieldErrors: { body: left }, values: formValues(formData) };
  const r = await publish(await createClient(), ctx.org.id, parsed.data.title, parsed.data.body);
  if (r.error) return { ok: false, message: toUserMessage(r.error), values: formValues(formData) };
  revalidatePath(`/app/${orgSlug}/policies`);
  return { ok: true, message: r.message };
}

// ─── Policy drafts (migration 20261109120000): only people who manage policies see them ────────────────────

/** Adds PeopleCore's starter policies as drafts, skipping any title already drafted or published. */
export async function addStarterPoliciesAction(orgSlug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'policy.manage');
  if (!ctx) return DENIED;
  const supabase = await createClient();
  const [{ data: published }, { data: drafts }] = await Promise.all([
    supabase.from('policy_documents').select('title').eq('organization_id', ctx.org.id).is('retired_at', null),
    supabase.from('policy_drafts').select('title').eq('organization_id', ctx.org.id),
  ]);
  const taken = new Set([...(published ?? []), ...(drafts ?? [])].map((p) => p.title.toLowerCase()));
  const add = STARTER_POLICIES.filter((p) => !taken.has(p.title.toLowerCase()));
  if (add.length === 0) return { ok: true, message: 'Every starter policy is already here, as a draft or published.' };
  const { error } = await supabase.from('policy_drafts').insert(add.map((p) => ({ organization_id: ctx.org.id, title: p.title, body: p.body, source: 'starter' })));
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/policies`);
  // The button goes once every starter policy is in, taking its own message with it: say it at the top of the page.
  const message = `${add.length} starter polic${add.length === 1 ? 'y' : 'ies'} added as drafts. Nobody else sees them until you publish.`;
  await flash(message);
  return { ok: true, message };
}

/** Saves a draft: a new one, or changes to an existing one (draftId). */
export async function saveDraftAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'policy.manage');
  if (!ctx) return DENIED;
  const parsed = PolicyText.extend({ draftId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const { draftId, title, body } = parsed.data;
  const supabase = await createClient();
  const { error } = draftId
    ? await supabase.from('policy_drafts').update({ title, body, updated_at: new Date().toISOString() }).eq('organization_id', ctx.org.id).eq('id', draftId)
    : await supabase.from('policy_drafts').insert({ organization_id: ctx.org.id, title, body });
  if (error) {
    const message = error.code === '23505' ? 'There’s already a draft with that title.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  revalidatePath(`/app/${orgSlug}/policies`);
  return { ok: true, message: 'Draft saved.' };
}

/** Publishes a draft as it was last saved, then removes the draft. */
export async function publishDraftAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'policy.manage');
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('draftId'));
  if (!id.success) return { ok: false, message: 'Draft not found.' };
  const supabase = await createClient();
  const { data: draft } = await supabase.from('policy_drafts').select('id, title, body').eq('organization_id', ctx.org.id).eq('id', id.data).maybeSingle();
  if (!draft) return { ok: false, message: 'Draft not found. It may have been published or deleted already.' };
  const left = unfinished(draft.body);
  if (left) return { ok: false, message: `${left} Edit the draft, save it, then publish.` };
  const r = await publish(supabase, ctx.org.id, draft.title, draft.body);
  if (r.error) return { ok: false, message: toUserMessage(r.error) };
  await supabase.from('policy_drafts').delete().eq('organization_id', ctx.org.id).eq('id', draft.id);
  revalidatePath(`/app/${orgSlug}/policies`);
  await flash(`“${draft.title}”: ${r.message}`);
  return { ok: true, message: r.message };
}

export async function deleteDraftAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await hr(orgSlug, 'policy.manage');
  if (!ctx) return DENIED;
  const id = z.uuid().safeParse(formData.get('draftId'));
  if (!id.success) return { ok: false, message: 'Draft not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('policy_drafts').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/policies`);
  await flash('Draft deleted.');
  return { ok: true, message: 'Draft deleted.' };
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
  const invitation = await invitationFrom(ctx);
  for (const e of emps ?? []) {
    if (e.user_id) continue;
    if (!e.work_email) { problems.push('someone has no work email'); continue; }
    // Authorization was checked above; only now is the secret-key client used (CLAUDE.md).
    const account = await findOrInviteUser(e.work_email, `${origin}/auth/callback?next=/app`, invitation);
    if (!account.ok) { problems.push(account.message); continue; }
    const { error } = await supabase.rpc('add_member', { p_org: ctx.org.id, p_user_id: account.userId, p_role_ids: [role.id], p_employee_id: e.id });
    if (error) { problems.push(toUserMessage(error)); continue; }
    invited += 1;
  }
  revalidatePath(`/app/${orgSlug}`, 'layout');
  const message = `Invited ${invited} employee${invited === 1 ? '' : 's'}.${problems.length ? ` Not invited: ${[...new Set(problems)].slice(0, 2).join('; ')}.` : ''}`;
  return { ok: invited > 0 || problems.length === 0, message };
}
