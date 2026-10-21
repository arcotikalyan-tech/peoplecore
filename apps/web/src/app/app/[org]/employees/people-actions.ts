'use server';

import { revalidatePath } from 'next/cache';
import { todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** People workspace actions; the database checks every permission again. */

const on = (formData: FormData, key: string) => formData.get(key) === 'on';

export async function saveDirectorySettingsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.from('directory_settings').update({
    show_department: on(formData, 'department'), show_designation: on(formData, 'designation'), show_email: on(formData, 'email'),
    show_phone: on(formData, 'phone'), show_location: on(formData, 'location'),
    show_birthday: on(formData, 'birthday'), show_marital_status: on(formData, 'marital'), show_social: on(formData, 'social'),
    access: z.enum(['everyone', 'managers', 'hr']).catch('everyone').parse(formData.get('access')),
  }).eq('organization_id', ctx.org.id).select('organization_id');
  if (error) return { ok: false, message: toUserMessage(error) };
  if (!data?.length) return { ok: false, message: 'You don’t have permission to do that.' };
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Directory visibility saved.' };
}

const ids = (formData: FormData) => formData.getAll('employeeId').map(String).filter((id) => z.uuid().safeParse(id).success);

/**
 * Bulk actions on selected people: confirm probation, or move them (department, location, designation or manager)
 * from a date, through the same assignment change as the profile (history kept).
 */
export async function bulkPeopleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const selected = ids(formData);
  if (selected.length === 0) return { ok: false, message: 'Select at least one person.' };
  const op = formData.get('op');
  const supabase = await createClient();
  if (op === 'confirm') {
    const { data, error } = await supabase.rpc('confirm_probation', { p_org: ctx.org.id, p_employees: selected });
    if (error) return { ok: false, message: toUserMessage(error) };
    revalidatePath(`/app/${slug}/employees`);
    return { ok: true, message: `Confirmed ${data} ${data === 1 ? 'person' : 'people'}.${data < selected.length ? ' Others were already confirmed or have left.' : ''}` };
  }
  const field = z.enum(['department', 'location', 'designation', 'manager']).safeParse(formData.get('field'));
  const target = z.uuid().safeParse(formData.get('target'));
  if (op !== 'move' || !field.success || !target.success) return { ok: false, message: 'Choose what to change and the new value.' };
  const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(formData.get('effectiveFrom'));
  const { data: rows, error: readError } = await supabase.from('employees').select('id, department_id, designation_id, location_id, manager_employee_id')
    .eq('organization_id', ctx.org.id).in('id', selected);
  if (readError) return { ok: false, message: toUserMessage(readError) };
  let done = 0;
  const problems = new Set<string>();
  for (const e of rows ?? []) {
    if (field.data === 'manager' && target.data === e.id) { problems.add('Someone can’t report to themselves.'); continue; }
    const { error } = await supabase.rpc('change_employee_assignment', {
      p_employee_id: e.id, p_effective_from: from.success ? from.data : todayIn(ctx.org.timezone), p_change_reason: field.data === 'manager' ? 'manager_change' : 'transfer',
      p_department_id: field.data === 'department' ? target.data : e.department_id ?? undefined,
      p_designation_id: field.data === 'designation' ? target.data : e.designation_id ?? undefined,
      p_location_id: field.data === 'location' ? target.data : e.location_id ?? undefined,
      p_manager_employee_id: field.data === 'manager' ? target.data : e.manager_employee_id ?? undefined,
      p_notes: 'Bulk change from People',
    });
    if (error) problems.add(toUserMessage(error)); else done += 1;
  }
  revalidatePath(`/app/${slug}/employees`);
  if (problems.size) return { ok: done > 0, message: `Updated ${done}. ${[...problems].join(' ')}` };
  return { ok: true, message: `Updated ${done} ${done === 1 ? 'person' : 'people'}.` };
}
