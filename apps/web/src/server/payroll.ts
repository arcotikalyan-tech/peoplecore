import 'server-only';
import { createHash } from 'node:crypto';
import { canonicalJson, computePayslip, ENGINE_VERSION, resultsDigestSource, ruleSetSchema, type EmployeeInput, compareRuns, type VarianceRow } from '@peoplecore/payroll';
import { createClient } from './supabase';

/**
 * Payroll on the server. The deterministic engine runs here on inputs the database assembles
 * (payroll_run_inputs); results are stored with a SHA-256 fingerprint of those inputs. Approval recomputes
 * the run from the current inputs and names both fingerprints, so a checker approves exactly what they reproduced.
 */
export interface RunInputs {
  runId: string;
  month: string;
  ruleSet: { id: string; code: string; validated: boolean; rules: unknown };
  employees: EmployeeInput[];
}

export async function fetchInputs(runId: string): Promise<{ inputs: RunInputs; hash: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('payroll_run_inputs', { p_run: runId });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const inputs = data as unknown as RunInputs;
  return { inputs, hash: createHash('sha256').update(canonicalJson(inputs)).digest('hex') };
}

export function computeAll(inputs: RunInputs) {
  const rules = ruleSetSchema.parse(inputs.ruleSet.rules);
  return inputs.employees.map((e) => ({ ...computePayslip(e, rules, { month: inputs.month }), input: e }));
}

/** The results' fingerprint; approval needs it to match what was stored (app.payroll_results_digest). */
export function resultsHash(results: ReturnType<typeof computeAll>) {
  return createHash('sha256').update(resultsDigestSource(results)).digest('hex');
}

export { ENGINE_VERSION };

export async function listRuns(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_runs')
    .select('id, period_month, status, employee_count, total_gross, total_deductions, total_net, total_employer_cost, rule_set_id, computed_at, approved_at, locked_at, lop_from_absence')
    .eq('organization_id', orgId).order('period_month', { ascending: false }).limit(60);
  if (error) throw new Error(`Failed to load payroll runs (${error.code})`);
  return data;
}

export async function getRun(orgId: string, runId: string) {
  const supabase = await createClient();
  const { data: run, error } = await supabase.from('payroll_runs').select('*').eq('organization_id', orgId).eq('id', runId).maybeSingle();
  if (error) throw new Error(`Failed to load payroll run (${error.code})`);
  if (!run) return null;
  const [employees, rules] = await Promise.all([
    supabase.from('payroll_run_employees').select('employee_id, payable_days, lop_days, gross, deductions, net, employer_cost, exceptions, has_blocking').eq('run_id', runId),
    supabase.from('statutory_rule_sets').select('code, validated, notes').eq('id', run.rule_set_id).single(),
  ]);
  if (employees.error || rules.error) throw new Error('Failed to load payroll run');
  return { run, employees: employees.data, ruleSet: rules.data };
}

export async function getPayslips(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('payroll_run_employees')
    .select('run_id, period_month, payable_days, lop_days, gross, deductions, net')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('period_month', { ascending: false });
  if (error) throw new Error(`Failed to load payslips (${error.code})`);
  return data;
}

export async function getPayslip(orgId: string, runId: string, employeeId: string) {
  const supabase = await createClient();
  const [row, lines] = await Promise.all([
    supabase.from('payroll_run_employees').select('*').eq('organization_id', orgId).eq('run_id', runId).eq('employee_id', employeeId).maybeSingle(),
    supabase.from('payroll_line_items').select('code, name, kind, amount').eq('run_id', runId).eq('employee_id', employeeId).order('id'),
  ]);
  if (row.error || lines.error) throw new Error('Failed to load the payslip');
  return row.data ? { ...row.data, lines: lines.data } : null;
}

export async function getCompensation(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const [records, components, profile] = await Promise.all([
    supabase.from('compensation_records').select('id, effective_from, effective_to, annual_ctc').eq('organization_id', orgId).eq('employee_id', employeeId).order('effective_from', { ascending: false }),
    supabase.from('salary_components').select('id, code, name, kind, position').eq('organization_id', orgId).eq('is_active', true).order('position'),
    supabase.from('employee_statutory_profiles').select('pf_applicable, esi_applicable, pt_state').eq('employee_id', employeeId).maybeSingle(),
  ]);
  if (records.error || components.error) throw new Error('Failed to load compensation');
  const current = records.data[0];
  const lines = current
    ? (await supabase.from('compensation_lines').select('component_id, monthly_amount').eq('record_id', current.id)).data ?? []
    : [];
  return { records: records.data, components: components.data, current, lines, profile: profile.data };
}

/**
 * What changed since the last locked run before this one (deterministic: packages/payroll compareRuns), with
 * employee codes. Null when there is no earlier locked run to compare with.
 */
export async function runVariance(orgId: string, run: { id: string; period_month: string }) {
  const supabase = await createClient();
  const { data: previous, error } = await supabase.from('payroll_runs').select('id, period_month')
    .eq('organization_id', orgId).eq('status', 'locked').lt('period_month', run.period_month)
    .order('period_month', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to load the previous payroll run (${error.code})`);
  if (!previous) return null;
  const rows = async (runId: string) => {
    const r = await supabase.from('payroll_run_employees').select('employee_id, gross, net, lop_days, input').eq('run_id', runId);
    if (r.error) throw new Error(`Failed to load payroll results (${r.error.code})`);
    return r.data.map((x): VarianceRow => {
      const input = (x.input ?? {}) as Partial<VarianceRow['input']>;
      return {
        employeeId: x.employee_id, gross: Number(x.gross), net: Number(x.net), lopDays: Number(x.lop_days),
        input: { components: input.components ?? [], reimbursements: Number(input.reimbursements ?? 0), adjustments: input.adjustments ?? [] },
      };
    });
  };
  const [current, before] = await Promise.all([rows(run.id), rows(previous.id)]);
  const report = compareRuns(current, before);
  const ids = report.variances.map((v) => v.employeeId);
  const { data: people } = ids.length ? await supabase.from('employees').select('id, employee_code').in('id', ids) : { data: [] };
  const codes = new Map((people ?? []).map((p) => [p.id, p.employee_code]));
  return { previous, report, code: (id: string) => codes.get(id) ?? '—' };
}
