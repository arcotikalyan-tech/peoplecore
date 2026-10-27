import 'server-only';
import { legalName } from '@peoplecore/shared';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/**
 * Data for the payroll workspace (Kredily's Payroll: hub, run, register, payout, people & salaries, declarations,
 * compliance, insights, settings). Reads go through RLS as the signed-in user; payroll staff see everything here.
 */

export type MonthIso = `${number}-${number}-01`;

export const monthEnd = (month: string) => {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
export const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};
/** The Indian financial year a month falls in, as '2026-27'. */
export const fyOf = (month: string) => {
  const y = Number(month.slice(0, 4));
  const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

const fail = (what: string, e: { code?: string; message?: string } | null) => { if (e) throw new Error(`Failed to load ${what} (${e.code}: ${e.message})`); };

export async function payrollSettings(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_settings').select('*').eq('organization_id', orgId).maybeSingle();
  fail('payroll settings', error);
  return data;
}

export async function bankSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('payroll_bank_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return data;
}

/** The (non-cancelled) run for a month, if any, and the latest runs for trends. */
export async function monthRun(orgId: string, month: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_runs').select('*').eq('organization_id', orgId).eq('period_month', month)
    .neq('status', 'cancelled').maybeSingle();
  fail('the payroll run', error);
  return data;
}

export async function recentRuns(orgId: string, limit = 12) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_runs')
    .select('id, period_month, status, employee_count, total_gross, total_deductions, total_net, total_employer_cost, locked_at, prepared_by, approved_by')
    .eq('organization_id', orgId).neq('status', 'cancelled').order('period_month', { ascending: false }).limit(limit);
  fail('payroll runs', error);
  return data ?? [];
}

export interface PayrollPerson {
  id: string; code: string; name: string; status: string; joined: string; exited: string | null;
  department: string | null; designation: string | null; location: string | null; userId: string | null;
  ctc: number | null; monthlyGross: number; structureId: string | null; payBasis: 'monthly' | 'daily' | 'hourly'; compensationFrom: string | null;
  lines: Array<{ componentId: string; amount: number }>;
}

