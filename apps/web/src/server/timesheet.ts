import 'server-only';
import { headers } from 'next/headers';
import { getStructure } from './structure';
import { createClient } from './supabase';

/** Timesheet reads. RLS decides what each person sees: admins everything, managers their reports, members their own. */

export interface TsSettings {
  methods: string[]; timer_edit: string[]; capture_location: boolean; max_billable: 'day' | 'week' | 'none'; max_billable_hours: number;
  restrict_days: string[]; period: 'days' | 'weeks' | 'months'; overlap: 'allow' | 'warn' | 'restrict'; rounding: number; lock_before: string | null;
  auto_lock: boolean; default_billable: boolean; creators: string[]; approval_flow: 'manager_or_admin' | 'manager_then_admin';
  approver_can_edit: boolean; rejection_reason_required: boolean; remind_submit: boolean; remind_missing: boolean; daily_target_minutes: number;
  restrict_networks: boolean; allowed_ips: string[];
}
export const DEFAULT_SETTINGS: TsSettings = {
  methods: ['start_end', 'total', 'timer'], timer_edit: ['self', 'manager', 'admin'], capture_location: false, max_billable: 'none', max_billable_hours: 8,
  restrict_days: ['future'], period: 'weeks', overlap: 'warn', rounding: 15, lock_before: null, auto_lock: true, default_billable: true,
  creators: ['self', 'manager', 'admin'], approval_flow: 'manager_or_admin', approver_can_edit: true, rejection_reason_required: true,
  remind_submit: true, remind_missing: true, daily_target_minutes: 480, restrict_networks: false, allowed_ips: [],
};

export interface Person { id: string; code: string; name: string; designation: string | null; department: string | null; email: string | null }
export interface Member { employee_id: string; rate: number | null; active: boolean }
export interface Client { id: string; name: string; organisation: string | null; email: string | null; country: string; currency: string; gstin: string | null; finance_poc: string | null; rate: number | null; archived_at: string | null }
export interface Project { id: string; name: string; client_id: string | null; kind: 'external' | 'internal'; budget_type: 'hours' | 'fees' | 'none'; budget_amount: number | null; manager_employee_id: string | null; rate: number | null; status: 'active' | 'completed' | 'archived' }
export interface Task { id: string; project_id: string; name: string; billable: boolean; rate: number | null; archived_at: string | null }
export interface Entry {
  id: string; employee_id: string; project_id: string; task_id: string | null; work_date: string; start_time: string | null; end_time: string | null;
  minutes: number; description: string | null; billable: boolean; rate: number | null; currency: string; status: 'pending' | 'manager_approved' | 'approved' | 'rejected';
  reject_reason: string | null; decided_at: string | null; created_at: string; invoice_id: string | null; source: string;
}
export interface Invoice { id: string; number: string; client_id: string; project_id: string | null; period_from: string; period_to: string; currency: string; minutes: number; total: number; status: 'draft' | 'sent' | 'paid' | 'void'; created_at: string }

export async function tsSettings(orgId: string): Promise<TsSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from('timesheet_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return data ? { ...DEFAULT_SETTINGS, ...(data as unknown as Partial<TsSettings>), max_billable_hours: Number(data.max_billable_hours) } : DEFAULT_SETTINGS;
}

export async function tsWorkspace(orgId: string) {
  const supabase = await createClient();
  const [members, clients, projects, projectMembers, tasks] = await Promise.all([
    supabase.from('ts_members').select('employee_id, rate, active').eq('organization_id', orgId),
    supabase.from('ts_clients').select('id, name, organisation, email, country, currency, gstin, finance_poc, rate, archived_at').eq('organization_id', orgId).order('name'),
    supabase.from('ts_projects').select('id, name, client_id, kind, budget_type, budget_amount, manager_employee_id, rate, status').eq('organization_id', orgId).order('name'),
    supabase.from('ts_project_members').select('project_id, employee_id').eq('organization_id', orgId),
    supabase.from('ts_tasks').select('id, project_id, name, billable, rate, archived_at').eq('organization_id', orgId).order('name'),
  ]);
  const num = <T extends Record<string, unknown>>(rows: T[] | null, keys: string[]) =>
    (rows ?? []).map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, r[k] === null || r[k] === undefined ? null : Number(r[k])])) }));
  return {
    members: num(members.data, ['rate']) as unknown as Member[],
    clients: num(clients.data, ['rate']) as unknown as Client[],
    projects: num(projects.data, ['budget_amount', 'rate']) as unknown as Project[],
    projectMembers: (projectMembers.data ?? []) as Array<{ project_id: string; employee_id: string }>,
    tasks: num(tasks.data, ['rate']) as unknown as Task[],
  };
}

export async function tsEntries(orgId: string, f: { from: string; to: string; employeeId?: string; status?: string[]; projectId?: string; limit?: number }): Promise<Entry[]> {
  const supabase = await createClient();
  let q = supabase.from('ts_entries')
    .select('id, employee_id, project_id, task_id, work_date, start_time, end_time, minutes, description, billable, rate, currency, status, reject_reason, decided_at, created_at, invoice_id, source')
    .eq('organization_id', orgId).gte('work_date', f.from).lte('work_date', f.to);
  if (f.employeeId) q = q.eq('employee_id', f.employeeId);
  if (f.projectId) q = q.eq('project_id', f.projectId);
  if (f.status?.length) q = q.in('status', f.status);
  const { data } = await q.order('work_date', { ascending: false }).order('start_time', { ascending: true, nullsFirst: false }).limit(f.limit ?? 5000);
  return (data ?? []).map((e) => ({ ...e, rate: e.rate === null ? null : Number(e.rate) })) as Entry[];
}

export async function tsPending(orgId: string): Promise<Entry[]> {
  return tsEntries(orgId, { from: '2000-01-01', to: '2999-12-31', status: ['pending', 'manager_approved'], limit: 1000 });
}

export async function tsInvoices(orgId: string): Promise<Invoice[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('ts_invoices').select('id, number, client_id, project_id, period_from, period_to, currency, minutes, total, status, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false });
  return (data ?? []).map((i) => ({ ...i, total: Number(i.total) })) as Invoice[];
}

export async function myTimer(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('ts_timers').select('project_id, task_id, description, billable, started_at').eq('organization_id', orgId).maybeSingle();
  return data;
}

/** Everyone the viewer may see in the timesheet (names for members, managers and the add-from-directory picker). */
export async function tsPeople(orgId: string): Promise<Map<string, Person>> {
  const supabase = await createClient();
  const [{ data }, structure] = await Promise.all([
    supabase.from('employees').select('id, employee_code, first_name, last_name, work_email, department_id, designation_id')
      .eq('organization_id', orgId).in('status', ['active', 'on_notice']).order('first_name'),
    getStructure(orgId),
  ]);
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  return new Map((data ?? []).map((e) => [e.id, {
    id: e.id, code: e.employee_code, name: [e.first_name, e.last_name].filter(Boolean).join(' '),
    designation: e.designation_id ? desig.get(e.designation_id) ?? null : null, department: e.department_id ? dept.get(e.department_id) ?? null : null, email: e.work_email,
  }]));
}

/** The viewer's direct reports (for the approvals tab). */
export async function myReports(orgId: string, meId: string | null): Promise<string[]> {
  if (!meId) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('employees').select('id').eq('organization_id', orgId).eq('manager_employee_id', meId);
  return (data ?? []).map((e) => e.id);
}

/** The caller's address, for the allowed-networks rule (the proxy sets x-forwarded-for). */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null)?.slice(0, 64) ?? null;
}

export const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
export const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
