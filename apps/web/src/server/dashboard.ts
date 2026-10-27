import 'server-only';
import type { Database } from '@peoplecore/db/types';
import type { OrgContext } from './context';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/**
 * The dashboard's role cards: what is waiting for the person, and for HR and payroll what needs attention.
 * Counts only, through RLS; each card links to the page that has the detail. A failed count shows as unknown
 * rather than breaking the dashboard.
 */

const count = (r: { count: number | null; error: unknown }) => (r.error ? null : (r.count ?? 0));

export async function myWork(orgId: string, myEmployeeId: string | null, today: string) {
  const supabase = await createClient();
  const [approvals, tasks, training] = await Promise.all([
    supabase.rpc('my_pending_approvals', { p_org: orgId }),
    myEmployeeId
      ? supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('assignee_employee_id', myEmployeeId).eq('status', 'open')
      : Promise.resolve({ count: 0, error: null }),
    myEmployeeId
      ? supabase.from('course_enrollments').select('id, course_id, due_on, mandatory').eq('organization_id', orgId).eq('employee_id', myEmployeeId)
        .in('status', ['assigned', 'in_progress']).order('due_on', { ascending: true, nullsFirst: false }).limit(5)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const enrolments = training.error ? [] : (training.data ?? []);
  const titles = enrolments.length
    ? new Map(((await supabase.from('courses').select('id, title').in('id', enrolments.map((e) => e.course_id))).data ?? []).map((c) => [c.id, c.title]))
    : new Map<string, string>();
  return {
    approvals: approvals.error ? null : approvals.data.length,
    tasks: count(tasks as { count: number | null; error: unknown }),
    training: enrolments.map((e) => ({ id: e.id, title: titles.get(e.course_id) ?? 'Course', dueOn: e.due_on, overdue: !!e.due_on && e.due_on < today, mandatory: e.mandatory })),
  };
}

export async function needsAttention(ctx: OrgContext, today: string) {
  const supabase = await createClient();
  const orgId = ctx.org.id;
  const [tickets, breached, separations, overdue, run, settlements] = await Promise.all([
    ctx.can('helpdesk.manage', 'org') ? supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['open', 'in_progress', 'waiting']) : null,
    ctx.can('helpdesk.manage', 'org') ? supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['open', 'in_progress', 'waiting']).not('breached_at', 'is', null) : null,
    ctx.can('separation.manage', 'org') ? supabase.from('separations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['submitted', 'approved']) : null,
    ctx.can('learning.manage', 'org') ? supabase.from('course_enrollments').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['assigned', 'in_progress']).lt('due_on', today) : null,
    ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org')
      ? supabase.from('payroll_runs').select('id, period_month, status').eq('organization_id', orgId).neq('status', 'cancelled').order('period_month', { ascending: false }).limit(1).maybeSingle()
      : null,
    ctx.can('payroll.approve', 'org') ? supabase.from('fnf_settlements').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'computed') : null,
  ]);
  return {
    openTickets: tickets ? count(tickets) : undefined,
    breachedTickets: breached ? count(breached) : undefined,
    openSeparations: separations ? count(separations) : undefined,
    overdueTraining: overdue ? count(overdue) : undefined,
    latestRun: run && !run.error ? run.data : undefined,
    settlementsToApprove: settlements ? count(settlements) : undefined,
  };
}

/** The last `n` months up to today: each month's label, first day and last day (today for the current month). */
export function recentMonths(today: string, n = 6) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k;
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const last = i === 0 ? today : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { label: first.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), first: first.toISOString().slice(0, 10), last };
  });
}

/** People employed at the end of each recent month (joined by then, not yet exited), as far as RLS lets the caller see. */
export async function headcountTrend(orgId: string, today: string, n = 6) {
  const supabase = await createClient();
  const months = recentMonths(today, n);
  const counts = await Promise.all(months.map((mo) =>
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).neq('status', 'pre_joining')
      .lte('date_of_joining', mo.last).or(`date_of_exit.is.null,date_of_exit.gt.${mo.last}`)));
  return months.map((mo, i) => ({ label: mo.label, value: count(counts[i]!) }));
}

/** Net pay of the locked run in each recent month (payroll staff only; RLS returns nothing otherwise). */
export async function payrollTrend(orgId: string, today: string, n = 6) {
  const supabase = await createClient();
  const months = recentMonths(today, n);
  const { data, error } = await supabase.from('payroll_runs').select('period_month, total_net, total_gross, employee_count')
    .eq('organization_id', orgId).eq('status', 'locked').gte('period_month', months[0]!.first).order('period_month');
  if (error) return null;
  const byMonth = new Map(data.map((r) => [r.period_month.slice(0, 7), Number(r.total_net)]));
  return { months: months.map((mo) => ({ label: mo.label, value: byMonth.get(mo.first.slice(0, 7)) ?? 0 })), latest: data.at(-1) ?? null };
}

