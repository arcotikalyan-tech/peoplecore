import 'server-only';
import { escapeLikePattern, legalName } from '@peoplecore/shared';
import { createClient } from './supabase';

/**
 * Attendance hub reads (migration 20261019000100). Everything goes through the caller's RLS: HR sees the
 * organization, managers their line, everyone else themselves. Big figures come from database aggregates
 * (attendance_day_summary, attendance_analytics), so nothing pulls a whole organization's rows.
 */

export interface DaySummary {
  byStatus: Record<string, number>;
  late: number;
  byHour: Record<string, number>;
  byLocation: Array<{ locationId: string | null; present: number; total: number }>;
}

export async function daySummary(orgId: string, date: string): Promise<DaySummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_day_summary', { p_org: orgId, p_date: date });
  return error ? null : (data as unknown as DaySummary);
}

export interface Analytics {
  daily: Array<{ date: string; present: number; expected: number }>;
  departments: Array<{ departmentId: string | null; onTime: number; worked: number }>;
  heatmap: Array<{ week: string; dow: number; late: number }>;
  avgWorkedMinutes: number;
  overtimeMinutes: number;
  lateDays: number;
  presentDays: number;
}

export async function analytics(orgId: string, from: string, to: string): Promise<Analytics | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('attendance_analytics', { p_org: orgId, p_from: from, p_to: to });
  return error ? null : (data as unknown as Analytics);
}

export interface PersonDay {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  locationId: string | null;
  status: string | null;
  firstIn: string | null;
  lastOut: string | null;
  worked: number;
  late: number;
  earlyOut: number;
  overtime: number;
  punches: number;
  regularized: boolean;
}

const PAGE = 50;

/** People in scope with their day: the daily log and the hub's team pulse. Filters run in the database. */
export async function peopleDay(orgId: string, date: string, opts: { q?: string; departmentId?: string; page?: number } = {}) {
  const supabase = await createClient();
  const page = Math.max(1, opts.page ?? 1);
  let q = supabase.from('employees')
    .select('id, employee_code, first_name, middle_name, last_name, department_id, location_id', { count: 'exact' })
    .eq('organization_id', orgId).in('status', ['active', 'on_notice']).lte('date_of_joining', date);
  if (opts.q) q = q.ilike('search_text', `%${escapeLikePattern(opts.q.toLowerCase())}%`);
  if (opts.departmentId) q = q.eq('department_id', opts.departmentId);
  const people = await q.order('first_name').order('id').range((page - 1) * PAGE, page * PAGE - 1);
  if (people.error) throw new Error(`Failed to load people (${people.error.code})`);
  const ids = people.data.map((p) => p.id);
  const days = ids.length
    ? await supabase.from('attendance_days')
        .select('employee_id, status, first_in, last_out, worked_minutes, late_minutes, early_out_minutes, overtime_minutes, punch_count, is_regularized')
        .eq('work_date', date).in('employee_id', ids)
    : { data: [], error: null };
  if (days.error) throw new Error(`Failed to load attendance (${days.error.code})`);
  const byId = new Map(days.data.map((d) => [d.employee_id, d]));
  const rows: PersonDay[] = people.data.map((p) => {
    const d = byId.get(p.id);
    return {
      id: p.id, code: p.employee_code, name: legalName(p), departmentId: p.department_id, locationId: p.location_id,
      status: d?.status ?? null, firstIn: d?.first_in ?? null, lastOut: d?.last_out ?? null, worked: d?.worked_minutes ?? 0,
      late: d?.late_minutes ?? 0, earlyOut: d?.early_out_minutes ?? 0, overtime: d?.overtime_minutes ?? 0, punches: d?.punch_count ?? 0,
      regularized: d?.is_regularized ?? false,
    };
  });
  return { rows, total: people.count ?? rows.length, page, pages: Math.max(1, Math.ceil((people.count ?? 0) / PAGE)) };
}

