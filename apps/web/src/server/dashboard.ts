import 'server-only';
import type { OrgContext } from './context';
import { createClient } from './supabase';

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
