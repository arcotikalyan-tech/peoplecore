import 'server-only';
import { workforcePlan } from '@peoplecore/shared';
import type { AnalyticsPort, AnalyticsScope, HeadcountGroup } from '@peoplecore/ai';
import { createClient } from './supabase';

/**
 * Workforce aggregates (migration 20261018003100). The functions run as the signed-in user, so every figure
 * covers only what that person can see: HR the organization, a manager their reporting line.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

const n = (v: unknown) => (v == null ? 0 : Number(v));

function check<T>(r: { data: T | null; error: { code?: string } | null }, what: string): T {
  if (r.error) throw new Error(`Failed to load ${what} (${r.error.code})`);
  return r.data as T;
}

export function analyticsPort(supabase: Client, orgId: string): AnalyticsPort {
  return {
    async scope() {
      const s = check(await supabase.rpc('analytics_scope', { p_org: orgId }), 'scope') as { scope: AnalyticsScope; employees_visible: number; today: string };
      return { scope: s.scope, employeesVisible: n(s.employees_visible), today: s.today };
    },
    async headcount(asOf: string | null, groupBy: HeadcountGroup) {
      const rows = check(await supabase.rpc('analytics_headcount', { p_org: orgId, p_as_of: (asOf ?? null) as string, p_group: groupBy }), 'headcount');
      return rows.map((r) => ({ label: r.label, headcount: n(r.headcount) }));
    },
    async movements(from, to) {
      const rows = check(await supabase.rpc('analytics_movements', { p_org: orgId, p_from: from, p_to: to }), 'joiners and leavers');
      return rows.map((r) => ({ month: r.month, joiners: n(r.joiners), leavers: n(r.leavers), headcountEnd: n(r.headcount_end) }));
    },
    async leave(from, to) {
      const rows = check(await supabase.rpc('analytics_leave', { p_org: orgId, p_from: from, p_to: to }), 'leave');
      return rows.map((r) => ({ leaveType: r.leave_type, requests: n(r.requests), days: n(r.days), people: n(r.people) }));
    },
    async attendance(from, to) {
      const rows = check(await supabase.rpc('analytics_attendance', { p_org: orgId, p_from: from, p_to: to }), 'attendance');
      return rows.map((r) => ({ status: r.status, days: n(r.days), people: n(r.people), lateDays: n(r.late_days) }));
    },
    async payroll(months) {
      const rows = check(await supabase.rpc('analytics_payroll', { p_org: orgId, p_months: months }), 'payroll');
      return rows.map((r) => ({
        month: r.month, status: r.status, employees: n(r.employees), gross: n(r.gross), deductions: n(r.deductions), net: n(r.net), employerCost: n(r.employer_cost),
      }));
    },
    async recruitment() {
      const r = check(await supabase.rpc('analytics_recruitment', { p_org: orgId }), 'recruitment') as {
        open_requisitions: number; openings: number; applications_by_stage: Record<string, number>; hired_last_90_days: number;
      };
      return { openRequisitions: n(r.open_requisitions), openings: n(r.openings), applicationsByStage: r.applications_by_stage ?? {}, hiredLast90Days: n(r.hired_last_90_days) };
    },
    async helpdesk(from, to) {
      const rows = check(await supabase.rpc('analytics_helpdesk', { p_org: orgId, p_from: from, p_to: to }), 'helpdesk');
      return rows.map((r) => ({ status: r.status, tickets: n(r.tickets), breached: n(r.breached), medianHoursToResolve: r.median_hours_to_resolve == null ? null : n(r.median_hours_to_resolve) }));
    },
    async learning() {
      const rows = check(await supabase.rpc('analytics_learning', { p_org: orgId }), 'training');
      return rows.map((r) => ({ course: r.course, assigned: n(r.assigned), completed: n(r.completed), overdue: n(r.overdue) }));
    },
  };
}

/** The standard reports on the Insights page: headcount by department, the last 12 months' movements, this year's leave. */
export async function insights(orgId: string, today: string) {
  const port = analyticsPort(await createClient(), orgId);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  const [scope, departments, movements, leave, learning] = await Promise.all([
    port.scope(),
    port.headcount(today, 'department'),
    port.movements(yearAgo, today),
    port.leave(`${today.slice(0, 4)}-01-01`, today),
    port.learning(),
  ]);
  const months = movements.slice(-12);
  const leavers = months.reduce((s, m) => s + m.leavers, 0);
  const avg = months.length ? months.reduce((s, m) => s + m.headcountEnd, 0) / months.length : 0;
  return {
    scope, departments, months, leave,
    joiners: months.reduce((s, m) => s + m.joiners, 0), leavers, averageHeadcount: avg,
    attritionPct: avg ? Math.round((leavers / avg) * 1000) / 10 : null,
    // Training gaps: courses with anyone assigned, most overdue first, then the lowest completion.
    courses: learning.filter((c) => c.assigned > 0)
      .map((c) => ({ ...c, completionPct: Math.round((c.completed / c.assigned) * 100) }))
      .sort((a, b) => b.overdue - a.overdue || a.completionPct - b.completionPct).slice(0, 40),
  };
}

/** The hiring plan for a growth target over a horizon, from the headcount and attrition the person can see. */
export function planFrom(data: Awaited<ReturnType<typeof insights>>, growthPct: number, months: number) {
  return workforcePlan({
    departments: data.departments.map((d) => ({ name: d.label, headcount: d.headcount })),
    leaversLast12Months: data.leavers, averageHeadcount: data.averageHeadcount, growthPct, months,
  });
}
