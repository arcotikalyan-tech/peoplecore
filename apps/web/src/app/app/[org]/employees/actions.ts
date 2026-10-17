'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { changeAssignmentSchema, createEmployeeSchema, todayIn } from '@peoplecore/shared';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
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

  revalidatePath(`/app/${orgSlug}`, 'layout');
  redirect(`/app/${orgSlug}/employees/${id}?created=1`);
}

export async function changeAssignmentAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('employee.update', 'org')) return { ok: false, message: 'You don’t have permission to change assignments.' };

  const parsed = changeAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  // The DB records future-dated changes, but the job that applies them to the current snapshot
  // doesn't exist yet (Phase 3). Until it does, only accept changes effective today or earlier.
  if (parsed.data.effectiveFrom > todayIn(ctx.org.timezone)) {
    return { ok: false, fieldErrors: { effectiveFrom: 'Future-dated changes aren’t supported yet.' }, values: formValues(formData) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('change_employee_assignment', toChangeAssignmentArgs(parsed.data));
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };

  revalidatePath(`/app/${orgSlug}/employees/${parsed.data.employeeId}`);
  return { ok: true, message: 'Assignment recorded.' };
}
