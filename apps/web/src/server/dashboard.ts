import 'server-only';
import { createClient } from './supabase';

/**
 * The dashboard's role cards: what is waiting for the person, and for HR and payroll what needs attention.
 * Counts only, through RLS; each card links to the page that has the detail.
 */

export async function myWork(orgId: string, myEmployeeId: string | null, today: string) {
  const supabase = await createClient();
  const [approvals, training] = await Promise.all([
    supabase.rpc('my_pending_approvals', { p_org: orgId }),
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
    training: enrolments.map((e) => ({ id: e.id, title: titles.get(e.course_id) ?? 'Course', dueOn: e.due_on, overdue: !!e.due_on && e.due_on < today, mandatory: e.mandatory })),
  };
}

/** The latest payroll run that isn't cancelled, for the "payroll is computed / approved" line (payroll staff). */
export async function latestRun(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_runs').select('id, period_month, status').eq('organization_id', orgId).neq('status', 'cancelled')
    .order('period_month', { ascending: false }).limit(1).maybeSingle();
  return error ? null : data;
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

/** The next holidays on the signed-in person's own calendar (their location's, else the organization's default). */
export { upcomingHolidays } from './leave-ops';

export type DashboardSection = 'people' | 'attendance' | 'payroll' | 'helpdesk' | 'separations' | 'learning' | 'settlements';
type Named = { id: string; name: string };
type Listed = { count: number; people: Named[] };
interface Figures {
  tasks: number | null; open_tickets: number | null; breached_tickets: number | null; open_separations: number | null;
  overdue_training: number | null; settlements_to_approve: number | null; active_employees: number | null; exits_30d: number | null;
  headcount_trend: number[] | null; presence: { expected: number; at_work: number; half_days: number } | null;
  snapshot: { total: number; late: Listed; on_leave: Listed; absent: Listed } | null;
  deductions: { run: { id: string; period_month: string; employee_count: number }; pf: number; esi: number; pt: number; tds: number; pf_over_ceiling: number } | null;
}

/**
 * Every count on the dashboard in one database request (dashboard_figures), as the caller: row-level security decides
 * what is counted. Only the sections asked for are counted. A failure shows the figures as unknown rather than
 * breaking the page.
 */
export async function dashboardFigures(orgId: string, myEmployeeId: string | null, today: string, sections: DashboardSection[]) {
  const supabase = await createClient();
  const months = recentMonths(today);
  const { data, error } = await supabase.rpc('dashboard_figures', {
    p_org: orgId, p_me: myEmployeeId as string, p_today: today, p_sections: sections, p_month_ends: months.map((m) => m.last),
  });
  const f = (error ? {} : data) as Partial<Figures>;
  const p = f.presence;
  const d = f.deductions;
  const of = (n: number) => `${n} of ${d!.run.employee_count}`;
  return {
    tasks: f.tasks ?? null,
    openTickets: f.open_tickets ?? undefined,
    breachedTickets: f.breached_tickets ?? undefined,
    openSeparations: f.open_separations ?? undefined,
    overdueTraining: f.overdue_training ?? undefined,
    settlementsToApprove: f.settlements_to_approve ?? undefined,
    headcount: f.active_employees ?? null,
    exits: f.exits_30d ?? null,
    trend: f.headcount_trend ? months.map((mo, i) => ({ label: mo.label, value: f.headcount_trend![i] ?? 0 })) : null,
    /** Days at work over expected working days so far this month (excluding offs and holidays). */
    presence: p && p.expected ? Math.round(((p.at_work + p.half_days * 0.5) / p.expected) * 100) : null,
    snapshot: f.snapshot ? { total: f.snapshot.total, late: f.snapshot.late, onLeave: f.snapshot.on_leave, absent: f.snapshot.absent } : null,
    /**
     * What the latest locked payroll deducted: how many people had PF, ESI, PT and TDS taken, and how many had PF above
     * 12% of the ₹15,000 wage ceiling (fine if they opted in, worth a look). It says what was deducted, not whether that
     * was right for each person: filings and eligibility are on the Statutory page.
     */
    compliance: sections.includes('payroll') && !error ? (d ? {
      run: d.run,
      lines: [
        { label: 'PF deducted', value: of(d.pf), attention: false },
        { label: 'PF above the wage ceiling', value: d.pf_over_ceiling ? `${d.pf_over_ceiling} to check` : 'None', attention: d.pf_over_ceiling > 0 },
        { label: 'ESI deducted', value: of(d.esi), attention: false },
        { label: 'PT deducted', value: of(d.pt), attention: false },
        { label: 'TDS deducted', value: of(d.tds), attention: false },
      ],
      toCheck: d.pf_over_ceiling,
    } : { run: null, lines: [], toCheck: 0 }) : null,
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
