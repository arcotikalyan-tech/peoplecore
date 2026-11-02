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
import { toCreateEmployeeArgs } from '@/server/employee-args';
import { invitationFrom } from '@/server/invitation';
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
  const field = (name: string) => formData.get(name) || undefined;
  // The form's tick: on links the chosen record or adds a new one (or leaves it to the organization's rule when the
  // inviter can't add employees); off means no record. Without the tick (older forms) `record` says it.
  const shown = formData.get('recordShown') === '1';
  const tick = formData.get('addRecord') === 'on';
  const choice = !shown ? field('record') : !tick ? 'none' : field('employeeId') ? 'existing' : ctx.can('employee.create') ? 'new' : undefined;
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    roleIds: formDataAll(formData, 'roleIds'),
    record: choice,
    employeeId: field('employeeId'),
    firstName: field('firstName'),
    lastName: field('lastName'),
    dateOfJoining: field('dateOfJoining'),
  });
  if (!parsed.success) return { ...invalid(parsed.error, formData), values: inviteValues(formData) };
  const { email, roleIds, record } = parsed.data;
  // "No record" was chosen (not just left to the organization's rule): the member is marked as not an employee.
  const withoutRecord = record === 'none' && (!shown || !tick);
  const failed = (message: string): ActionState => ({ ok: false, message, values: inviteValues(formData) });
  if (record === 'new' && !ctx.can('employee.create')) return failed('You don’t have permission to add employees.');
  const supabase = await createClient();

  // Refuse roles the inviter can't grant *before* any invitation email goes out.
  const { data: grantable, error: grantableError } = await supabase.rpc('grantable_roles', { p_org: ctx.org.id });
  if (grantableError) return failed(toUserMessage(grantableError));
  const allowed = new Set(grantable.map((r) => r.id));
  if (!roleIds.every((id) => allowed.has(id))) return failed('You can’t grant one or more of the selected roles.');

  // A new employee record is saved before any invitation goes out, so a record that can't be saved sends nothing.
  let employeeId = record === 'existing' ? parsed.data.employeeId : undefined;
  if (record === 'new') {
    const { data: members, error: membersError } = await supabase.rpc('org_members', { p_org: ctx.org.id });
    if (membersError) return failed(toUserMessage(membersError));
    const member = members.find((m) => m.email?.toLowerCase() === email);
    if (member?.employee_id) return failed(`${email} already has access here, linked to ${member.employee_name ?? 'an employee record'}.`);

    const { data: id, error } = await supabase.rpc('create_employee', toCreateEmployeeArgs(ctx.org.id, {
      firstName: parsed.data.firstName!, lastName: parsed.data.lastName, workEmail: email, employmentType: 'permanent', dateOfJoining: parsed.data.dateOfJoining!,
    }));
    if (error) return failed(toUserMessage(error));
    revalidatePath(`/app/${orgSlug}`, 'layout');
    // A member with that sign-in email is linked to the new record as it is saved: there's no one to invite.
    if (member) {
      return member.status === 'suspended'
        ? { ok: true, message: `Employee record added. ${email} is suspended here, so it isn’t linked yet: link it from their row once they’re active again.` }
        : { ok: true, message: `${email} already had access here. Their employee record is added and linked, so they can punch in, apply for leave and be paid.` };
    }
    employeeId = id;
  }
  // From here on a new record already exists: if the invitation fails, offer it as an existing record so a retry links it.
  const failedAfterRecord = (message: string): ActionState => record === 'new'
    ? { ok: false, message: `Their employee record was added, but ${message}`, values: { ...inviteValues(formData), record: 'existing', employeeId: employeeId! } }
    : failed(message);

  // Authorization has been checked above; only now is the secret-key client used (CLAUDE.md).
  const origin = (await headers()).get('origin') ?? '';
  const account = await findOrInviteUser(email, `${origin}/auth/callback?next=/app`, await invitationFrom(ctx));
  if (!account.ok) return failedAfterRecord(record === 'new' ? `the invitation wasn’t sent: ${account.message}` : account.message);

  const { error } = await supabase.rpc('add_member', {
    p_org: ctx.org.id,
    p_user_id: account.userId,
    p_role_ids: roleIds,
    p_employee_id: employeeId,
    p_without_record: withoutRecord,
  });
  if (error) return failedAfterRecord(record === 'new' ? `they couldn’t be given access: ${toUserMessage(error)}` : toUserMessage(error));

  revalidatePath(`/app/${orgSlug}/members`);
  const added = record === 'new' ? ' Their employee record is added under Employees.'
    : withoutRecord ? ' They have no employee record.' : record === 'none' ? ' An employee record is added for them if your organization adds one for everyone.' : '';
  return {
    ok: true,
    message: account.invited
      ? `Invitation emailed to ${email}. They get access after signing in from that email.${added}`
      : `${email} already has a PeopleCore sign-in and was added. Access starts the next time they open PeopleCore.${added}`,
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

/** Users & roles › Add their employee records: one for every member without one who isn't marked as not an employee. */
export async function addMissingRecordsAction(orgSlug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  if (!ctx.can('employee.create')) return { ok: false, message: 'You don’t have permission to add employees.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('add_missing_employee_records', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return data
    ? { ok: true, message: `Added ${data} employee record${data === 1 ? '' : 's'}, joining today. Fill in their details under Employees.` }
    : { ok: true, message: 'Nobody needed one: the rest couldn’t be added (your plan’s employee limit) or are marked as not employees.' };
}

/** Marks a member as not an employee (an accountant, an auditor), or undoes it. */
async function setWithoutRecord(orgSlug: string, formData: FormData, without: boolean): Promise<ActionState> {
  const ctx = await authorize(orgSlug);
  if (!ctx) return DENIED;
  const memberId = z.uuid().safeParse(formData.get('memberId'));
  if (!memberId.success) return { ok: false, message: 'Choose a member.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_member_without_record', { p_member: memberId.data, p_without: without });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/members`);
  return { ok: true, message: without ? 'Marked as not an employee.' : 'They can get an employee record again.' };
}

export async function markNotEmployeeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return setWithoutRecord(orgSlug, formData, true);
}

export async function unmarkNotEmployeeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return setWithoutRecord(orgSlug, formData, false);
}
