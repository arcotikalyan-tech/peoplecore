'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { changeAssignmentSchema, createEmployeeSchema, todayIn } from '@peoplecore/shared';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { findOrInviteUser } from '@/server/admin-users';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { toChangeAssignmentArgs, toCreateEmployeeArgs } from '@/server/employee-args';
import { createClient } from '@/server/supabase';

/**
 * The org slug is bound by the page. It only *selects* the tenant: getOrgContext resolves it through
 * RLS (non-members get a 404) and the RPC re-checks employee.create in the database.
 */
export async function createEmployeeAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.create')) return { ok: false, message: 'You don’t have permission to add employees.' };

  const parsed = createEmployeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('create_employee', toCreateEmployeeArgs(ctx.org.id, parsed.data));
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };

  if (formData.get('invite') === 'on' && parsed.data.workEmail && ctx.can('member.manage', 'org')) await flash(await inviteNewEmployee(ctx.org.id, id, parsed.data.workEmail));
  revalidatePath(`/app/${orgSlug}`, 'layout');
  redirect(`/app/${orgSlug}/employees/${id}?created=1`);
}

/**
 * Invites a just-added employee to sign in with the Employee role, linked to their record (Keka's "invite employee to
 * login"). A record whose work email is already a member's sign-in was linked as it was saved, so nothing is sent.
 * Returns what happened, for the confirmation.
 */
async function inviteNewEmployee(orgId: string, employeeId: string, email: string): Promise<string> {
  const supabase = await createClient();
  const { data: emp } = await supabase.from('employees').select('user_id').eq('id', employeeId).maybeSingle();
  if (emp?.user_id) return `Employee added and linked to their existing sign-in (${email}).`;
  const { data: grantable } = await supabase.rpc('grantable_roles', { p_org: orgId });
  const role = (grantable ?? []).find((r) => r.key === 'employee');
  if (!role) return 'Employee added. You can’t grant the Employee role, so no invitation was sent.';
  // Authorization (member.manage, the grantable role) is checked above; only now is the secret-key client used.
  const origin = (await headers()).get('origin') ?? '';
  const account = await findOrInviteUser(email, `${origin}/auth/callback?next=/app`);
  if (!account.ok) return `Employee added. The invitation wasn’t sent: ${account.message}`;
  const { error } = await supabase.rpc('add_member', { p_org: orgId, p_user_id: account.userId, p_role_ids: [role.id], p_employee_id: employeeId });
  if (error) return `Employee added. They couldn’t be added as a member: ${toUserMessage(error)}`;
  return account.invited ? `Employee added and invited: ${email} gets an email to set a password.` : `Employee added. ${email} already had a PeopleCore sign-in and can now use it here.`;
}

export async function changeAssignmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.update', 'org')) return { ok: false, message: 'You don’t have permission to change assignments.' };

  const parsed = changeAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('change_employee_assignment', toChangeAssignmentArgs(parsed.data));
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };

  revalidatePath(`/app/${orgSlug}/employees/${parsed.data.employeeId}`);
  // Future-dated changes are recorded now and applied by the worker on the day (worker_daily_core_hr).
  const future = parsed.data.effectiveFrom > todayIn(ctx.org.timezone);
  return { ok: true, message: future ? 'Change scheduled. It takes effect on the date you chose.' : 'Assignment recorded.' };
}
