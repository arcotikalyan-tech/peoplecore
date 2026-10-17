import 'server-only';
import { legalName } from '@peoplecore/shared';
import { createClient } from './supabase';

/** Member administration reads. org_members refuses callers without member.manage. */

export async function listMembers(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('org_members', { p_org: orgId });
  if (error) throw new Error(`Failed to load members (${error.code})`);
  return data;
}
export type Member = Awaited<ReturnType<typeof listMembers>>[number];

/** Every role in the organization, plus the ids the caller is allowed to grant. */
export async function roleCatalog(orgId: string) {
  const supabase = await createClient();
  const [all, grantable] = await Promise.all([
    supabase.from('roles').select('id, key, name, description').eq('organization_id', orgId).order('name'),
    supabase.rpc('grantable_roles', { p_org: orgId }),
  ]);
  if (all.error || grantable.error) throw new Error('Failed to load roles');
  return { roles: all.data, grantableIds: grantable.data.map((r) => r.id) };
}

/** Employee records not yet linked to a sign-in account (for "link to employee record"). */
export async function unlinkedEmployees(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, employee_code, first_name, middle_name, last_name')
    .eq('organization_id', orgId)
    .is('user_id', null)
    .neq('status', 'exited')
    .order('first_name')
    .limit(500);
  if (error) throw new Error(`Failed to load employees (${error.code})`);
  return data.map((e) => ({ value: e.id, label: `${legalName(e)} (${e.employee_code})` }));
}
