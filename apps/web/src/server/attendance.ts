import 'server-only';
import { createClient } from './supabase';

/** Attendance reads. RLS limits everything to the caller's attendance.read scope. */

/** Punches from the last `hoursBack` hours (wide enough to cover "today" in any time zone). */
export async function getPunches(orgId: string, employeeId: string, hoursBack: number) {
  const fromIso = new Date(Date.now() - hoursBack * 3600_000).toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase.from('attendance_punches').select('id, punched_at, method')
    .eq('organization_id', orgId).eq('employee_id', employeeId).gte('punched_at', fromIso).order('punched_at');
  if (error) throw new Error(`Failed to load punches (${error.code})`);
  return data;
}

export async function getDays(orgId: string, filter: { employeeId?: string; from: string; to: string }) {
  const supabase = await createClient();
  let q = supabase.from('attendance_days')
    .select('employee_id, work_date, status, first_in, last_out, worked_minutes, late_minutes, punch_count, leave_days, is_regularized')
    .eq('organization_id', orgId).gte('work_date', filter.from).lte('work_date', filter.to);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  const { data, error } = await q.order('work_date', { ascending: false }).limit(2000);
  if (error) throw new Error(`Failed to load attendance (${error.code})`);
  return data;
}

/** The employee's month, recomputed from source data first (attendance_days_for). */
export async function getMyMonth(employeeId: string, month: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_days_for', { p_employee: employeeId, p_month: month });
  if (error) throw new Error(`Failed to load your attendance (${error.code})`);
  return data;
}

export async function getRegularizations(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('regularization_requests').select('id, work_date, check_in, check_out, reason, status, created_at')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(20);
  if (error) throw new Error(`Failed to load regularizations (${error.code})`);
  return data;
}

export async function getOpenAnomalies(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('anomaly_flags').select('id, employee_id, rule, explanation, created_at')
    .eq('organization_id', orgId).eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(`Failed to load anomalies (${error.code})`);
  return data;
}

export async function getMonthSummary(orgId: string, month: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_month_summary', { p_org: orgId, p_month: month });
  if (error) throw new Error(`Failed to build the monthly summary (${error.code})`);
  return data.map((r) => ({ ...r, present: Number(r.present), paid_leave: Number(r.paid_leave), unpaid_leave: Number(r.unpaid_leave), payable_days: Number(r.payable_days), lop_days: Number(r.lop_days) }));
}

export async function getAttendanceSetup(orgId: string) {
  const supabase = await createClient();
  const [shifts, rosters, geofences, devices] = await Promise.all([
    supabase.from('shifts').select('*').eq('organization_id', orgId).order('code'),
    supabase.from('roster_assignments').select('id, employee_id, shift_id, effective_from, effective_to').eq('organization_id', orgId).order('effective_from', { ascending: false }).limit(200),
    supabase.from('geofences').select('*').eq('organization_id', orgId).order('name'),
    supabase.from('biometric_devices').select('*').eq('organization_id', orgId).order('name'),
  ]);
  for (const r of [shifts, rosters, geofences, devices]) if (r.error) throw new Error('Failed to load attendance settings');
  return { shifts: shifts.data!, rosters: rosters.data!, geofences: geofences.data!, devices: devices.data! };
}