/** Today's attendance across the people the caller may see. */
export async function attendanceToday(orgId: string, today: string) {
  const supabase = await createClient();
  const day = () => supabase.from('attendance_days').select('employee_id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('work_date', today);
  const [present, late, onLeave, absent] = await Promise.all([
    day().in('status', ['present', 'half_day', 'wfh', 'on_duty']),
    day().in('status', ['present', 'half_day', 'wfh', 'on_duty']).gt('late_minutes', 0),
    day().eq('status', 'on_leave'),
    day().eq('status', 'absent'),
  ]);
  return { present: count(present), late: count(late), onLeave: count(onLeave), absent: count(absent) };
}

/** Exits in the last 30 days, for the attrition figure. */
export async function exitsSince(orgId: string, from: string, to: string) {
  const supabase = await createClient();
  return count(await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
    .gte('date_of_exit', from).lte('date_of_exit', to));
}

/** The next holidays on the signed-in person's own calendar (their location's, else the organization's default). */
export { upcomingHolidays } from './leave-ops';

/**
 * Today's attendance snapshot with names (Kredily's Late arrival / On leave / Absent columns), over the active
 * employees the caller may see. "Absent" is everyone expected today who hasn't checked in and isn't on leave.
 */
export async function attendanceSnapshot(orgId: string, today: string) {
  const supabase = await createClient();
  const [emps, days] = await Promise.all([
    allRows((a, b) => supabase.from('employees').select('id, first_name, last_name').eq('organization_id', orgId).in('status', ['active', 'on_notice']).order('first_name').order('id').range(a, b)),
    allRows((a, b) => supabase.from('attendance_days').select('employee_id, status, late_minutes').eq('organization_id', orgId).eq('work_date', today).order('employee_id').range(a, b)),
  ]);
  const people = (emps.data ?? []).map((e) => ({ id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(' ') }));
  const byId = new Map((days.data ?? []).map((d) => [d.employee_id, d]));
  const at = ['present', 'half_day', 'wfh', 'on_duty'];
  const late = people.filter((p) => { const d = byId.get(p.id); return !!d && at.includes(d.status) && d.late_minutes > 0; });
  const onLeave = people.filter((p) => byId.get(p.id)?.status === 'on_leave');
  const off = (id: string) => ['weekly_off', 'holiday'].includes(byId.get(id)?.status ?? '');
  const absent = people.filter((p) => { const d = byId.get(p.id); return !off(p.id) && (!d || d.status === 'absent' || d.status === 'not_marked'); });
  return { total: people.length, late, onLeave, absent };
}

/** Average presence this month: days at work over expected working days so far (excluding offs and holidays). */
export async function averagePresence(orgId: string, from: string, to: string) {
  const supabase = await createClient();
  // Counted in the database: reading the rows would stop at PostgREST's 1,000.
  const days = (statuses: Array<Database['public']['Enums']['attendance_status']>) => supabase.from('attendance_days').select('employee_id', { count: 'exact', head: true })
    .eq('organization_id', orgId).gte('work_date', from).lte('work_date', to).in('status', statuses);
  const [expectedDays, atWork, halfDays] = await Promise.all([
    supabase.from('attendance_days').select('employee_id', { count: 'exact', head: true }).eq('organization_id', orgId)
      .gte('work_date', from).lte('work_date', to).not('status', 'in', '(weekly_off,holiday)'),
    days(['present', 'wfh', 'on_duty']), days(['half_day']),
  ]);
  const expected = count(expectedDays) ?? 0;
  return expected ? Math.round((((count(atWork) ?? 0) + (count(halfDays) ?? 0) * 0.5) / expected) * 100) : null;
}

/**
 * What the latest locked payroll deducted (payroll staff only; RLS returns nothing otherwise): how many people had PF,
 * ESI, PT and TDS taken, and how many had PF above 12% of the ₹15,000 wage ceiling (fine if they opted in, worth a
 * look). Counted in the database. It says what was deducted, not whether that was right for each person: filings and
 * eligibility are on the Statutory page.
 */
export async function payrollDeductions(orgId: string) {
  const supabase = await createClient();
  const run = (await supabase.from('payroll_runs').select('id, period_month, employee_count').eq('organization_id', orgId).eq('status', 'locked')
    .order('period_month', { ascending: false }).limit(1).maybeSingle()).data;
  if (!run) return { run: null, lines: [], toCheck: 0 };
  const people = (code: string, above = 0) => supabase.from('payroll_line_items').select('employee_id', { count: 'exact', head: true })
    .eq('run_id', run.id).eq('code', code).gt('amount', above);
  const [pf, esi, pt, tds, overCeiling] = await Promise.all([people('PF'), people('ESI'), people('PT'), people('TDS'), people('PF', 1800)]);
  const of = (r: Awaited<typeof pf>) => `${count(r) ?? 0} of ${run.employee_count}`;
  const over = count(overCeiling) ?? 0;
  return {
    run,
    lines: [
      { label: 'PF deducted', value: of(pf), attention: false },
      { label: 'PF above the wage ceiling', value: over ? `${over} to check` : 'None', attention: over > 0 },
      { label: 'ESI deducted', value: of(esi), attention: false },
      { label: 'PT deducted', value: of(pt), attention: false },
      { label: 'TDS deducted', value: of(tds), attention: false },
    ],
    toCheck: over,
  };
}

/** Recent payroll activity: runs and what happened to them, newest first. */
export async function payrollActivity(orgId: string, limit = 5) {
  const supabase = await createClient();
  const { data } = await supabase.from('payroll_runs').select('id, period_month, status, computed_at, approved_at, locked_at, created_at, total_net')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id, period: r.period_month, status: r.status, net: Number(r.total_net ?? 0),
    at: r.locked_at ?? r.approved_at ?? r.computed_at ?? r.created_at,
  }));
}

export async function upcomingBirthdays(orgId: string, days = 30) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('upcoming_birthdays', { p_org: orgId, p_days: days });
  return data ?? [];
}
