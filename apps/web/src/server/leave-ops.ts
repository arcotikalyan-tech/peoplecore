import 'server-only';
import { legalName, leaveCycleStart } from '@peoplecore/shared';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/**
 * Leave operations reads (migration 20261019000300): settings, rules with their current policy and assignments,
 * the balance sheet by bucket, the ledger, the requests board, encashments and the team calendar. RLS decides
 * what each caller sees; the functions used here check scope themselves.
 */

export async function getLeaveSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('leave_settings').select('year_start_month, carry_forward_expiry, skip_level_approval, donation_enabled, accrual_start')
    .eq('organization_id', orgId).maybeSingle();
  return data ?? { year_start_month: 1, carry_forward_expiry: 'never', skip_level_approval: false, donation_enabled: false, accrual_start: null };
}

/** The leave year containing `today`: its first and last day and a label like "2026-27" (or "2026"). */
export function leaveCycle(today: string, startMonth: number) {
  const start = leaveCycleStart(today, startMonth);
  const y = Number(start.slice(0, 4));
  const end = startMonth === 1 ? `${y}-12-31` : new Date(Date.UTC(y + 1, startMonth - 1, 0)).toISOString().slice(0, 10);
  return { start, end, label: startMonth === 1 ? String(y) : `${y}-${String(y + 1).slice(2)}` };
}

export type LeaveRule = Awaited<ReturnType<typeof getRules>>['rules'][number];

export async function getRules(orgId: string, today: string) {
  const supabase = await createClient();
  const [types, policies, assignments, headcount] = await Promise.all([
    supabase.from('leave_types').select('id, code, name, category, short_name, description, is_paid, allow_half_day, allow_negative, count_weekends, count_holidays, encashable, applies_to, is_active')
      .eq('organization_id', orgId).order('name'),
    supabase.from('leave_policies').select('*').eq('organization_id', orgId).order('effective_from', { ascending: false }),
    supabase.from('leave_type_assignments').select('id, employee_id, leave_type_id, effective_from').eq('organization_id', orgId),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['active', 'on_notice']),
  ]);
  if (types.error || policies.error) throw new Error('Failed to load leave rules');
  const policyFor = (typeId: string) => {
    const all = policies.data.filter((p) => p.leave_type_id === typeId);
    return all.find((p) => p.effective_from <= today) ?? all.at(-1) ?? null;
  };
  const assigned = new Map<string, number>();
  for (const a of assignments.data ?? []) assigned.set(a.leave_type_id, (assigned.get(a.leave_type_id) ?? 0) + 1);
  const rules = types.data.map((t) => {
    const p = policyFor(t.id);
    return {
      ...t,
      policy: p && { ...p, annual_days: Number(p.annual_days ?? 0), carry_forward_max: p.carry_forward_max === null ? null : Number(p.carry_forward_max),
        max_per_month: p.max_per_month === null ? null : Number(p.max_per_month), max_continuous: p.max_continuous === null ? null : Number(p.max_continuous) },
      assignedCount: t.applies_to === 'everyone' ? (headcount.count ?? 0) : (assigned.get(t.id) ?? 0),
    };
  });
  return { rules, assignments: assignments.data ?? [], headcount: headcount.count ?? 0 };
}

/** Employees for leave tables: code, name, department, manager. */
export async function leaveEmployees(orgId: string) {
  const supabase = await createClient();
  const [emps, depts] = await Promise.all([
    allRows((a, b) => supabase.from('employees').select('id, employee_code, first_name, middle_name, last_name, department_id, manager_employee_id, location_id, status, user_id')
      .eq('organization_id', orgId).neq('status', 'exited').order('first_name').order('id').range(a, b)),
    supabase.from('departments').select('id, name').eq('organization_id', orgId),
  ]);
  const dept = new Map((depts.data ?? []).map((d) => [d.id, d.name]));
  const list = (emps.data ?? []).map((e) => ({ id: e.id, code: e.employee_code, name: legalName(e), department: e.department_id ? dept.get(e.department_id) ?? null : null,
    departmentId: e.department_id, managerId: e.manager_employee_id, userId: e.user_id }));
  const byId = new Map(list.map((e) => [e.id, e]));
  return { list, byId, departments: depts.data ?? [] };
}

export async function getBalanceSheet(orgId: string, cycleStart: string, employeeId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('leave_balance_sheet', { p_org: orgId, p_cycle: cycleStart, ...(employeeId ? { p_employee: employeeId } : {}) });
  if (error) throw new Error(`Failed to load balances (${error.code})`);
  return data.map((r) => ({
    ...r, carried: Number(r.carried), credited: Number(r.credited), applied: Number(r.applied), penalty: Number(r.penalty),
    other: Number(r.other), balance: Number(r.balance), pending: Number(r.pending),
  }));
}

export async function getLedger(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await allRows((a, b) => supabase.from('leave_ledger').select('id, leave_type_id, entry_date, kind, days, note')
    .eq('employee_id', employeeId).order('entry_date').order('id').range(a, b));
  if (error || !data) throw new Error(`Failed to load the leave ledger (${error?.code})`);
  return data.map((r) => ({ ...r, days: Number(r.days) }));
}

export interface LedgerMonth { credited: number; applied: number; penalty: number; closing: number }

