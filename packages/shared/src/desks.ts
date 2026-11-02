/**
 * The role desks on the dashboard (database: dashboard_desks), shared by the website and the phone app: what each desk
 * returns, which desks a person gets from their grants, and where someone in a manager's team is today.
 */
import { hasGrant, type Grant } from './permissions.ts';
import { dayProgress, punchState, type PunchKind } from './punches.ts';

export type DeskSection = 'team' | 'hr' | 'payroll' | 'finance' | 'hiring' | 'audit' | 'devices';
type Amount = { count: number; amount: number };

export interface TeamMember {
  id: string; name: string; code: string; title: string | null; direct: boolean; notice: boolean;
  status: string | null; first_in: string | null; last_out: string | null; worked: number; late: number; breaks: number;
  punches: Array<{ punched_at: string; kind: PunchKind | null }>;
  leave: { what: string; status: 'approved' | 'pending'; half_day: boolean } | null;
  request: 'wfh' | 'on_duty' | null;
  month: { present: number; expected: number; late: number; leave: number; absent: number };
}

export interface Desks {
  team: {
    /** People reporting directly to the person, whatever their roles (members is empty without the manager role). */
    reports: number;
    members: TeamMember[];
    away: Array<{ employee_id: string; name: string; start: string; end: string; days: number; what: string; status: 'approved' | 'pending' }>;
    events: Array<{ kind: 'anniversary' | 'probation' | 'last_day' | 'joining'; employee_id: string; name: string; on: string; detail: string | null }>;
    reviews: Array<{ cycle: string; self_due: string | null; manager_due: string | null; not_started: number; to_rate: number; done: number }>;
  } | null;
  hr: {
    joining: number; joined_this_month: number; probation_due: number; probation_overdue: number; exits_to_decide: number; leaving: number;
    onboarding: number; no_manager: number; leave_pending: number; attendance_pending: number; letters_pending: number; assets_pending: number;
    moves: Array<{ kind: 'joining' | 'probation' | 'last_day'; employee_id: string; name: string; on: string; status?: string }>;
  } | null;
  payroll: {
    period: string; run: { id: string; status: string; employee_count: number; total_net: number } | null;
    leave_pending: number; attendance_pending: number; revisions_pending: number; declarations_to_review: number; loans_to_decide: number;
    emis: Amount; joiners: number; leavers: number; no_salary: number;
  } | null;
  finance: {
    runs_to_approve: Array<{ id: string; period_month: string; employee_count: number; total_net: number }>;
    claims_to_pay: Amount; invoices_to_approve: Amount; invoices_to_pay: Amount; invoices_overdue: number; settlements: number;
  } | null;
  hiring: {
    open_jobs: number; openings: number; stages: { applied: number; screening: number; interview: number; offer: number }; hired_this_month: number;
    interviews_today: number; offers_to_approve: number; offers_to_send: number; offers_out: number;
    interviews: Array<{ id: string; application_id: string; at: string; round: string; mode: string; candidate: string; job: string }>;
  } | null;
  audit: { today: number; recent: Array<{ id: number; at: string; action: string; entity: string; actor: string }> } | null;
  devices: Array<{ id: string; name: string; serial: string; active: boolean; last_punch: string | null; today: number }> | null;
}

export const NO_DESKS: Desks = { team: null, hr: null, payroll: null, finance: null, hiring: null, audit: null, devices: null };

/** The desks someone's work calls for, besides their team (which everyone gets; it is empty without reports). */
export function roleDesks(grants: readonly Grant[]): Array<Exclude<DeskSection, 'team'>> {
  const org = (key: Parameters<typeof hasGrant>[1]) => hasGrant(grants, key, 'org');
  return ([
    [org('employee.read') && (org('org.manage') || org('onboarding.manage') || org('employee.update')), 'hr'],
    [org('payroll.prepare'), 'payroll'],
    [org('payroll.approve') || org('expense.manage') || org('vendor.manage'), 'finance'],
    [org('recruitment.manage'), 'hiring'],
    [org('audit.read') && !org('org.manage'), 'audit'],
    [org('attendance.device.manage'), 'devices'],
  ] as Array<[boolean, Exclude<DeskSection, 'team'>]>).filter(([on]) => on).map(([, s]) => s);
}

export type TeamTone = 'success' | 'warning' | 'danger' | 'primary' | 'neutral' | 'ai';
export type TeamGroup = 'in' | 'out' | 'leave' | 'away' | 'off' | 'not_in' | 'absent';
export interface TeamRow { member: TeamMember; label: string; tone: TeamTone; group: TeamGroup; atWork: number; breaks: number }

const AT_WORK: Record<string, string> = { present: 'Present', half_day: 'Half day', wfh: 'Work from home', on_duty: 'On duty' };

/** Where someone in the team is today: from their punches first, then leave, offs and requests. */
export function teamRow(m: TeamMember, now: Date): TeamRow {
  const progress = m.punches.length ? dayProgress(m.punches, now, { fullDayMinutes: 480, halfDayMinutes: 240, breakMinutes: 0 }) : null;
  const row = (label: string, tone: TeamTone, group: TeamGroup): TeamRow =>
    ({ member: m, label, tone, group, atWork: progress?.atWorkMinutes ?? m.worked, breaks: progress?.breakMinutes ?? m.breaks });
  if (m.punches.length) {
    const s = punchState(m.punches);
    if (s.paused) return row(s.paused === 'lunch' ? 'At lunch' : 'On a break', 'warning', 'in');
    if (s.checkedIn) return row(m.request === 'wfh' ? 'Working from home' : m.request === 'on_duty' ? 'On duty' : 'Checked in', 'success', 'in');
    return row('Checked out', 'neutral', 'out');
  }
  if (m.status && AT_WORK[m.status]) return row(AT_WORK[m.status]!, 'success', 'out');
  if (m.leave?.status === 'approved') return row(m.leave.half_day ? `Half day · ${m.leave.what}` : m.leave.what, 'primary', 'leave');
  if (m.status === 'on_leave') return row('On leave', 'primary', 'leave');
  if (m.status === 'weekly_off' || m.status === 'holiday') return row(m.status === 'holiday' ? 'Holiday' : 'Weekly off', 'neutral', 'off');
  if (m.request === 'on_duty') return row('On duty', 'primary', 'away');
  if (m.status === 'absent') return row('Absent', 'danger', 'absent');
  return row(m.request === 'wfh' ? 'WFH · not checked in' : m.leave ? 'Not checked in · leave asked' : 'Not checked in', 'warning', 'not_in');
}

/** Today's team figures: came in, on leave, not checked in (or absent), late. */
export function teamCounts(rows: readonly TeamRow[]) {
  return {
    in: rows.filter((r) => r.group === 'in' || r.group === 'out').length,
    leave: rows.filter((r) => r.group === 'leave').length,
    notIn: rows.filter((r) => r.group === 'not_in' || r.group === 'absent').length,
    late: rows.filter((r) => r.member.late > 0).length,
  };
}

/** Someone who sees the whole organization's figures (an owner, HR) gets their direct reports as their team. */
export function directOnly(team: NonNullable<Desks['team']>): NonNullable<Desks['team']> {
  const members = team.members.filter((m) => m.direct);
  const ids = new Set(members.map((m) => m.id));
  return { ...team, members, away: team.away.filter((a) => ids.has(a.employee_id)), events: team.events.filter((e) => ids.has(e.employee_id)) };
}