/** A month for a page of people: the calendar (muster) view. */
export async function monthGrid(orgId: string, month: string, opts: { q?: string; departmentId?: string; page?: number } = {}) {
  const supabase = await createClient();
  const first = `${month.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const page = Math.max(1, opts.page ?? 1);
  let q = supabase.from('employees').select('id, employee_code, first_name, middle_name, last_name', { count: 'exact' })
    .eq('organization_id', orgId).neq('status', 'pre_joining').lte('date_of_joining', last)
    .or(`date_of_exit.is.null,date_of_exit.gte.${first}`);
  if (opts.q) q = q.ilike('search_text', `%${escapeLikePattern(opts.q.toLowerCase())}%`);
  if (opts.departmentId) q = q.eq('department_id', opts.departmentId);
  const people = await q.order('first_name').order('id').range((page - 1) * PAGE, page * PAGE - 1);
  if (people.error) throw new Error(`Failed to load people (${people.error.code})`);
  const ids = people.data.map((p) => p.id);
  const days = ids.length
    ? await supabase.from('attendance_days').select('employee_id, work_date, status').gte('work_date', first).lte('work_date', last).in('employee_id', ids).limit(5000)
    : { data: [], error: null };
  if (days.error) throw new Error(`Failed to load attendance (${days.error.code})`);
  const grid = new Map<string, Map<string, string>>();
  for (const d of days.data) {
    if (!grid.has(d.employee_id)) grid.set(d.employee_id, new Map());
    grid.get(d.employee_id)!.set(d.work_date, d.status);
  }
  return {
    first, last, page, pages: Math.max(1, Math.ceil((people.count ?? 0) / PAGE)), total: people.count ?? 0,
    rows: people.data.map((p) => ({ id: p.id, code: p.employee_code, name: legalName(p), days: grid.get(p.id) ?? new Map<string, string>() })),
  };
}

export async function penaltyLog(orgId: string, month: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('attendance_penalties')
    .select('id, employee_id, cycle_month, kind, occurrences, days, detail, applied_at, reverted_at')
    .eq('organization_id', orgId).eq('cycle_month', `${month.slice(0, 7)}-01`).order('applied_at', { ascending: false }).limit(500);
  if (error) throw new Error(`Failed to load penalties (${error.code})`);
  return data.map((p) => ({ ...p, days: Number(p.days) }));
}

export async function compOffLog(orgId: string, from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('comp_off_credits').select('employee_id, work_date, days, status, credited_at, reverted_at')
    .eq('organization_id', orgId).gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).limit(500);
  if (error) throw new Error(`Failed to load comp-off (${error.code})`);
  return data.map((c) => ({ ...c, days: Number(c.days) }));
}

export async function overtimeLog(orgId: string, from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('overtime_records').select('employee_id, work_date, minutes, status, decided_at')
    .eq('organization_id', orgId).gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).limit(500);
  if (error) throw new Error(`Failed to load overtime (${error.code})`);
  return data;
}

export async function pendingOvertimeCount(orgId: string) {
  const supabase = await createClient();
  const { count } = await supabase.from('overtime_records').select('employee_id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending');
  return count ?? 0;
}

export async function attendanceRequests(orgId: string, filter: { employeeId?: string; status?: string }) {
  const supabase = await createClient();
  let q = supabase.from('attendance_requests').select('id, employee_id, kind, start_date, end_date, reason, status, created_at, approval_request_id')
    .eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  if (filter.status) q = q.eq('status', filter.status as 'pending');
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load requests (${error.code})`);
  return data;
}

export async function rulesSetup(orgId: string) {
  const supabase = await createClient();
  const [shifts, rosters, weeks, assignments, settings] = await Promise.all([
    supabase.from('shifts').select('*').eq('organization_id', orgId).order('is_default', { ascending: false }).order('name'),
    supabase.from('roster_assignments').select('id, employee_id, shift_id, effective_from, effective_to').eq('organization_id', orgId).order('effective_from', { ascending: false }).limit(1000),
    supabase.from('work_week_rules').select('*').eq('organization_id', orgId).order('is_default', { ascending: false }).order('name'),
    supabase.from('work_week_assignments').select('id, employee_id, rule_id, effective_from').eq('organization_id', orgId).order('effective_from', { ascending: false }).limit(1000),
    supabase.from('attendance_settings').select('*').eq('organization_id', orgId).maybeSingle(),
  ]);
  for (const r of [shifts, rosters, weeks, assignments]) if (r.error) throw new Error('Failed to load attendance rules');
  return { shifts: shifts.data!, rosters: rosters.data!, weeks: weeks.data!, weekAssignments: assignments.data!, settings: settings.data };
}

/** The rule and work week that apply to one person today (read-only view for employees). */
export async function myRule(orgId: string, employeeId: string, today: string) {
  const supabase = await createClient();
  const [roster, defaults, weekAssign, defaultWeek] = await Promise.all([
    supabase.from('roster_assignments').select('shift_id').eq('employee_id', employeeId).lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`).maybeSingle(),
    supabase.from('shifts').select('*').eq('organization_id', orgId).eq('is_default', true).maybeSingle(),
    supabase.from('work_week_assignments').select('rule_id').eq('employee_id', employeeId).lte('effective_from', today).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('work_week_rules').select('*').eq('organization_id', orgId).eq('is_default', true).maybeSingle(),
  ]);
  const shift = roster.data?.shift_id
    ? (await supabase.from('shifts').select('*').eq('id', roster.data.shift_id).maybeSingle()).data
    : defaults.data;
  const week = weekAssign.data?.rule_id
    ? (await supabase.from('work_week_rules').select('*').eq('id', weekAssign.data.rule_id).maybeSingle()).data
    : defaultWeek.data;
  return { shift: shift ?? null, week: week ?? null };
}

export async function structureNames(orgId: string) {
  const supabase = await createClient();
  const [departments, locations] = await Promise.all([
    supabase.from('departments').select('id, name').eq('organization_id', orgId).order('name'),
    supabase.from('locations').select('id, name').eq('organization_id', orgId).order('name'),
  ]);
  return { departments: departments.data ?? [], locations: locations.data ?? [] };
}

export async function recentDevicePunches(orgId: string, limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase.from('attendance_punches').select('id, employee_id, punched_at, device_id, received_at')
    .eq('organization_id', orgId).eq('method', 'biometric').order('received_at', { ascending: false }).limit(limit);
  return data ?? [];
}
