import 'server-only';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/** Loans: payroll staff see all; borrowers see their own; approvers see applications they are deciding (RLS). */

export async function listLoans(orgId: string, employeeId?: string) {
  const supabase = await createClient();
  let q = supabase.from('loans')
    .select('id, employee_id, kind, amount, interest_rate, tenure_months, emi, purpose, status, approval_request_id, decided_at, disbursed_on, disbursal_mode, disbursal_reference, first_emi_month, closed_at, closure_note, created_at')
    .eq('organization_id', orgId);
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data, error } = await allRows((a, b) => q.order('created_at', { ascending: false }).order('id').range(a, b));
  if (error || !data) throw new Error(`Failed to load loans (${error?.code})`);
  return data.map((l) => ({ ...l, amount: Number(l.amount), emi: Number(l.emi), interest_rate: Number(l.interest_rate) }));
}
export type LoanRow = Awaited<ReturnType<typeof listLoans>>[number];

export async function loanInstallments(orgId: string, loanIds?: string[]) {
  const supabase = await createClient();
  let q = supabase.from('loan_installments')
    .select('id, loan_id, seq, due_month, opening_balance, principal, interest, emi, status, paid_at').eq('organization_id', orgId);
  if (loanIds) q = q.in('loan_id', loanIds.length ? loanIds : ['00000000-0000-0000-0000-000000000000']);
  const { data, error } = await allRows((a, b) => q.order('due_month').order('seq').order('id').range(a, b));
  if (error || !data) throw new Error(`Failed to load loan schedules (${error?.code})`);
  return data.map((i) => ({ ...i, opening_balance: Number(i.opening_balance), principal: Number(i.principal), interest: Number(i.interest), emi: Number(i.emi) }));
}
export type InstalmentRow = Awaited<ReturnType<typeof loanInstallments>>[number];

export async function loanSettings(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('loan_settings').select('*').eq('organization_id', orgId).single();
  if (error) throw new Error(`Failed to load loan settings (${error.code})`);
  return { ...data, interest_rate: Number(data.interest_rate), max_amount: Number(data.max_amount), salary_multiple: Number(data.salary_multiple) };
}

export interface Eligibility {
  eligible: boolean; reasons: string[]; monthlyGross: number; serviceMonths: number; maxAmount: number; maxTenure: number;
  interestRate: number; maxEmi: number; currentEmi: number; maxEmiPercent: number; salaryMultiple: number;
}

export async function loanEligibility(orgId: string): Promise<Eligibility | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('loan_eligibility', { p_org: orgId });
  if (error) return null; // no employee record
  return data as unknown as Eligibility;
}

/** Outstanding principal and paid count per loan. */
export function loanProgress(installments: InstalmentRow[]) {
  const by = new Map<string, { paid: number; total: number; outstanding: number; next: InstalmentRow | null }>();
  for (const i of installments) {
    const p = by.get(i.loan_id) ?? { paid: 0, total: 0, outstanding: 0, next: null };
    p.total += 1;
    if (i.status === 'paid') p.paid += 1;
    if (i.status === 'scheduled' || i.status === 'queued') {
      p.outstanding += i.principal;
      if (!p.next) p.next = i;
    }
    by.set(i.loan_id, p);
  }
  return by;
}
