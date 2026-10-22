'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { inviteMemberSchema, memberRolesSchema, memberStatusSchema } from '@peoplecore/shared';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { formDataAll, formValues, invalid, type ActionState } from '@/lib/action-state';
import { publicEnv } from '@/lib/env';
import { toUserMessage } from '@/lib/db-errors';
import { findOrInviteUser } from '@/server/admin-users';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to manage members.' };

/** UI-level check only; the database applies the delegation rules to every statement. */
async function authorize(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  return ctx.can('member.manage', 'org') ? ctx : null;
}

function inviteValues(formData: FormData) {
  return { ...formValues(formData), roleIds: formDataAll(formData, 'roleIds').join(',') };
}

export async function inviteMemberAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    roleIds: formDataAll(formData, 'roleIds'),
    employeeId: formData.get('employeeId') ?? undefined,
  });
  if (!parsed.success) return { ...invalid(parsed.error, formData), values: inviteValues(formData) };
  const { email, roleIds, employeeId } = parsed.data;
  const supabase = await createClient();

  // Refuse roles the inviter can't grant *before* any invitation email goes out.
  const { data: grantable, error: grantableError } = await supabase.rpc('grantable_roles', { p_org: ctx.org.id });
  if (grantableError) return { ok: false, message: toUserMessage(grantableError), values: inviteValues(formData) };
  const allowed = new Set(grantable.map((r) => r.id));
  if (!roleIds.every((id) => allowed.has(id))) {
    return { ok: false, message: 'You can’t grant one or more of the selected roles.', values: inviteValues(formData) };
  }

  // Authorization has been checked above; only now is the secret-key client used (CLAUDE.md).
  const origin = (await headers()).get('origin') ?? '';
  const account = await findOrInviteUser(email, `${origin}/auth/callback?next=/app`);
  if (!account.ok) return { ok: false, message: account.message, values: inviteValues(formData) };

  const { error } = await supabase.rpc('add_member', {
    p_org: ctx.org.id,
    p_user_id: account.userId,
    p_role_ids: roleIds,
    p_employee_id: employeeId,
  });
  if (error) return { ok: false, message: toUserMessage(error), values: inviteValues(formData) };

  revalidatePath(`/app/${orgSlug}/members`);
  return {
    ok: true,
    message: account.invited
      ? `Invitation emailed to ${email}. They get access after signing in from that email.`
      : `${email} already has a PeopleCore sign-in and was added. Access starts the next time they open PeopleCore.`,
  };
}

export async function setMemberRolesAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = memberRolesSchema.safeParse({ memberId: formData.get('memberId'), roleIds: formDataAll(formData, 'roleIds') });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  const supabase = await createClient();

  // Roles the editor can't grant are shown read-only; keep them rather than treating them as removed.
  const [current, grantable] = await Promise.all([
    supabase.from('member_roles').select('role_id').eq('member_id', parsed.data.memberId),
    supabase.rpc('grantable_roles', { p_org: ctx.org.id }),
  ]);
  if (current.error || grantable.error) return { ok: false, message: toUserMessage((current.error ?? grantable.error)!) };
  const grantableIds = new Set(grantable.data.map((r) => r.id));
  const kept = current.data.map((r) => r.role_id).filter((id) => !grantableIds.has(id));
  const wanted = [...new Set([...parsed.data.roleIds.filter((id) => grantableIds.has(id)), ...kept])];

  const { error } = await supabase.rpc('set_member_roles', { p_member: parsed.data.memberId, p_role_ids: wanted });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/members`);
  return { ok: true, message: 'Roles updated.' };
}

export async function setMemberStatusAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const parsed = memberStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.memberId)
    .eq('organization_id', ctx.org.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length === 0) return { ok: false, message: 'You can’t change this member.' };
  revalidatePath(`/app/${orgSlug}/members`);
  return { ok: true, message: parsed.data.status === 'suspended' ? 'Member suspended.' : 'Member reactivated.' };
}

export async function removeMemberAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const memberId = String(formData.get('memberId') ?? '');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', ctx.org.id)
    .select('id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (data.length === 0) return { ok: false, message: 'You can’t remove this member.' };
  revalidatePath(`/app/${orgSlug}/members`);
  return { ok: true, message: 'Member removed.' };
}

/**
 * Emails a member a link to set (or reset) their password: for people who accepted an invitation without choosing
 * one, or who have lost theirs. Only a member manager, for a member of their own organization (the database lists
 * members for managers only).
 */
export async function sendPasswordLinkAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const memberId = z.uuid().safeParse(formData.get('memberId'));
  if (!memberId.success) return { ok: false, message: 'Member not found.' };
  const supabase = await createClient();
  const { data } = await supabase.rpc('member_sign_in_status', { p_org: ctx.org.id });
  const member = (data ?? []).find((m) => m.member_id === memberId.data);
  if (!member?.email) return { ok: false, message: 'Member not found.' };
  const origin = (await headers()).get('origin') ?? '';
  const { url, publishableKey } = publicEnv();
  const auth = createPlainClient(url, publishableKey, { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false } }).auth;
  const next = member.has_password ? '/set-password?reason=reset' : '/set-password';
  const { error } = await auth.resetPasswordForEmail(member.email, { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` });
  if (error) return { ok: false, message: error.status === 429 ? 'Too many emails just now. Try again in a few minutes.' : 'The email couldn’t be sent. Try again.' };
  return { ok: true, message: `Sent to ${member.email}.` };
}

/** Links a member's sign-in to an employee record, so they can punch in, apply for leave and see their pay. */
export async function linkEmployeeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = z.object({ memberId: z.uuid(), employeeId: z.uuid({ error: 'Choose an employee' }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose an employee record.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('link_member_employee', { p_member: parsed.data.memberId, p_employee: parsed.data.employeeId });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${ctx.org.slug}`, 'layout');
  return { ok: true, message: 'Linked.' };
}

export async function unlinkEmployeeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const memberId = z.uuid().safeParse(formData.get('memberId'));
  if (!memberId.success) return { ok: false, message: 'Member not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('unlink_member_employee', { p_member: memberId.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${ctx.org.slug}`, 'layout');
  return { ok: true, message: 'Unlinked.' };
}