/** Everyone payroll pays in a month, with the salary in force at the month's end. */
export async function payrollPeople(orgId: string, month: string): Promise<PayrollPerson[]> {
  const supabase = await createClient();
  const end = monthEnd(month);
  const [emps, depts, desigs, locs, recs] = await Promise.all([
    allRows((a, b) => supabase.from('employees').select('id, employee_code, first_name, middle_name, last_name, status, date_of_joining, date_of_exit, department_id, designation_id, location_id, user_id')
      .eq('organization_id', orgId).neq('status', 'pre_joining').lte('date_of_joining', end).order('employee_code').order('id').range(a, b)),
    supabase.from('departments').select('id, name').eq('organization_id', orgId),
    supabase.from('designations').select('id, name:title').eq('organization_id', orgId),
    supabase.from('locations').select('id, name').eq('organization_id', orgId),
    supabase.from('compensation_records').select('id, employee_id, annual_ctc, structure_id, pay_basis, effective_from, effective_to')
      .eq('organization_id', orgId).lte('effective_from', end),
  ]);
  fail('employees', emps.error);
  const name = (rows: Array<{ id: string; name: string }> | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
  const [d, g, l] = [name(depts.data), name(desigs.data), name(locs.data)];
  const current = new Map<string, NonNullable<typeof recs.data>[number]>();
  for (const r of recs.data ?? []) if (!r.effective_to || r.effective_to >= end) current.set(r.employee_id, r);
  const ids = [...current.values()].map((r) => r.id);
  const lines = ids.length ? (await supabase.from('compensation_lines').select('record_id, component_id, monthly_amount').in('record_id', ids)).data ?? [] : [];
  const byRecord = new Map<string, Array<{ componentId: string; amount: number }>>();
  for (const x of lines) byRecord.set(x.record_id, [...(byRecord.get(x.record_id) ?? []), { componentId: x.component_id, amount: Number(x.monthly_amount) }]);
  return (emps.data ?? [])
    .filter((e) => !e.date_of_exit || e.date_of_exit >= month)
    .map((e) => {
      const c = current.get(e.id);
      const ls = c ? byRecord.get(c.id) ?? [] : [];
      return {
        id: e.id, code: e.employee_code, name: legalName(e), status: e.status, joined: e.date_of_joining, exited: e.date_of_exit,
        department: e.department_id ? d.get(e.department_id) ?? null : null, designation: e.designation_id ? g.get(e.designation_id) ?? null : null,
        location: e.location_id ? l.get(e.location_id) ?? null : null, userId: e.user_id,
        ctc: c ? Number(c.annual_ctc) : null, monthlyGross: ls.reduce((s, x) => s + x.amount, 0), structureId: c?.structure_id ?? null,
        payBasis: (c?.pay_basis ?? 'monthly') as PayrollPerson['payBasis'], compensationFrom: c?.effective_from ?? null, lines: ls,
      };
    });
}

export interface Readiness { pan: string | null; uan: string | null; esic: string | null; bank: string | null; ifsc: string | null; last4: string | null }

export async function readiness(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('payroll_readiness', { p_org: orgId });
  if (error) return new Map<string, Readiness>();
  return new Map((data ?? []).map((r) => [r.employee_id, { pan: r.pan, uan: r.uan, esic: r.esic_number, bank: r.bank_name, ifsc: r.ifsc, last4: r.account_last4 }]));
}

export async function components(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('salary_components').select('id, code, name, kind, taxable, pf_wage, position, is_active, category, description')
    .eq('organization_id', orgId).order('position').order('code');
  fail('salary components', error);
  return data ?? [];
}

export async function structures(orgId: string) {
  const supabase = await createClient();
  const [s, l] = await Promise.all([
    supabase.from('salary_structures').select('id, name, description, pay_basis, is_default, is_system, archived_at, created_at').eq('organization_id', orgId).order('is_default', { ascending: false }).order('name'),
    supabase.from('salary_structure_lines').select('structure_id, component_id, calc, value, position').eq('organization_id', orgId).order('position'),
  ]);
  fail('salary structures', s.error);
  return (s.data ?? []).map((x) => ({ ...x, lines: (l.data ?? []).filter((y) => y.structure_id === x.id).map((y) => ({ ...y, value: Number(y.value) })) }));
}

export async function revisions(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('salary_revisions').select('*').eq('organization_id', orgId).order('requested_at', { ascending: false }).limit(200);
  fail('salary revisions', error);
  return data ?? [];
}

export async function monthInputs(orgId: string, month: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_employee_inputs').select('*').eq('organization_id', orgId).eq('period_month', month);
  fail('payroll inputs', error);
  return new Map((data ?? []).map((r) => [r.employee_id, r]));
}

export async function pendingAdjustments(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('payroll_adjustments').select('id, employee_id, code, name, kind, amount, taxable, reason, applied_run_id, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(300);
  return data ?? [];
}

export async function runResults(runId: string) {
  const supabase = await createClient();
  const [rows, lines] = await Promise.all([
    supabase.from('payroll_run_employees').select('employee_id, payable_days, lop_days, gross, deductions, net, employer_cost, taxable, exceptions, has_blocking, input').eq('run_id', runId),
    supabase.from('payroll_line_items').select('employee_id, code, name, kind, amount').eq('run_id', runId).order('id'),
  ]);
  fail('payroll results', rows.error);
  const byEmp = new Map<string, Array<{ code: string; name: string; kind: string; amount: number }>>();
  for (const l of lines.data ?? []) byEmp.set(l.employee_id, [...(byEmp.get(l.employee_id) ?? []), { code: l.code, name: l.name, kind: l.kind, amount: Number(l.amount) }]);
  return new Map((rows.data ?? []).map((r) => [r.employee_id, { ...r, lines: byEmp.get(r.employee_id) ?? [] }]));
}

export async function payouts(runId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('payroll_payouts').select('*').eq('run_id', runId);
  return new Map((data ?? []).map((p) => [p.employee_id, p]));
}

async function withItems<T extends { id: string }>(decls: T[]) {
  if (decls.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('tax_declaration_items').select('*').in('declaration_id', decls.map((d) => d.id)).order('created_at');
  fail('declaration items', error);
  return decls.map((d) => ({ ...d, tax_declaration_items: (data ?? []).filter((i) => i.declaration_id === d.id) }));
}

export async function declarations(orgId: string, fy: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('tax_declarations').select('*').eq('organization_id', orgId).eq('fy', fy);
  fail('tax declarations', error);
  return withItems(data ?? []);
}

export async function myDeclaration(orgId: string, employeeId: string, fy: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('tax_declarations').select('*').eq('organization_id', orgId).eq('employee_id', employeeId).eq('fy', fy).maybeSingle();
  return data ? (await withItems([data]))[0]! : null;
}

export async function exportLog(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('payroll_export_log', { p_org: orgId, p_days: 30 });
  return data ?? [];
}

/** Totals by line code across locked runs (trends and insights). */
export async function lockedLineTotals(orgId: string, runIds: string[]) {
  if (runIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await allRows((a, b) => supabase.from('payroll_line_items').select('run_id, code, name, kind, amount, employee_id').eq('organization_id', orgId).in('run_id', runIds).order('id').range(a, b));
  return (data ?? []).map((l) => ({ ...l, amount: Number(l.amount) }));
}

export async function approvedEncashments(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('leave_encashments').select('id, employee_id, days, status, payroll_run_id, created_at').eq('organization_id', orgId)
    .eq('status', 'approved').is('payroll_run_id', null);
  return data ?? [];
}

export async function approvedClaimsTotal(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('expense_claims').select('employee_id, total').eq('organization_id', orgId).eq('status', 'approved');
  return data ?? [];
}
