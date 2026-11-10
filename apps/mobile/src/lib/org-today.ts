import type { TeamMember } from '@peoplecore/shared/desks';
import { supabase } from './supabase';
import { must } from './use-load';

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;

/** The whole organization today, for people who read everyone's attendance (an owner, HR): the website's figures and each person's day. */
export interface OrgToday {
  /** Active employees, exits in the last 30 days and days at work over working days this month (%), as on the website's dashboard. */
  headcount: number | null;
  exits: number | null;
  presence: number | null;
  /** Everyone working today, in the shape of a manager's team so the same rows and figures apply. */
  members: TeamMember[];
}

type Figures = { active_employees?: number | null; exits_30d?: number | null; presence?: { expected: number; at_work: number; half_days: number } | null };
export interface Person { id: string; first_name: string; last_name: string | null; employee_code: string; job_title: string | null; status: string }
export interface Day { employee_id: string; status: string; first_in: string | null; last_out: string | null; worked_minutes: number | null; late_minutes: number | null; break_minutes: number | null }
export interface Punch { employee_id: string; punched_at: string; kind: TeamMember['punches'][number]['kind'] }
export interface Leave { employee_id: string; status: string; start_date: string; end_date: string; half_day_start: boolean; half_day_end: boolean; leave_type_id: string }
export interface Request { employee_id: string; kind: string }

/** Every row of a query, a page at a time (an organization can have more than 1,000 people or punches in a day). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const data = must(await page(from, from + PAGE - 1)) as T[] | null;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Read as the signed-in person, so row-level security decides what they see. Each person's status is worked out as on a
 * manager's team (dashboard_desks): today's punches first, then approved leave, offs, and WFH or on-duty requests.
 */
export async function loadOrgToday(orgId: string, myEmployeeId: string | null, today: string, seesPeople: boolean): Promise<OrgToday> {
  const [figures, people, days, leave, requests, types] = await Promise.all([
    supabase.rpc('dashboard_figures', { p_org: orgId, p_me: myEmployeeId as string, p_today: today, p_sections: seesPeople ? ['people', 'attendance'] : ['attendance'], p_month_ends: [] })
      .then((r) => (r.error ? {} : r.data) as Figures),
    all<Person>((from, to) => supabase.from('employees').select('id, first_name, last_name, employee_code, job_title, status')
      .eq('organization_id', orgId).in('status', ['active', 'on_notice']).lte('date_of_joining', today).order('first_name').order('id').range(from, to)),
    all<Day>((from, to) => supabase.from('attendance_days').select('employee_id, status, first_in, last_out, worked_minutes, late_minutes, break_minutes')
      .eq('organization_id', orgId).eq('work_date', today).order('employee_id').range(from, to)),
    all<Leave>((from, to) => supabase.from('leave_requests').select('employee_id, status, start_date, end_date, half_day_start, half_day_end, leave_type_id')
      .eq('organization_id', orgId).in('status', ['approved', 'pending']).lte('start_date', today).gte('end_date', today).order('id').range(from, to)),
    all<Request>((from, to) => supabase.from('attendance_requests').select('employee_id, kind')
      .eq('organization_id', orgId).eq('status', 'approved').lte('start_date', today).gte('end_date', today).order('id').range(from, to)),
    supabase.from('leave_types').select('id, name').eq('organization_id', orgId).then((r) => must(r) ?? []),
  ]);

  const firstIns = days.map((d) => d.first_in).filter((t): t is string => !!t).sort();
  const punches = firstIns.length ? await all<Punch>((from, to) => supabase.from('attendance_punches').select('employee_id, punched_at, kind')
    .eq('organization_id', orgId).gte('punched_at', firstIns[0]!).order('punched_at').order('id').range(from, to)) : [];

  const members = orgMembers({ people, days, punches, leave, requests, types }, today, myEmployeeId);
  const p = figures.presence;
  return {
    headcount: figures.active_employees ?? null,
    exits: figures.exits_30d ?? null,
    presence: p && p.expected ? Math.round(((p.at_work + p.half_days * 0.5) / p.expected) * 100) : null,
    members,
  };
}

/** Everyone's day today from the rows read, worked out as on a manager's team (dashboard_desks); the caller is left out. */
export function orgMembers(
  { people, days, punches, leave, requests, types }: { people: Person[]; days: Day[]; punches: Punch[]; leave: Leave[]; requests: Request[]; types: Array<{ id: string; name: string }> },
  today: string, myEmployeeId: string | null,
): TeamMember[] {
  const dayOf = new Map(days.map((d) => [d.employee_id, d]));
  const punchesOf = new Map<string, TeamMember['punches']>();
  for (const p of punches) {
    const d = dayOf.get(p.employee_id);
    if (!d?.first_in || p.punched_at < d.first_in) continue;
    punchesOf.set(p.employee_id, [...(punchesOf.get(p.employee_id) ?? []), { punched_at: p.punched_at, kind: p.kind }]);
  }
  // An approved request wins over one waiting, as on the team desk.
  const leaveOf = new Map<string, Leave>();
  for (const l of leave) if (!leaveOf.has(l.employee_id) || l.status === 'approved') leaveOf.set(l.employee_id, l);
  const requestOf = new Map(requests.map((r) => [r.employee_id, r.kind]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  return people.filter((p) => p.id !== myEmployeeId).map((p): TeamMember => {
    const d = dayOf.get(p.id);
    const l = leaveOf.get(p.id);
    const request = requestOf.get(p.id);
    return {
      id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), code: p.employee_code, title: p.job_title?.trim() || null,
      // Not a reporting line, so no "Indirect report" on the row.
      direct: true, notice: p.status === 'on_notice',
      status: d?.status ?? null, first_in: d?.first_in ?? null, last_out: d?.last_out ?? null,
      worked: d?.worked_minutes ?? 0, late: d?.late_minutes ?? 0, breaks: d?.break_minutes ?? 0, punches: punchesOf.get(p.id) ?? [],
      leave: l ? { what: typeName.get(l.leave_type_id) ?? 'Leave', status: l.status as 'approved' | 'pending',
        half_day: (l.start_date === today && l.half_day_start) || (l.end_date === today && l.half_day_end) } : null,
      request: request === 'wfh' || request === 'on_duty' ? request : null,
      month: { present: 0, expected: 0, late: 0, leave: 0, absent: 0 },
    };
  });
}