/** Month-by-month ledger for one leave type across a leave year (12 columns from the cycle start). */
export function ledgerMonths(rows: Awaited<ReturnType<typeof getLedger>>, typeId: string, cycleStart: string, today: string): (LedgerMonth | null)[] {
  const mine = rows.filter((r) => r.leave_type_id === typeId);
  const y = Number(cycleStart.slice(0, 4));
  const m0 = Number(cycleStart.slice(5, 7)) - 1;
  const months: (LedgerMonth | null)[] = [];
  let closing = mine.filter((r) => r.entry_date < cycleStart).reduce((s, r) => s + r.days, 0)
    + mine.filter((r) => r.entry_date === cycleStart && r.kind === 'lapse').reduce((s, r) => s + r.days, 0);
  for (let i = 0; i < 12; i++) {
    const from = new Date(Date.UTC(y, m0 + i, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m0 + i + 1, 0)).toISOString().slice(0, 10);
    if (from > today) { months.push(null); continue; }
    const inMonth = mine.filter((r) => r.entry_date >= from && r.entry_date <= to && !(r.entry_date === cycleStart && r.kind === 'lapse'));
    const sum = (f: (r: (typeof inMonth)[number]) => boolean) => inMonth.filter(f).reduce((s, r) => s + r.days, 0);
    const credited = sum((r) => r.kind === 'accrual' || r.kind === 'adjust' || r.kind === 'opening' || (r.kind === 'donation' && r.days > 0));
    const applied = -sum((r) => r.kind === 'debit' || r.kind === 'reversal');
    const penalty = -sum((r) => r.kind === 'penalty');
    closing += inMonth.reduce((s, r) => s + r.days, 0);
    months.push({ credited, applied, penalty, closing });
  }
  return months;
}

export interface BoardFilter { status?: string; typeId?: string; departmentId?: string; q?: string; from?: string; to?: string }

/** Requests with who actioned them (latest decision), newest first. */
export async function getRequestsBoard(orgId: string, f: BoardFilter, limit = 500) {
  const supabase = await createClient();
  let q = supabase.from('leave_requests')
    .select('id, employee_id, leave_type_id, start_date, end_date, half_day_start, half_day_end, days, reason, status, created_at, decided_at, approval_request_id')
    .eq('organization_id', orgId);
  if (f.status && ['pending', 'approved', 'rejected', 'cancelled'].includes(f.status)) q = q.eq('status', f.status as 'pending');
  if (f.typeId) q = q.eq('leave_type_id', f.typeId);
  if (f.from) q = q.gte('end_date', f.from);
  if (f.to) q = q.lte('start_date', f.to);
  const { data, error } = await q.order('start_date', { ascending: false }).limit(limit);
  if (error) throw new Error(`Failed to load leave requests (${error.code})`);
  const approvalIds = data.map((r) => r.approval_request_id).filter((x): x is string => !!x);
  const actions = approvalIds.length
    ? (await supabase.from('approval_actions').select('request_id, actor_user_id, decision, comment, acted_at').in('request_id', approvalIds).order('acted_at')).data ?? []
    : [];
  const lastAction = new Map<string, { actor_user_id: string; decision: string; comment: string | null }>();
  for (const a of actions) lastAction.set(a.request_id, a);
  const actorIds = [...new Set([...lastAction.values()].map((a) => a.actor_user_id))];
  const actors = actorIds.length
    ? (await supabase.from('employees').select('user_id, first_name, middle_name, last_name').eq('organization_id', orgId).in('user_id', actorIds)).data ?? []
    : [];
  const actorName = new Map(actors.map((a) => [a.user_id, legalName(a)]));
  return data.map((r) => {
    const a = r.approval_request_id ? lastAction.get(r.approval_request_id) : undefined;
    return { ...r, days: Number(r.days), actionedBy: a ? actorName.get(a.actor_user_id) ?? 'HR' : null, comment: a?.comment ?? null };
  });
}

export async function getEncashments(orgId: string, employeeId?: string) {
  const supabase = await createClient();
  let q = supabase.from('leave_encashments').select('id, employee_id, leave_type_id, days, reason, status, created_at, decided_at').eq('organization_id', orgId);
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data } = await q.order('created_at', { ascending: false }).limit(200);
  return (data ?? []).map((r) => ({ ...r, days: Number(r.days) }));
}

export async function teamCalendar(orgId: string, from: string, to: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('team_leave_calendar', { p_org: orgId, p_from: from, p_to: to });
  return data ?? [];
}

/**
 * The signed-in person's holiday calendar (their location's, else the organization's default). Holidays are per
 * calendar, so lists without it showed every location's holidays.
 */
export async function myHolidayCalendar(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: mine } = await supabase.rpc('my_holiday_calendar', { p_org: orgId });
  if (mine) return mine as string;
  const { data } = await supabase.from('holiday_calendars').select('id').eq('organization_id', orgId).is('location_id', null).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function upcomingHolidays(orgId: string, from: string, limit = 6) {
  const supabase = await createClient();
  const calendar = await myHolidayCalendar(orgId);
  if (!calendar) return [];
  const { data } = await supabase.from('holidays').select('id, holiday_date, name, is_optional').eq('organization_id', orgId).eq('calendar_id', calendar)
    .gte('holiday_date', from).order('holiday_date').limit(limit);
  return data ?? [];
}

export async function holidaysBetween(orgId: string, from: string, to: string) {
  const supabase = await createClient();
  const calendar = await myHolidayCalendar(orgId);
  if (!calendar) return [];
  const { data } = await supabase.from('holidays').select('id, holiday_date, name, is_optional').eq('organization_id', orgId).eq('calendar_id', calendar)
    .gte('holiday_date', from).lte('holiday_date', to).order('holiday_date');
  return data ?? [];
}
