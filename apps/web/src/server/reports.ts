import 'server-only';
import { payrollJournal } from '@peoplecore/payroll';
import { EMPLOYMENT_TYPE_LABELS, legalName, todayIn } from '@peoplecore/shared';
import { formatDate, humanize } from '@/lib/format';
import { BUILDER_COLUMNS, BUILDER_GROUPS, REPORT_BY_KEY, type Access, type ParamKind, type ReportInfo } from '@/lib/report-catalog';
import type { Cell, Sheet } from '@/lib/xlsx';
import type { OrgContext } from './context';
import { getStructure } from './structure';
import { createClient } from './supabase';

/**
 * Report generators. Everything is read as the signed-in user, so RLS decides which rows appear (a manager's
 * attendance report covers their team; payroll figures need payroll access). Each returns sheets for the Excel
 * (or CSV) file, a link for the statutory files that keep their own format, or a message when there is nothing to
 * report yet.
 */

export interface Params {
  from: string; to: string; month: string; year: string; quarter: string; asof: string;
  department: string | null; location: string | null; template: string | null; columns: string[]; group: string | null;
}
export type Output = { kind: 'file'; sheets: Sheet[]; rows: number; name: string } | { kind: 'link'; url: string } | { kind: 'error'; message: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const monthLabel = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const fyStartYear = (iso: string) => (Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);
const fyLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
const fyMonths = (y: number) => Array.from({ length: 12 }, (_, i) => shiftMonth(`${y}-04`, i));
const money = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100) / 100;

/** Default parameters for a report (payroll looks at last month; everything else at this month). */
export function defaultParams(info: ReportInfo | undefined, today: string): Params {
  const month = info && (info.access === 'payroll' || info.access === 'statutory') ? shiftMonth(today.slice(0, 7), -1) : today.slice(0, 7);
  const fy = fyStartYear(today);
  const q = Math.floor(((Number(today.slice(5, 7)) + 8) % 12) / 3) + 1; // Apr–Jun = Q1
  return {
    from: `${today.slice(0, 7)}-01`, to: today, month, year: String(info?.key === 'leave_balance' ? today.slice(0, 4) : fy),
    quarter: String(q), asof: today, department: null, location: null, template: null, columns: [], group: null,
  };
}

/** Reads and checks parameters from a query string; anything malformed falls back to the default. */
export function readParams(info: ReportInfo, sp: URLSearchParams, today: string): Params {
  const d = defaultParams(info, today);
  const get = (k: string) => sp.get(k) ?? '';
  const iso = (k: string, f: string) => (ISO.test(get(k)) ? get(k) : f);
  return {
    from: iso('from', d.from), to: iso('to', d.to), asof: iso('asof', d.asof),
    month: /^\d{4}-\d{2}$/.test(get('month')) ? get('month') : d.month,
    year: /^\d{4}$/.test(get('year')) ? get('year') : d.year,
    quarter: /^[1-4]$/.test(get('quarter')) ? get('quarter') : d.quarter,
    department: UUID.test(get('department')) ? get('department') : null,
    location: UUID.test(get('location')) ? get('location') : null,
    template: UUID.test(get('template')) ? get('template') : null,
    columns: sp.getAll('columns').filter((c) => BUILDER_COLUMNS.some((b) => b.key === c)),
    group: BUILDER_GROUPS.some((g) => g.key === get('group')) ? get('group') : null,
  };
}

/** Resolves a schedule's relative period ("previous month") into concrete parameters for today. */
export function resolvePeriod(kind: ParamKind, period: string, today: string, info: ReportInfo): Partial<Params> {
  const thisMonth = today.slice(0, 7);
  if (kind === 'range') {
    if (period === 'last_7_days') return { from: addDays(today, -6), to: today };
    if (period === 'previous_month') { const m = shiftMonth(thisMonth, -1); return { from: `${m}-01`, to: monthEnd(m) }; }
    return { from: `${thisMonth}-01`, to: today };
  }
  if (kind === 'month') return { month: period === 'current_month' ? thisMonth : shiftMonth(thisMonth, -1) };
  if (kind === 'year') {
    const y = info.key === 'leave_balance' ? Number(today.slice(0, 4)) : fyStartYear(today);
    return { year: String(period === 'previous_year' ? y - 1 : y) };
  }
  if (kind === 'quarter') {
    const q = Math.floor(((Number(today.slice(5, 7)) + 8) % 12) / 3) + 1;
    return q === 1 ? { year: String(fyStartYear(today) - 1), quarter: '4' } : { year: String(fyStartYear(today)), quarter: String(q - 1) };
  }
  return { asof: today };
}

export function canRun(ctx: OrgContext, access: Access): boolean {
  const any = (k: Parameters<OrgContext['can']>[0]) => ctx.can(k, 'org') || ctx.can(k, 'team');
  const payroll = ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org');
  switch (access) {
    case 'attendance': return any('attendance.read');
    case 'directory': return any('employee.read');
    case 'leave': return any('leave.read');
    case 'payroll': return payroll;
    case 'statutory': return payroll && ctx.can('employee.identity.read', 'org');
    case 'expense': return ctx.can('expense.manage', 'org') || ctx.can('expense.approve', 'org') || ctx.can('expense.approve', 'team');
    case 'compensation': return ctx.can('compensation.read', 'org');
    case 'diversity': return ctx.can('employee.personal.read', 'org') || ctx.can('employee.personal.read', 'team');
  }
}

// ─── Shared loaders ─────────────────────────────────────────────────────────

