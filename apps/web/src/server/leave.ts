import 'server-only';
import { legalName } from '@peoplecore/shared';
import { createClient } from './supabase';

/** Leave reads. Balances come from the ledger (leave_balances); requests through RLS (leave.read scopes). */

export async function getBalances(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('leave_balances', { p_employee: employeeId });
  if (error) throw new Error(`Failed to load leave balances (${error.code})`);
  return data.map((b) => ({ ...b, balance: Number(b.balance), pending: Number(b.pending), available: Number(b.available) }));
}

export async function getRequests(orgId: string, filter: { employeeId?: string; from?: string; to?: string; excludeEmployeeId?: string }) {
  const supabase = await createClient();
  let q = supabase.from('leave_requests')
    .select('id, employee_id, leave_type_id, start_date, end_date, half_day_start, half_day_end, days, reason, status, created_at')
    .eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  if (filter.excludeEmployeeId) q = q.neq('employee_id', filter.excludeEmployeeId);
  if (filter.from) q = q.gte('end_date', filter.from);
  if (filter.to) q = q.lte('start_date', filter.to);
  const { data, error } = await q.order('start_date', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load leave requests (${error.code})`);
  return data.map((r) => ({ ...r, days: Number(r.days) }));
}

export async function getLeaveSetup(orgId: string) {
  const supabase = await createClient();
  const [types, policies, calendars, holidays] = await Promise.all([
    supabase.from('leave_types').select('id, code, name, is_paid, allow_half_day, allow_negative, count_all_days, is_active').eq('organization_id', orgId).order('code'),
    supabase.from('leave_policies').select('id, leave_type_id, effective_from, accrual_period, accrual_days, carry_forward_max').eq('organization_id', orgId).order('effective_from', { ascending: false }),
    supabase.from('holiday_calendars').select('id, name, location_id, weekly_offs').eq('organization_id', orgId),
    supabase.from('holidays').select('id, calendar_id, holiday_date, name, is_optional').eq('organization_id', orgId).order('holiday_date'),
  ]);
  for (const r of [types, policies, calendars, holidays]) if (r.error) throw new Error('Failed to load leave settings');
  return { types: types.data!, policies: policies.data!, calendars: calendars.data!, holidays: holidays.data! };
}

export async function namesFor(orgId: string, employeeIds: string[]) {
  if (employeeIds.length === 0) return new Map<string, string>();
  const supabase = await createClient();
  const { data } = await supabase.from('employees').select('id, first_name, middle_name, last_name')
    .eq('organization_id', orgId).in('id', [...new Set(employeeIds)]);
  return new Map((data ?? []).map((e) => [e.id, legalName(e)]));
}
