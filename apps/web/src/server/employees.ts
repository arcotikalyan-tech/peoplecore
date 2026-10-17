import 'server-only';
import type { Tables } from '@peoplecore/db/types';
import { escapeLikePattern, legalName, pageCount, parsePageRequest, type EmployeeListQuery } from '@peoplecore/shared';
import { createClient } from './supabase';

/** Employee reads. All go through the user's RLS-bound client; scopes (org/team/self) apply automatically. */

export type Employee = Tables<'employees'>;
export type EmploymentRecord = Tables<'employment_records'>;

const LIST_COLUMNS =
  'id, employee_code, first_name, middle_name, last_name, work_email, status, employment_type, date_of_joining, probation_end_date, department_id, designation_id' as const;

export async function listEmployees(orgId: string, query: EmployeeListQuery) {
  const supabase = await createClient();
  const range = parsePageRequest({ page: query.page });
  let request = supabase.from('employees').select(LIST_COLUMNS, { count: 'exact' }).eq('organization_id', orgId);
  if (query.q) request = request.ilike('search_text', `%${escapeLikePattern(query.q.toLowerCase())}%`);
  if (query.status) request = request.eq('status', query.status);
  if (query.department) request = request.eq('department_id', query.department);

  const { data, count, error } = await request.order('first_name').order('last_name').order('id').range(range.from, range.to);
  // PGRST103: requested page is past the end (e.g. a stale link after filtering).
  if (error?.code === 'PGRST103') return { rows: [], total: 0, page: range.page, pageCount: 1, outOfRange: true };
  if (error) throw new Error(`Failed to load employees (${error.code})`);
  const total = count ?? 0;
  return { rows: data, total, page: range.page, pageCount: pageCount(total, range.pageSize), outOfRange: false };
}

export async function countEmployees(orgId: string, filter: { status?: Employee['status']; probationEndsBetween?: [string, string] }) {
  const supabase = await createClient();
  let request = supabase.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  if (filter.status) request = request.eq('status', filter.status);
  if (filter.probationEndsBetween) {
    request = request
      .gte('probation_end_date', filter.probationEndsBetween[0])
      .lte('probation_end_date', filter.probationEndsBetween[1])
      .neq('status', 'exited');
  }
  const { count, error } = await request;
  if (error) throw new Error(`Failed to count employees (${error.code})`);
  return count ?? 0;
}

export async function upcomingJoiners(orgId: string, limit = 5) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, middle_name, last_name, date_of_joining, designation_id')
    .eq('organization_id', orgId)
    .eq('status', 'pre_joining')
    .order('date_of_joining')
    .limit(limit);
  if (error) throw new Error(`Failed to load joiners (${error.code})`);
  return data;
}

export async function probationDue(orgId: string, from: string, to: string, limit = 5) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, middle_name, last_name, probation_end_date')
    .eq('organization_id', orgId)
    .neq('status', 'exited')
    .gte('probation_end_date', from)
    .lte('probation_end_date', to)
    .order('probation_end_date')
    .limit(limit);
  if (error) throw new Error(`Failed to load probation reviews (${error.code})`);
  return data;
}

export async function getEmployee(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('employees').select('*').eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load employee (${error.code})`);
  return data;
}

export async function getMyEmployee(orgId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, middle_name, last_name, employee_code, status')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load your profile (${error.code})`);
  return data;
}

export async function getEmploymentHistory(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employment_records')
    .select('*')
    .eq('organization_id', orgId)
    .eq('employee_id', employeeId)
    .order('effective_from', { ascending: false });
  if (error) throw new Error(`Failed to load employment history (${error.code})`);
  return data;
}

/** id → full name, for the employees the caller is allowed to see (others are simply absent). */
export async function employeeNames(orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, first_name, middle_name, last_name')
    .eq('organization_id', orgId)
    .in('id', unique);
  if (error) throw new Error(`Failed to load names (${error.code})`);
  return new Map(data.map((e) => [e.id, legalName(e)]));
}

/** user id → employee name (for audit actors). */
export async function namesForUsers(orgId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('user_id, first_name, middle_name, last_name')
    .eq('organization_id', orgId)
    .in('user_id', unique);
  if (error) throw new Error(`Failed to load names (${error.code})`);
  return new Map(data.flatMap((e) => (e.user_id ? [[e.user_id, legalName(e)] as const] : [])));
}

/**
 * Manager picker options. Capped at 500: large tenants need a server-side search combobox
 * (tracked in BUILD_STATUS known issues).
 */
export async function managerOptions(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employees')
    .select('id, employee_code, first_name, middle_name, last_name')
    .eq('organization_id', orgId)
    .neq('status', 'exited')
    .order('first_name')
    .order('last_name')
    .limit(500);
  if (error) throw new Error(`Failed to load managers (${error.code})`);
  return data.map((e) => ({ value: e.id, label: `${legalName(e)} (${e.employee_code})` }));
}