async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>, max = 60000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < max; i += 1000) {
    const { data, error } = await fetchPage(i, i + 999);
    if (error) throw new Error(`Report query failed (${error.code ?? 'error'})`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const EMP_COLS = 'id, employee_code, first_name, middle_name, last_name, status, employment_type, date_of_joining, date_of_exit, probation_end_date, confirmed_on, department_id, designation_id, location_id, manager_employee_id, legal_entity_id, work_email, work_phone, job_title, billable';

async function staff(ctx: OrgContext, p: Pick<Params, 'department' | 'location'>) {
  const supabase = await createClient();
  const rows = await pages((from, to) => {
    let q = supabase.from('employees').select(EMP_COLS).eq('organization_id', ctx.org.id);
    if (p.department) q = q.eq('department_id', p.department);
    if (p.location) q = q.eq('location_id', p.location);
    return q.order('employee_code').range(from, to);
  });
  const structure = await getStructure(ctx.org.id);
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const entity = new Map(structure.legalEntities.map((l) => [l.id, l.name]));
  const byId = new Map(rows.map((e) => [e.id, e]));
  const people = rows.map((e) => ({
    ...e, name: legalName(e),
    department: e.department_id ? (dept.get(e.department_id) ?? '') : '',
    designation: e.designation_id ? (desig.get(e.designation_id) ?? '') : '',
    location: e.location_id ? (loc.get(e.location_id) ?? '') : '',
    legal_entity: e.legal_entity_id ? (entity.get(e.legal_entity_id) ?? '') : '',
    manager: e.manager_employee_id && byId.get(e.manager_employee_id) ? legalName(byId.get(e.manager_employee_id)!) : '',
  }));
  return { people, byId: new Map(people.map((x) => [x.id, x])), structure };
}
type Person = Awaited<ReturnType<typeof staff>>['people'][number];

/** The processed (locked, else approved) payroll run for a month. */
async function runFor(ctx: OrgContext, month: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('payroll_runs').select('id, period_month, status').eq('organization_id', ctx.org.id)
    .eq('period_month', `${month}-01`).in('status', ['approved', 'locked']);
  return (data ?? []).sort((a, b) => (a.status === 'locked' ? -1 : 1) - (b.status === 'locked' ? -1 : 1))[0] ?? null;
}

async function runEmployees(runId: string) {
  const supabase = await createClient();
  return pages((from, to) => supabase.from('payroll_run_employees')
    .select('employee_id, payable_days, lop_days, gross, deductions, net, employer_cost, taxable').eq('run_id', runId).order('employee_id').range(from, to));
}

async function lockedRunsIn(ctx: OrgContext, months: string[]) {
  const supabase = await createClient();
  const { data } = await supabase.from('payroll_runs').select('id, period_month, status').eq('organization_id', ctx.org.id)
    .in('period_month', months.map((m) => `${m}-01`)).eq('status', 'locked').order('period_month');
  return data ?? [];
}

const noRun = (month: string): Output => ({ kind: 'error', message: `No processed payroll for ${monthLabel(month)} yet. Approve or lock that month’s run first.` });
const sheet = (name: string, columns: string[], rows: Cell[][]): Sheet => ({ name, columns, rows });
const file = (name: string, ...sheets: Sheet[]): Output => ({ kind: 'file', name, sheets, rows: sheets[0]?.rows.length ?? 0 });
const tooLong = (p: Params, max: number): Output | null =>
  p.to < p.from ? { kind: 'error', message: 'The end date is before the start date.' }
    : daysBetween(p.from, p.to) >= max ? { kind: 'error', message: `Choose a period of at most ${max} days.` } : null;
const dateList = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// ─── Attendance ─────────────────────────────────────────────────────────────

const CODE: Record<string, string> = { present: 'P', half_day: 'HD', absent: 'A', on_leave: 'L', weekly_off: 'WO', holiday: 'H', not_marked: '-', wfh: 'WFH', on_duty: 'OD' };

async function attendanceDays(ctx: OrgContext, from: string, to: string, ids: Set<string>) {
  const supabase = await createClient();
  const rows = await pages((a, b) => supabase.from('attendance_days')
    .select('employee_id, work_date, status, first_in, last_out, worked_minutes, late_minutes, leave_days, is_regularized, shift_id')
    .eq('organization_id', ctx.org.id).gte('work_date', from).lte('work_date', to).order('employee_id').order('work_date').range(a, b), 200000);
  return rows.filter((r) => ids.has(r.employee_id));
}

async function musterSheets(ctx: OrgContext, p: Params, from: string, to: string, title: string, wages?: Map<string, { payable: number; gross: number; deductions: number; net: number }>) {
  const { people } = await staff(ctx, p);
  const days = dateList(from, to);
  const inPeriod = people.filter((e) => e.date_of_joining <= to && (!e.date_of_exit || e.date_of_exit >= from));
  const rows = await attendanceDays(ctx, from, to, new Set(inPeriod.map((e) => e.id)));
  const at = new Map(rows.map((r) => [`${r.employee_id}:${r.work_date}`, r]));
  const out = inPeriod.map((e, i) => {
    const codes = days.map((d) => (d < e.date_of_joining || (e.date_of_exit && d > e.date_of_exit) ? '' : CODE[at.get(`${e.id}:${d}`)?.status ?? ''] ?? ''));
    const count = (c: string) => codes.filter((x) => x === c).length;
    const base: Cell[] = [i + 1, e.employee_code, e.name, e.designation, ...codes, count('P') + count('WFH') + count('OD') + count('HD') / 2, count('L'), count('A'), count('WO') + count('H')];
    const w = wages?.get(e.id);
    return wages ? [...base, w?.payable ?? null, w?.gross ?? null, w?.deductions ?? null, w?.net ?? null] : base;
  });
  const cols = ['Sl. No.', 'Employee code', 'Name', 'Designation', ...days.map((d) => d.slice(8)), 'Days worked', 'Leave', 'Absent', 'Weekly off / holidays',
    ...(wages ? ['Payable days', 'Gross wages', 'Deductions', 'Net wages paid'] : [])];
  return sheet(title, cols, out);
}

async function consolidatedAttendance(ctx: OrgContext, p: Params): Promise<Output> {
  const bad = tooLong(p, 366); if (bad) return bad;
  const { people } = await staff(ctx, p);
  const rows = await attendanceDays(ctx, p.from, p.to, new Set(people.map((e) => e.id)));
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.employee_id, [...(by.get(r.employee_id) ?? []), r]);
  const out = people.filter((e) => by.has(e.id)).map((e) => {
    const ds = by.get(e.id)!;
    const n = (s: string) => ds.filter((d) => d.status === s).length;
    const late = ds.filter((d) => d.late_minutes > 0);
    return [e.employee_code, e.name, e.department, e.location, n('present') + n('wfh') + n('on_duty'), n('half_day'), n('absent'),
      ds.reduce((a, d) => a + Number(d.leave_days), 0), n('weekly_off'), n('holiday'), n('not_marked'), late.length,
      late.reduce((a, d) => a + d.late_minutes, 0), money(ds.reduce((a, d) => a + d.worked_minutes, 0) / 60), ds.filter((d) => d.is_regularized).length] as Cell[];
  });
  return file(`consolidated-attendance-${p.from}-to-${p.to}`, sheet('Consolidated attendance', ['Employee code', 'Name', 'Department', 'Location', 'Present', 'Half days', 'Absent',
    'Leave days', 'Weekly offs', 'Holidays', 'Not marked', 'Late days', 'Late minutes', 'Hours worked', 'Regularized days'], out));
}

async function lateEarly(ctx: OrgContext, p: Params): Promise<Output> {
  const bad = tooLong(p, 93); if (bad) return bad;
  const supabase = await createClient();
  const { people, byId } = await staff(ctx, p);
  const [rows, shifts] = await Promise.all([
    attendanceDays(ctx, p.from, p.to, new Set(people.map((e) => e.id))),
    supabase.from('shifts').select('id, name, end_time, grace_minutes, is_default').eq('organization_id', ctx.org.id),
  ]);
  const shiftById = new Map((shifts.data ?? []).map((s) => [s.id, s]));
  const fallback = (shifts.data ?? []).find((s) => s.is_default);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: ctx.org.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: Cell[][] = [];
  for (const r of rows) {
    const s = (r.shift_id && shiftById.get(r.shift_id)) || fallback;
    const outAt = r.last_out ? hhmm.format(new Date(r.last_out)) : null;
    const early = s && outAt ? Math.max(0, mins(s.end_time) - mins(outAt) - s.grace_minutes) : 0;
    if (r.late_minutes <= 0 && early <= 0) continue;
    const e = byId.get(r.employee_id)!;
    out.push([formatDate(r.work_date), e.employee_code, e.name, e.department, s?.name ?? '', r.first_in ? hhmm.format(new Date(r.first_in)) : '', outAt ?? '',
      r.late_minutes || null, early || null, r.is_regularized ? 'Yes' : 'No']);
  }
  return file(`late-early-${p.from}-to-${p.to}`, sheet('Late and early', ['Date', 'Employee code', 'Name', 'Department', 'Shift', 'In', 'Out', 'Late by (min)', 'Left early by (min)', 'Regularized'], out));
}

async function compOff(ctx: OrgContext, p: Params): Promise<Output> {
  const bad = tooLong(p, 366); if (bad) return bad;
  const supabase = await createClient();
  const { byId } = await staff(ctx, p);
  const rows = await pages((a, b) => supabase.from('comp_off_credits').select('employee_id, work_date, days, status, credited_at, reverted_at')
    .eq('organization_id', ctx.org.id).gte('work_date', p.from).lte('work_date', p.to).order('work_date').range(a, b));
  const out = rows.filter((r) => byId.has(r.employee_id)).map((r) => {
    const e = byId.get(r.employee_id)!;
    return [formatDate(r.work_date), e.employee_code, e.name, e.department, Number(r.days), humanize(r.status),
      r.credited_at ? formatDate(r.credited_at.slice(0, 10)) : '', r.reverted_at ? formatDate(r.reverted_at.slice(0, 10)) : ''] as Cell[];
  });
  return file(`comp-off-${p.from}-to-${p.to}`, sheet('Comp-off log', ['Worked on', 'Employee code', 'Name', 'Department', 'Days', 'Status', 'Credited on', 'Reverted on'], out));
}

// ─── Directory ──────────────────────────────────────────────────────────────

async function personalFor(ids: string[]) {
  const supabase = await createClient();
  const out = new Map<string, { date_of_birth: string | null; gender: string | null; blood_group: string | null; marital_status: string | null; personal_email: string | null; personal_phone: string | null; city: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('employee_personal').select('employee_id, date_of_birth, gender, blood_group, marital_status, personal_email, personal_phone, city').in('employee_id', ids.slice(i, i + 200));
    for (const r of data ?? []) out.set(r.employee_id, r);
  }
  return out;
}

const tenureYears = (e: Person, at: string) => Math.round((daysBetween(e.date_of_joining, e.date_of_exit && e.date_of_exit < at ? e.date_of_exit : at) / 365.25) * 10) / 10;

function columnValue(key: string, e: Person, pers: Map<string, Awaited<ReturnType<typeof personalFor>> extends Map<string, infer V> ? V : never>, today: string): Cell {
  const v = pers.get(e.id);
  switch (key) {
    case 'code': return e.employee_code;
    case 'name': return e.name;
    case 'status': return humanize(e.status);
    case 'employment_type': return EMPLOYMENT_TYPE_LABELS[e.employment_type];
    case 'doj': return formatDate(e.date_of_joining);
    case 'tenure': return tenureYears(e, today);
    case 'probation_end': return e.probation_end_date ? formatDate(e.probation_end_date) : '';
    case 'confirmed_on': return e.confirmed_on ? formatDate(e.confirmed_on) : '';
    case 'exit_date': return e.date_of_exit ? formatDate(e.date_of_exit) : '';
    case 'department': return e.department;
    case 'designation': return e.designation;
    case 'job_title': return e.job_title ?? '';
    case 'location': return e.location;
    case 'manager': return e.manager;
    case 'legal_entity': return e.legal_entity;
    case 'work_email': return e.work_email ?? '';
    case 'work_phone': return e.work_phone ?? '';
    case 'billable': return e.billable ? 'Billable' : 'Non-Billable';
    case 'dob': return v?.date_of_birth ? formatDate(v.date_of_birth) : '';
    case 'gender': return v?.gender ? humanize(v.gender) : '';
    case 'blood_group': return v?.blood_group ?? '';
    case 'marital_status': return v?.marital_status ? humanize(v.marital_status) : '';
    case 'personal_email': return v?.personal_email ?? '';
    case 'personal_phone': return v?.personal_phone ?? '';
    case 'city': return v?.city ?? '';
    default: return '';
  }
}

async function employeeMaster(ctx: OrgContext, p: Params): Promise<Output> {
  const { people } = await staff(ctx, p);
  const at = p.asof;
  const list = people.filter((e) => e.date_of_joining <= at && (!e.date_of_exit || e.date_of_exit >= at));
  const personal = ctx.can('employee.personal.read', 'org') || ctx.can('employee.personal.read', 'team');
  const cols = BUILDER_COLUMNS.filter((c) => personal || !c.personal);
  const pers = personal ? await personalFor(list.map((e) => e.id)) : new Map();
  return file(`employee-master-${at}`, sheet(`Employee master ${at}`, cols.map((c) => c.label), list.map((e) => cols.map((c) => columnValue(c.key, e, pers, at)))));
}

async function joinExit(ctx: OrgContext, p: Params): Promise<Output> {
  const bad = tooLong(p, 732); if (bad) return bad;
  const { people } = await staff(ctx, p);
  const row = (e: Person, d: string) => [formatDate(d), e.employee_code, e.name, e.department, e.designation, e.location, EMPLOYMENT_TYPE_LABELS[e.employment_type], e.manager] as Cell[];
  const joined = people.filter((e) => e.date_of_joining >= p.from && e.date_of_joining <= p.to).sort((a, b) => a.date_of_joining.localeCompare(b.date_of_joining));
  const left = people.filter((e) => e.date_of_exit && e.date_of_exit >= p.from && e.date_of_exit <= p.to).sort((a, b) => a.date_of_exit!.localeCompare(b.date_of_exit!));
  const cols = ['Date', 'Employee code', 'Name', 'Department', 'Designation', 'Location', 'Employee type', 'Reporting manager'];
  const out = file(`join-exit-${p.from}-to-${p.to}`,
    sheet('Joiners', cols, joined.map((e) => row(e, e.date_of_joining))),
    sheet('Exits', cols, left.map((e) => [...row(e, e.date_of_exit!), tenureYears(e, e.date_of_exit!)])),
  );
  if (out.kind === 'file') { out.sheets[1]!.columns = [...cols, 'Tenure (years)']; out.rows = joined.length + left.length; }
  return out;
}

async function probation(ctx: OrgContext, p: Params): Promise<Output> {
  const { people } = await staff(ctx, p);
  const at = p.asof;
  const list = people.filter((e) => ['active', 'on_notice'].includes(e.status) && e.probation_end_date && e.date_of_joining <= at);
  const out = list.map((e) => {
    const left = daysBetween(at, e.probation_end_date!);
    const state = e.confirmed_on ? 'Confirmed' : left < 0 ? 'Overdue' : left <= 15 ? 'Due in 15 days' : 'On probation';
    return [e.employee_code, e.name, e.department, e.designation, e.manager, formatDate(e.date_of_joining), formatDate(e.probation_end_date!),
      e.confirmed_on ? null : left, e.confirmed_on ? formatDate(e.confirmed_on) : '', state] as Cell[];
  }).sort((a, b) => Number(a[7] ?? 9999) - Number(b[7] ?? 9999));
  return file(`probation-${at}`, sheet('Probation and confirmation', ['Employee code', 'Name', 'Department', 'Designation', 'Reporting manager', 'Date of joining',
    'Probation ends', 'Days left (negative = overdue)', 'Confirmed on', 'Status'], out));
}

// ─── Leave ──────────────────────────────────────────────────────────────────

async function leaveTypes(ctx: OrgContext) {
  const supabase = await createClient();
  const { data } = await supabase.from('leave_types').select('id, name').eq('organization_id', ctx.org.id);
  return new Map((data ?? []).map((t) => [t.id, t.name]));
}

async function leaveRegister(ctx: OrgContext, p: Params): Promise<Output> {
  const supabase = await createClient();
  const { byId } = await staff(ctx, p);
  const [types, rows] = await Promise.all([
    leaveTypes(ctx),
    pages((a, b) => supabase.from('leave_requests').select('employee_id, leave_type_id, start_date, end_date, days, status, reason, created_at')
      .eq('organization_id', ctx.org.id).lte('start_date', monthEnd(p.month)).gte('end_date', `${p.month}-01`).order('start_date').range(a, b)),
  ]);
  const out = rows.filter((r) => byId.has(r.employee_id)).map((r) => {
    const e = byId.get(r.employee_id)!;
    return [e.employee_code, e.name, e.department, types.get(r.leave_type_id) ?? '', formatDate(r.start_date), formatDate(r.end_date), Number(r.days),
      humanize(r.status), r.reason ?? '', formatDate(r.created_at.slice(0, 10))] as Cell[];
  });
  return file(`leave-register-${p.month}`, sheet(`Leave register ${p.month}`, ['Employee code', 'Name', 'Department', 'Leave type', 'From', 'To', 'Days', 'Status', 'Reason', 'Applied on'], out));
}

async function leaveBalance(ctx: OrgContext, p: Params): Promise<Output> {
  const supabase = await createClient();
  const { data: settings } = await supabase.from('leave_settings').select('year_start_month').eq('organization_id', ctx.org.id).maybeSingle();
  const sm = settings?.year_start_month ?? 1;
  const start = `${p.year}-${String(sm).padStart(2, '0')}-01`;
  const end = sm === 1 ? `${p.year}-12-31` : new Date(Date.UTC(Number(p.year) + 1, sm - 1, 0)).toISOString().slice(0, 10);
  const { people, byId } = await staff(ctx, p);
  const ids = new Set(people.map((e) => e.id));
  const [types, ledger] = await Promise.all([
    leaveTypes(ctx),
    pages((a, b) => supabase.from('leave_ledger').select('id, employee_id, leave_type_id, entry_date, kind, days')
      .eq('organization_id', ctx.org.id).lte('entry_date', end).order('id').range(a, b), 500000),
  ]);
  const acc = new Map<string, { opening: number; credited: number; availed: number; lapsed: number; adjusted: number }>();
  for (const l of ledger) {
    if (!ids.has(l.employee_id)) continue;
    const k = `${l.employee_id}|${l.leave_type_id}`;
    const a = acc.get(k) ?? { opening: 0, credited: 0, availed: 0, lapsed: 0, adjusted: 0 };
    const d = Number(l.days);
    if (l.entry_date < start) a.opening += d;
    else if (l.kind === 'accrual' || l.kind === 'opening') a.credited += d;
    else if (l.kind === 'debit' || l.kind === 'reversal') a.availed -= d;
    else if (l.kind === 'lapse') a.lapsed -= d;
    else a.adjusted += d;
    acc.set(k, a);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const out = [...acc].map(([k, a]) => {
    const [emp, type] = k.split('|') as [string, string];
    const e = byId.get(emp)!;
    return [e.employee_code, e.name, e.department, types.get(type) ?? '', round(a.opening), round(a.credited), round(a.availed), round(a.lapsed), round(a.adjusted),
      round(a.opening + a.credited - a.availed - a.lapsed + a.adjusted)] as Cell[];
  }).sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[3]).localeCompare(String(y[3])));
  const label = sm === 1 ? p.year : `${p.year}-${String((Number(p.year) + 1) % 100).padStart(2, '0')}`;
  return file(`leave-balance-${label}`, sheet(`Leave balance ${label}`, ['Employee code', 'Name', 'Department', 'Leave type', 'Opening', 'Credited', 'Availed', 'Lapsed', 'Adjusted', 'Closing'], out));
}

// ─── Payroll ────────────────────────────────────────────────────────────────

async function netPay(ctx: OrgContext, p: Params): Promise<Output> {
  const run = await runFor(ctx, p.month); if (!run) return noRun(p.month);
  const { byId } = await staff(ctx, p);
  const rows = (await runEmployees(run.id)).filter((r) => byId.has(r.employee_id));
  const out = rows.map((r) => { const e = byId.get(r.employee_id)!; return [e.employee_code, e.name, e.department, e.location, Number(r.payable_days), Number(r.lop_days), money(r.net)] as Cell[]; })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  out.push(['Total', '', '', '', null, null, money(rows.reduce((a, r) => a + Number(r.net), 0))]);
  return file(`net-pay-${p.month}`, sheet(`Net pay ${p.month}`, ['Employee code', 'Name', 'Department', 'Location', 'Payable days', 'LOP days', 'Net pay'], out));
}

async function grossVsNet(ctx: OrgContext, p: Params): Promise<Output> {
  const run = await runFor(ctx, p.month); if (!run) return noRun(p.month);
  const supabase = await createClient();
  const { byId } = await staff(ctx, p);
  const [rows, lines] = await Promise.all([
    runEmployees(run.id),
    pages((a, b) => supabase.from('payroll_line_items').select('id, employee_id, code, name, kind, amount').eq('run_id', run.id).order('id').range(a, b)),
  ]);
  const comps = [...new Map(lines.map((l) => [`${l.kind}:${l.code}`, { key: `${l.kind}:${l.code}`, name: l.name, kind: l.kind }])).values()]
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : ['earning', 'deduction', 'employer'].indexOf(a.kind) - ['earning', 'deduction', 'employer'].indexOf(b.kind)));
  const amount = new Map<string, number>();
  for (const l of lines) amount.set(`${l.employee_id}|${l.kind}:${l.code}`, (amount.get(`${l.employee_id}|${l.kind}:${l.code}`) ?? 0) + Number(l.amount));
  const out = rows.filter((r) => byId.has(r.employee_id)).map((r) => {
    const e = byId.get(r.employee_id)!;
    return [e.employee_code, e.name, e.department, Number(r.payable_days), ...comps.filter((c) => c.kind === 'earning').map((c) => money(amount.get(`${r.employee_id}|${c.key}`))),
      money(r.gross), ...comps.filter((c) => c.kind === 'deduction').map((c) => money(amount.get(`${r.employee_id}|${c.key}`))), money(r.deductions), money(r.net),
      ...comps.filter((c) => c.kind === 'employer').map((c) => money(amount.get(`${r.employee_id}|${c.key}`))), money(r.employer_cost)] as Cell[];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const cols = ['Employee code', 'Name', 'Department', 'Payable days', ...comps.filter((c) => c.kind === 'earning').map((c) => c.name), 'Gross',
    ...comps.filter((c) => c.kind === 'deduction').map((c) => c.name), 'Total deductions', 'Net pay', ...comps.filter((c) => c.kind === 'employer').map((c) => `${c.name} (employer)`), 'Cost to company'];
  return file(`gross-vs-net-${p.month}`, sheet(`Gross vs net ${p.month}`, cols, out));
}

async function monthPair(ctx: OrgContext, p: Params) {
  const [cur, prev] = await Promise.all([runFor(ctx, p.month), runFor(ctx, shiftMonth(p.month, -1))]);
  if (!cur) return null;
  const [a, b] = await Promise.all([runEmployees(cur.id), prev ? runEmployees(prev.id) : Promise.resolve([])]);
  return { cur: new Map(a.map((r) => [r.employee_id, r])), prev: new Map(b.map((r) => [r.employee_id, r])), hasPrev: !!prev };
}

async function reconciliation(ctx: OrgContext, p: Params): Promise<Output> {
  const pair = await monthPair(ctx, p); if (!pair) return noRun(p.month);
  const { byId } = await staff(ctx, p);
  const ids = [...new Set([...pair.cur.keys(), ...pair.prev.keys()])].filter((id) => byId.has(id));
  const rows = ids.map((id) => {
    const e = byId.get(id)!; const c = pair.cur.get(id); const v = pair.prev.get(id);
    const why = !v ? 'Joined / first paid' : !c ? 'Left / not paid' : Number(c.lop_days) !== Number(v.lop_days) ? 'LOP changed' : Number(c.gross) !== Number(v.gross) ? 'Pay changed' : '';
    return [e.employee_code, e.name, e.department, money(v?.gross), money(c?.gross), money(Number(c?.gross ?? 0) - Number(v?.gross ?? 0)),
      money(v?.net), money(c?.net), money(Number(c?.net ?? 0) - Number(v?.net ?? 0)), why] as Cell[];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const total = (m: Map<string, { gross: number; deductions: number; net: number; employer_cost: number }>, k: 'gross' | 'deductions' | 'net' | 'employer_cost') =>
    money([...m].filter(([id]) => byId.has(id)).reduce((a, [, r]) => a + Number(r[k]), 0));
  const summary: Cell[][] = (['gross', 'deductions', 'net', 'employer_cost'] as const).map((k) => [humanize(k), total(pair.prev, k), total(pair.cur, k), money(total(pair.cur, k) - total(pair.prev, k))]);
  summary.unshift(['Headcount paid', [...pair.prev.keys()].filter((id) => byId.has(id)).length, [...pair.cur.keys()].filter((id) => byId.has(id)).length,
    [...pair.cur.keys()].filter((id) => byId.has(id)).length - [...pair.prev.keys()].filter((id) => byId.has(id)).length]);
  const prevLabel = monthLabel(shiftMonth(p.month, -1)); const curLabel = monthLabel(p.month);
  return file(`reconciliation-${p.month}`,
    sheet('Summary', ['Measure', prevLabel, curLabel, 'Change'], summary),
    sheet('By employee', ['Employee code', 'Name', 'Department', `Gross ${prevLabel}`, `Gross ${curLabel}`, 'Gross change', `Net ${prevLabel}`, `Net ${curLabel}`, 'Net change', 'Reason'], rows));
}

async function jv(ctx: OrgContext, p: Params): Promise<Output> {
  const run = await runFor(ctx, p.month);
  if (!run || run.status !== 'locked') return { kind: 'error', message: `The journal needs a locked payroll for ${monthLabel(p.month)}.` };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('payroll_journal_items', { p_run: run.id });
  if (error) return { kind: 'error', message: 'The journal could not be built for this month.' };
  const j = payrollJournal(data.map((i) => ({ code: i.code, name: i.name, kind: i.kind, amount: Number(i.amount) })));
  const out: Cell[][] = j.lines.map((l) => [l.account, l.code ?? '', l.description, l.debit ? money(l.debit) : null, l.credit ? money(l.credit) : null]);
  out.push(['Total', '', '', money(j.totals.debit), money(j.totals.credit)]);
  return file(`jv-${p.month}`, sheet(`Journal ${p.month}`, ['Account', 'Component code', 'Description', 'Debit', 'Credit'], out));
}

async function variance(ctx: OrgContext, p: Params): Promise<Output> {
  const pair = await monthPair(ctx, p); if (!pair) return noRun(p.month);
  if (!pair.hasPrev) return { kind: 'error', message: `There is no processed payroll for ${monthLabel(shiftMonth(p.month, -1))} to compare with.` };
  const { byId } = await staff(ctx, p);
  const rows = [...pair.cur].filter(([id]) => byId.has(id) && pair.prev.has(id)).map(([id, c]) => {
    const e = byId.get(id)!; const v = pair.prev.get(id)!;
    const diff = Number(c.gross) - Number(v.gross);
    const pct = Number(v.gross) ? Math.round((diff / Number(v.gross)) * 1000) / 10 : null;
    return [e.employee_code, e.name, e.department, money(v.gross), money(c.gross), money(diff), pct, pct !== null && Math.abs(pct) >= 10 ? 'Review' : ''] as Cell[];
  }).sort((a, b) => Math.abs(Number(b[6] ?? 0)) - Math.abs(Number(a[6] ?? 0)));
  return file(`salary-variance-${p.month}`, sheet(`Variance ${p.month}`, ['Employee code', 'Name', 'Department', `Gross ${monthLabel(shiftMonth(p.month, -1))}`, `Gross ${monthLabel(p.month)}`, 'Change', 'Change %', 'Flag (≥ 10%)'], rows));
}

async function revisions(ctx: OrgContext, p: Params): Promise<Output> {
  const y = Number(p.year);
  const supabase = await createClient();
  const { byId } = await staff(ctx, p);
  const rows = await pages((a, b) => supabase.from('salary_revisions').select('employee_id, effective_from, previous_annual_ctc, annual_ctc, reason, status, decided_at, arrears')
    .eq('organization_id', ctx.org.id).gte('effective_from', `${y}-04-01`).lte('effective_from', `${y + 1}-03-31`).order('effective_from').range(a, b));
  const out = rows.filter((r) => byId.has(r.employee_id)).map((r) => {
    const e = byId.get(r.employee_id)!;
    const prev = r.previous_annual_ctc === null ? null : Number(r.previous_annual_ctc);
    return [e.employee_code, e.name, e.department, formatDate(r.effective_from), prev === null ? null : money(prev), money(r.annual_ctc),
      prev ? Math.round(((Number(r.annual_ctc) - prev) / prev) * 1000) / 10 : null, r.reason, humanize(r.status), r.decided_at ? formatDate(r.decided_at.slice(0, 10)) : '', money(r.arrears)] as Cell[];
  });
  return file(`salary-revisions-${fyLabel(y)}`, sheet(`Revisions FY ${fyLabel(y)}`, ['Employee code', 'Name', 'Department', 'Effective from', 'Previous CTC', 'New CTC', 'Change %', 'Reason', 'Status', 'Decided on', 'Arrears'], out));
}

async function statutoryYear(ctx: OrgContext, y: number) {
  const supabase = await createClient();
  const runs = await lockedRunsIn(ctx, fyMonths(y));
  const acc = new Map<string, { code: string; name: string; pan: string; months: number; gross: number; taxable: number; tds: number }>();
  for (const r of runs) {
    const { data } = await supabase.rpc('payroll_statutory_rows', { p_run: r.id, p_report: 'tds' });
    for (const x of data ?? []) {
      const a = acc.get(x.employee_id) ?? { code: x.employee_code, name: x.employee_name, pan: x.pan, months: 0, gross: 0, taxable: 0, tds: 0 };
      a.months += 1; a.gross += Number(x.gross); a.taxable += Number(x.taxable); a.tds += Number(x.tds); a.pan = x.pan ?? a.pan;
      acc.set(x.employee_id, a);
    }
  }
  return { runs, acc };
}

async function taxComputation(ctx: OrgContext, p: Params): Promise<Output> {
  const y = Number(p.year);
  const { byId } = await staff(ctx, p);
  const { runs, acc } = await statutoryYear(ctx, y);
  if (runs.length === 0) return { kind: 'error', message: `No locked payroll in FY ${fyLabel(y)} yet.` };
  const supabase = await createClient();
  const { data: decl } = await supabase.from('tax_declarations').select('employee_id, regime, status').eq('organization_id', ctx.org.id).eq('fy', fyLabel(y));
  const regime = new Map((decl ?? []).map((d) => [d.employee_id, `${humanize(d.regime)} (${humanize(d.status)})`]));
  const out = [...acc].filter(([id]) => byId.has(id)).map(([id, a]) => [a.code, a.name, byId.get(id)!.department, a.pan || 'PANNOTAVBL', regime.get(id) ?? 'New (default)',
    a.months, money(a.gross), money(a.taxable), money(a.tds)] as Cell[]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return file(`tax-computation-${fyLabel(y)}`, sheet(`Tax FY ${fyLabel(y)}`, ['Employee code', 'Name', 'Department', 'PAN', 'Regime', 'Months paid', 'Gross (YTD)', 'Taxable (YTD)', 'TDS deducted (YTD)'], out));
}

async function departmentWise(ctx: OrgContext, p: Params): Promise<Output> {
  const run = await runFor(ctx, p.month); if (!run) return noRun(p.month);
  const { byId } = await staff(ctx, p);
  const by = new Map<string, { n: number; gross: number; ded: number; net: number; cost: number }>();
  for (const r of await runEmployees(run.id)) {
    const e = byId.get(r.employee_id); if (!e) continue;
    const k = e.department || 'No department';
    const a = by.get(k) ?? { n: 0, gross: 0, ded: 0, net: 0, cost: 0 };
    a.n += 1; a.gross += Number(r.gross); a.ded += Number(r.deductions); a.net += Number(r.net); a.cost += Number(r.employer_cost);
    by.set(k, a);
  }
  const out = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([k, a]) => [k, a.n, money(a.gross), money(a.ded), money(a.net), money(a.cost), money(a.gross / a.n)] as Cell[]);
  return file(`department-wise-${p.month}`, sheet(`Departments ${p.month}`, ['Department', 'Employees paid', 'Gross', 'Deductions', 'Net pay', 'Cost to company', 'Average gross'], out));
}

async function yearlyPay(ctx: OrgContext, p: Params): Promise<Output> {
  const y = Number(p.year);
  const runs = await lockedRunsIn(ctx, fyMonths(y));
  if (runs.length === 0) return { kind: 'error', message: `No locked payroll in FY ${fyLabel(y)} yet.` };
  const { byId } = await staff(ctx, p);
  const months = fyMonths(y);
  const net = new Map<string, Map<string, number>>(); const gross = new Map<string, Map<string, number>>();
  for (const r of runs) {
    for (const x of await runEmployees(r.id)) {
      if (!byId.has(x.employee_id)) continue;
      const m = r.period_month.slice(0, 7);
      (net.get(x.employee_id) ?? net.set(x.employee_id, new Map()).get(x.employee_id)!).set(m, Number(x.net));
      (gross.get(x.employee_id) ?? gross.set(x.employee_id, new Map()).get(x.employee_id)!).set(m, Number(x.gross));
    }
  }
  const build = (src: Map<string, Map<string, number>>) => [...src].map(([id, m]) => {
    const e = byId.get(id)!;
    return [e.employee_code, e.name, e.department, ...months.map((k) => (m.has(k) ? money(m.get(k)) : null)), money([...m.values()].reduce((a, b) => a + b, 0))] as Cell[];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const cols = ['Employee code', 'Name', 'Department', ...months.map((m) => monthLabel(m).replace(/ (\d{4})$/, ' $1')), 'Total'];
  return file(`yearly-pay-${fyLabel(y)}`, sheet('Net pay', cols, build(net)), sheet('Gross pay', cols, build(gross)));
}

// ─── Expense ────────────────────────────────────────────────────────────────

async function expenses(ctx: OrgContext, p: Params, mode: 'pending' | 'approved' | 'payout'): Promise<Output> {
  if (mode !== 'pending') { const bad = tooLong(p, 732); if (bad) return bad; }
  const supabase = await createClient();
  const { byId } = await staff(ctx, p);
  const rows = await pages((a, b) => {
    let q = supabase.from('expense_claims').select('id, employee_id, title, status, total, submitted_at, decided_at, paid_run_id').eq('organization_id', ctx.org.id);
    q = mode === 'pending' ? q.eq('status', 'pending') : mode === 'approved' ? q.in('status', ['approved', 'paid']) : q.eq('status', 'paid');
    return q.order('submitted_at').range(a, b);
  });
  const today = todayIn(ctx.org.timezone);
  if (mode === 'pending') {
    const out = rows.filter((r) => byId.has(r.employee_id)).map((r) => { const e = byId.get(r.employee_id)!; return [e.employee_code, e.name, e.department, r.title, money(r.total),
      r.submitted_at ? formatDate(r.submitted_at.slice(0, 10)) : '', r.submitted_at ? daysBetween(r.submitted_at.slice(0, 10), today) : null] as Cell[]; });
    return file(`pending-expenses-${today}`, sheet('Pending expenses', ['Employee code', 'Name', 'Department', 'Claim', 'Amount', 'Submitted on', 'Waiting (days)'], out));
  }
  if (mode === 'approved') {
    const out = rows.filter((r) => byId.has(r.employee_id) && r.decided_at && r.decided_at.slice(0, 10) >= p.from && r.decided_at.slice(0, 10) <= p.to).map((r) => {
      const e = byId.get(r.employee_id)!;
      return [e.employee_code, e.name, e.department, r.title, money(r.total), r.submitted_at ? formatDate(r.submitted_at.slice(0, 10)) : '', formatDate(r.decided_at!.slice(0, 10)), humanize(r.status)] as Cell[];
    });
    return file(`approved-expenses-${p.from}-to-${p.to}`, sheet('Approved expenses', ['Employee code', 'Name', 'Department', 'Claim', 'Amount', 'Submitted on', 'Approved on', 'Status'], out));
  }
  const runIds = [...new Set(rows.map((r) => r.paid_run_id).filter((x): x is string => !!x))];
  const { data: runs } = runIds.length ? await supabase.from('payroll_runs').select('id, period_month').in('id', runIds) : { data: [] as Array<{ id: string; period_month: string }> };
  const runMonth = new Map((runs ?? []).map((r) => [r.id, r.period_month]));
  const out = rows.filter((r) => {
    const m = r.paid_run_id ? runMonth.get(r.paid_run_id) : null;
    return byId.has(r.employee_id) && m && m >= `${p.from.slice(0, 7)}-01` && m <= p.to;
  }).map((r) => { const e = byId.get(r.employee_id)!; return [e.employee_code, e.name, e.department, r.title, money(r.total), monthLabel(runMonth.get(r.paid_run_id!)!.slice(0, 7))] as Cell[]; });
  return file(`expense-payout-${p.from}-to-${p.to}`, sheet('Expense payout', ['Employee code', 'Name', 'Department', 'Claim', 'Amount', 'Paid with payroll of'], out));
}

// ─── Compliance ─────────────────────────────────────────────────────────────

async function statutory(ctx: OrgContext, p: Params, report: 'pf' | 'esi' | 'pt' | 'tds'): Promise<Output> {
  const run = await runFor(ctx, p.month);
  if (!run || run.status !== 'locked') return { kind: 'error', message: `Statutory reports need a locked payroll for ${monthLabel(p.month)}.` };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('payroll_statutory_rows', { p_run: run.id, p_report: report === 'pf' ? 'pf_ecr' : report });
  if (error) return { kind: 'error', message: error.code === '22023' ? error.message : 'The report could not be built.' };
  const { byId } = await staff(ctx, p);
  const rows = data.filter((x) => byId.has(x.employee_id));
  if (report === 'pf') {
    return file(`pf-register-${p.month}`, sheet(`PF register ${p.month}`, ['Employee code', 'Name', 'UAN', 'Gross wages', 'EPF wages', 'EPS wages', 'Employee PF (12%)', 'Employer EPS (8.33%)', 'Employer EPF (3.67%)', 'NCP days'],
      rows.filter((x) => Number(x.pf_employee) > 0).map((x) => [x.employee_code, x.employee_name, x.uan ?? 'UAN missing', money(x.gross), money(x.pf_wages), money(Math.min(Number(x.pf_wages), 15000)),
        money(x.pf_employee), money(x.eps_employer), money(x.epf_employer), Number(x.lop_days)])));
  }
  if (report === 'esi') {
    return file(`esi-${p.month}`, sheet(`ESI ${p.month}`, ['IP number', 'Name', 'Days paid', 'ESI wages', 'Employee contribution (0.75%)', 'Employer contribution (3.25%)'],
      rows.filter((x) => Number(x.esi_employee) > 0 || Number(x.esi_employer) > 0).map((x) => [x.esic_number ?? 'IP missing', x.employee_name, Number(x.payable_days), money(x.esi_wages), money(x.esi_employee), money(x.esi_employer)])));
  }
  if (report === 'pt') {
    return file(`pt-${p.month}`, sheet(`Professional tax ${p.month}`, ['Employee code', 'Name', 'State', 'Gross', 'Professional tax'],
      rows.map((x) => [x.employee_code, x.employee_name, x.pt_state ?? '', money(x.gross), money(x.pt)])));
  }
  return file(`tds-${p.month}`, sheet(`TDS ${p.month}`, ['Employee code', 'Name', 'PAN', 'Gross', 'Taxable', 'TDS deducted'],
    rows.map((x) => [x.employee_code, x.employee_name, x.pan ?? 'PANNOTAVBL', money(x.gross), money(x.taxable), money(x.tds)])));
}

async function form16(ctx: OrgContext, p: Params): Promise<Output> {
  const y = Number(p.year);
  const { byId } = await staff(ctx, p);
  const { runs, acc } = await statutoryYear(ctx, y);
  if (runs.length === 0) return { kind: 'error', message: `No locked payroll in FY ${fyLabel(y)} yet.` };
  const out = [...acc].filter(([id]) => byId.has(id)).map(([id, a]) => [a.code, a.name, a.pan || 'PANNOTAVBL', a.months, money(a.gross), money(a.taxable), money(a.tds),
    `/app/${ctx.org.slug}/payroll/forms/${id}?fy=${fyLabel(y)}&form=16`] as Cell[]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return file(`form16-summary-${fyLabel(y)}`, sheet(`Form 16 FY ${fyLabel(y)}`, ['Employee code', 'Name', 'PAN', 'Months paid', 'Gross salary', 'Taxable salary', 'TDS deducted', 'Form 16 Part B (open in PeopleCore)'], out));
}

// ─── Workforce intelligence ─────────────────────────────────────────────────

async function headcount(ctx: OrgContext, p: Params): Promise<Output> {
  const { people } = await staff(ctx, p);
  const now = people.filter((e) => ['active', 'on_notice'].includes(e.status));
  const count = (f: (e: Person) => string) => { const m = new Map<string, number>(); for (const e of now) m.set(f(e) || '—', (m.get(f(e) || '—') ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const rows: Cell[][] = [
    ...count((e) => e.department).map(([k, n]) => ['Department', k, n]),
    ...count((e) => e.location).map(([k, n]) => ['Location', k, n]),
    ...count((e) => EMPLOYMENT_TYPE_LABELS[e.employment_type]).map(([k, n]) => ['Employee type', k, n]),
    ['Total', '', now.length],
  ];
  return file(`headcount-${todayIn(ctx.org.timezone)}`, sheet('Headcount', ['Dimension', 'Value', 'Headcount'], rows));
}

async function attrition(ctx: OrgContext, p: Params): Promise<Output> {
  const { people } = await staff(ctx, p);
  const today = todayIn(ctx.org.timezone);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(today.slice(0, 7), i - 11));
  const employed = (d: string) => people.filter((e) => e.date_of_joining <= d && (!e.date_of_exit || e.date_of_exit >= d)).length;
  const rows = months.map((m) => {
    const start = `${m}-01`; const end = monthEnd(m) < today ? monthEnd(m) : today;
    const exits = people.filter((e) => e.date_of_exit && e.date_of_exit >= start && e.date_of_exit <= end).length;
    const joins = people.filter((e) => e.date_of_joining >= start && e.date_of_joining <= end).length;
    const avg = (employed(start) + employed(end)) / 2;
    return [monthLabel(m), employed(start), joins, exits, employed(end), avg ? Math.round((exits / avg) * 1000) / 10 : null] as Cell[];
  });
  return file(`attrition-${today}`, sheet('Attrition', ['Month', 'Opening headcount', 'Joiners', 'Exits', 'Closing headcount', 'Attrition %'], rows));
}

async function diversity(ctx: OrgContext, p: Params): Promise<Output> {
  const { people } = await staff(ctx, p);
  const now = people.filter((e) => ['active', 'on_notice'].includes(e.status));
  const pers = await personalFor(now.map((e) => e.id));
  const genders = ['female', 'male', 'non_binary', 'undisclosed'];
  const by = new Map<string, Map<string, number>>();
  for (const e of now) {
    const g = pers.get(e.id)?.gender ?? 'not_recorded';
    const d = e.department || '—';
    const m = by.get(d) ?? new Map<string, number>(); m.set(g, (m.get(g) ?? 0) + 1); by.set(d, m);
  }
  const keys = [...genders, 'not_recorded'];
  const rows = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([d, m]) => [d, ...keys.map((k) => m.get(k) ?? 0), [...m.values()].reduce((a, b) => a + b, 0)] as Cell[]);
  return file(`diversity-${todayIn(ctx.org.timezone)}`, sheet('Gender by department', ['Department', ...keys.map(humanize), 'Total'], rows));
}

async function ctcReport(ctx: OrgContext, p: Params): Promise<Output> {
  const supabase = await createClient();
  const { people } = await staff(ctx, p);
  const now = people.filter((e) => ['active', 'on_notice'].includes(e.status));
  const today = todayIn(ctx.org.timezone);
  const recs = await pages((a, b) => supabase.from('compensation_records').select('employee_id, effective_from, annual_ctc').eq('organization_id', ctx.org.id)
    .lte('effective_from', today).order('effective_from', { ascending: false }).range(a, b));
  const latest = new Map<string, number>();
  for (const r of recs) if (!latest.has(r.employee_id)) latest.set(r.employee_id, Number(r.annual_ctc));
  const by = new Map<string, number[]>();
  for (const e of now) { const c = latest.get(e.id); if (c === undefined) continue; const k = e.department || '—'; by.set(k, [...(by.get(k) ?? []), c]); }
  const rows = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([d, xs]) => [d, xs.length, money(xs.reduce((a, b) => a + b, 0)), money(xs.reduce((a, b) => a + b, 0) / xs.length), money(Math.min(...xs)), money(Math.max(...xs))] as Cell[]);
  return file(`ctc-${today}`, sheet('CTC by department', ['Department', 'Employees with CTC', 'Total annual CTC', 'Average CTC', 'Lowest', 'Highest'], rows));
}

// ─── Custom builder ─────────────────────────────────────────────────────────

export async function customReport(ctx: OrgContext, p: Params, config: { columns: string[]; group: string | null; name?: string }): Promise<Output> {
  const personal = ctx.can('employee.personal.read', 'org') || ctx.can('employee.personal.read', 'team');
  const cols = BUILDER_COLUMNS.filter((c) => config.columns.includes(c.key) && (personal || !c.personal));
  if (cols.length === 0) return { kind: 'error', message: 'Choose at least one column.' };
  const { people } = await staff(ctx, p);
  const today = todayIn(ctx.org.timezone);
  const current = people.filter((e) => ['active', 'on_notice', 'pre_joining'].includes(e.status));
  const pers = cols.some((c) => c.personal) ? await personalFor(current.map((e) => e.id)) : new Map();
  const group = BUILDER_GROUPS.find((g) => g.key === config.group);
  const groupOf = (e: Person) => (group ? String(columnValue(group.key === 'employment_type' ? 'employment_type' : group.key, e, pers, today) || '—') : '');
  const rows = current.map((e) => [...(group ? [groupOf(e)] : []), ...cols.map((c) => columnValue(c.key, e, pers, today))])
    .sort((a, b) => (group ? String(a[0]).localeCompare(String(b[0])) : 0) || String(a[group ? 1 : 0]).localeCompare(String(b[group ? 1 : 0])));
  const main = sheet(config.name ?? 'Report', [...(group ? [group.label] : []), ...cols.map((c) => c.label)], rows);
  if (!group) return file(`custom-report-${today}`, main);
  const counts = new Map<string, number>();
  for (const e of current) counts.set(groupOf(e), (counts.get(groupOf(e)) ?? 0) + 1);
  return file(`custom-report-${today}`, main, sheet('Summary', [group.label, 'Employees'], [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => [k, n])));
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export async function runReport(ctx: OrgContext, key: string, p: Params): Promise<Output> {
  const info = REPORT_BY_KEY.get(key);
  if (!info || !canRun(ctx, info.access)) return { kind: 'error', message: 'You can’t run this report.' };
  const base = `/app/${ctx.org.slug}`;
  switch (key) {
    case 'consolidated_attendance': return consolidatedAttendance(ctx, p);
    case 'muster_roll': { const bad = tooLong(p, 62); if (bad) return bad; return file(`muster-roll-${p.from}-to-${p.to}`, await musterSheets(ctx, p, p.from, p.to, 'Muster roll')); }
    case 'form_d': { const bad = tooLong(p, 62); if (bad) return bad; return file(`form-d-${p.from}-to-${p.to}`, await musterSheets(ctx, p, p.from, p.to, 'Form D')); }
    case 'form_t': {
      let wages: Map<string, { payable: number; gross: number; deductions: number; net: number }> | undefined;
      if (canRun(ctx, 'payroll')) {
        const run = await runFor(ctx, p.month);
        if (run) wages = new Map((await runEmployees(run.id)).map((r) => [r.employee_id, { payable: Number(r.payable_days), gross: money(r.gross), deductions: money(r.deductions), net: money(r.net) }]));
      }
      const end = monthEnd(p.month);
      return file(`form-t-${p.month}`, await musterSheets(ctx, p, `${p.month}-01`, end, `Form T ${p.month}`, wages ?? new Map()));
    }
    case 'late_early': return lateEarly(ctx, p);
    case 'comp_off_log': return compOff(ctx, p);
    case 'employee_master': return employeeMaster(ctx, p);
    case 'join_exit': return joinExit(ctx, p);
    case 'probation_confirmation': return probation(ctx, p);
    case 'leave_register': return leaveRegister(ctx, p);
    case 'leave_balance': return leaveBalance(ctx, p);
    case 'consolidated_net_pay': return netPay(ctx, p);
    case 'gross_vs_net': return grossVsNet(ctx, p);
    case 'reconciliation': return reconciliation(ctx, p);
    case 'jv_output': return jv(ctx, p);
    case 'salary_variance': return variance(ctx, p);
    case 'salary_revision': return revisions(ctx, p);
    case 'tax_computation': return taxComputation(ctx, p);
    case 'department_wise': return departmentWise(ctx, p);
    case 'yearly_consolidated_pay': return yearlyPay(ctx, p);
    case 'pending_expenses': return expenses(ctx, p, 'pending');
    case 'approved_expenses': return expenses(ctx, p, 'approved');
    case 'expense_payout': return expenses(ctx, p, 'payout');
    case 'pf_register': return statutory(ctx, p, 'pf');
    case 'esi_contribution': return statutory(ctx, p, 'esi');
    case 'pt_report': return statutory(ctx, p, 'pt');
    case 'tds_report': return statutory(ctx, p, 'tds');
    case 'form_16': return form16(ctx, p);
    case 'pf_ecr': {
      const run = await runFor(ctx, p.month);
      if (!run || run.status !== 'locked') return { kind: 'error', message: `The PF ECR needs a locked payroll for ${monthLabel(p.month)}.` };
      return { kind: 'link', url: `${base}/payroll/statutory?report=pf_ecr&run=${run.id}` };
    }
    case 'form_24q': return { kind: 'link', url: `${base}/payroll/statutory?report=tds24q&fy=${fyLabel(Number(p.year))}&q=${p.quarter}` };
    case 'attrition': return attrition(ctx, p);
    case 'headcount': return headcount(ctx, p);
    case 'diversity': return diversity(ctx, p);
    case 'ctc': return ctcReport(ctx, p);
    case 'custom_builder': return customReport(ctx, p, { columns: p.columns, group: p.group });
    case 'saved_templates': {
      if (!p.template) return { kind: 'error', message: 'Choose a saved template.' };
      const supabase = await createClient();
      const { data } = await supabase.from('report_templates').select('name, config').eq('id', p.template).eq('organization_id', ctx.org.id).maybeSingle();
      if (!data) return { kind: 'error', message: 'That template no longer exists.' };
      const c = data.config as { columns?: string[]; group?: string | null };
      return customReport(ctx, p, { columns: Array.isArray(c.columns) ? c.columns.map(String) : [], group: typeof c.group === 'string' ? c.group : null, name: data.name });
    }
  }
  return { kind: 'error', message: 'Unknown report.' };
}
