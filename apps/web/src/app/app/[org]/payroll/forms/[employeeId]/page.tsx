import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { annualIncomeTax, oldRegimeReliefs, ruleSetSchema, type Declaration } from '@peoplecore/payroll';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { myDeclaration } from '@/server/payroll-suite';
import { createClient } from '@/server/supabase';
import { PrintButton } from '../../../separations/[separationId]/letter/[kind]/print-button';

export const metadata: Metadata = { title: 'Tax form' };

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const SECTION_NAMES: Record<string, string> = {
  hra: 'House rent allowance (rent paid)', '80C': 'Section 80C', '80CCD1B': 'Section 80CCD(1B)', '80D_self': 'Section 80D (self and family)',
  '80D_parents': 'Section 80D (parents)', '80E': 'Section 80E', '80G': 'Section 80G', '80TTA': 'Section 80TTA', '24B': 'Interest on housing loan (section 24(b))',
  lta: 'Leave travel concession', prev_employer: 'Income from previous employer', other: 'Other Chapter VI-A deductions', reimbursement: 'Reimbursements',
};

/**
 * Form 12BB (the employee's declaration, with landlord and lender details) and Form 16 Part B (the year's salary,
 * exemptions, deductions and TDS from locked runs). For payroll staff, and for the employee about themselves.
 * Both are working copies to print: Form 16 Part A comes from TRACES.
 */
export default async function TaxFormPage({ params, searchParams }: { params: Promise<{ org: string; employeeId: string }>; searchParams: Promise<{ fy?: string; form?: string }> }) {
  const { org: slug, employeeId } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(employeeId).success || !/^\d{4}-\d{2}$/.test(sp.fy ?? '')) notFound();
  const fy = sp.fy!;
  const form = sp.form === '16' ? '16' : '12bb';
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const staff = ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org');
  if (!staff && me?.id !== employeeId) notFound();
  const supabase = await createClient();
  const [{ data: emp }, decl] = await Promise.all([
    supabase.from('employees').select('employee_code, first_name, middle_name, last_name, date_of_joining').eq('organization_id', ctx.org.id).eq('id', employeeId).maybeSingle(),
    myDeclaration(ctx.org.id, employeeId, fy),
  ]);
  if (!emp) notFound();
  const name = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' ');
  const from = `${fy.slice(0, 4)}-04-01`;
  const to = `${Number(fy.slice(0, 4)) + 1}-03-01`;
  const back = staff ? `/app/${slug}/payroll?tab=declarations&fy=${fy}&view=forms` : `/app/${slug}/payslips?tab=tax`;

  if (form === '12bb') {
    if (!decl) notFound();
    return (
      <article className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-line bg-surface p-8 print:border-0 print:p-0">
        <div className="flex items-center justify-between print:hidden"><Link href={back} className="text-sm text-muted">← Back</Link><PrintButton /></div>
        <header className="text-center"><h1 className="text-xl font-semibold">Form No. 12BB</h1><p className="text-sm text-muted">(See rule 26C) · Statement showing particulars of claims by an employee for deduction of tax</p></header>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Name of the employee</dt><dd>{name} ({emp.employee_code})</dd>
          <dt className="text-muted">Employer</dt><dd>{ctx.org.name}</dd>
          <dt className="text-muted">Financial year</dt><dd>{fy}</dd>
          <dt className="text-muted">Tax regime</dt><dd className="capitalize">{decl.regime}</dd>
          <dt className="text-muted">Status</dt><dd className="capitalize">{decl.status}</dd>
        </dl>
        <table className="w-full border border-line text-sm">
          <thead><tr className="bg-subtle text-left"><th className="border border-line p-2">Nature of claim</th><th className="border border-line p-2 text-right">Declared (Rs.)</th><th className="border border-line p-2 text-right">Approved (Rs.)</th><th className="border border-line p-2">Evidence / particulars</th></tr></thead>
          <tbody>
            {decl.tax_declaration_items.length === 0 && <tr><td colSpan={4} className="border border-line p-3 text-center text-muted">No claims.</td></tr>}
            {decl.tax_declaration_items.map((i) => (
              <tr key={i.id}>
                <td className="border border-line p-2">{SECTION_NAMES[i.section] ?? i.section}<span className="block text-xs text-muted">{i.label}</span></td>
                <td className="border border-line p-2 text-right tabular-nums">{inr.format(Number(i.declared))}</td>
                <td className="border border-line p-2 text-right tabular-nums">{i.approved === null ? '—' : inr.format(Number(i.approved))}</td>
                <td className="border border-line p-2 text-xs">{Object.entries((i.details ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('; ') || (i.tds ? `TDS deducted: Rs. ${inr.format(Number(i.tds))}` : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm">Verification: I, {name}, do hereby certify that the information given above is complete and correct.</p>
        <p className="pt-10 text-sm">Signature of the employee ____________________ &nbsp;&nbsp; Date ____________</p>
      </article>
    );
  }

  // Form 16 Part B from locked runs in the year.
  const { data: rows } = await supabase.from('payroll_run_employees').select('run_id, period_month, gross, taxable, input').eq('organization_id', ctx.org.id).eq('employee_id', employeeId)
    .gte('period_month', from).lte('period_month', to).order('period_month');
  const runIds = (rows ?? []).map((r) => r.run_id);
  const [{ data: runs }, { data: lines }, { data: sets }] = await Promise.all([
    runIds.length ? supabase.from('payroll_runs').select('id, status').in('id', runIds) : Promise.resolve({ data: [] as Array<{ id: string; status: string }> }),
    runIds.length ? supabase.from('payroll_line_items').select('run_id, code, kind, amount').eq('employee_id', employeeId).in('run_id', runIds) : Promise.resolve({ data: [] as Array<{ run_id: string; code: string; kind: string; amount: number }> }),
    supabase.from('statutory_rule_sets').select('effective_from, effective_to, rules').lte('effective_from', from).order('effective_from', { ascending: false }).limit(1),
  ]);
  const locked = new Set((runs ?? []).filter((r) => r.status === 'locked').map((r) => r.id));
  const mine = (rows ?? []).filter((r) => locked.has(r.run_id));
  const ls = (lines ?? []).filter((l) => locked.has(l.run_id));
  const total = (f: (l: { code: string; kind: string }) => boolean) => ls.filter(f).reduce((s, l) => s + Number(l.amount), 0);
  const grossSalary = total((l) => l.kind === 'earning' && l.code !== 'REIMB');
  const taxableSalary = mine.reduce((s, r) => s + Number(r.taxable), 0);
  const tds = total((l) => l.code === 'TDS');
  const pt = total((l) => l.code === 'PT');
  const rules = sets?.[0] ? ruleSetSchema.safeParse(sets[0].rules) : null;
  const d = (decl && ['submitted', 'approved'].includes(decl.status)) ? decl : null;
  const amt = (s: string) => (d?.tax_declaration_items ?? []).filter((i) => i.section === s && i.status !== 'rejected').reduce((a, i) => a + Number(i.approved ?? i.declared), 0);
  const declaration: Declaration = {
    regime: (d?.regime ?? 'new') as 'old' | 'new', metro: d?.metro, seniorSelf: d?.senior_self, seniorParents: d?.senior_parents,
    rentPaidAnnual: amt('hra'), sec80C: amt('80C'), sec80CCD1B: amt('80CCD1B'), sec80DSelf: amt('80D_self'), sec80DParents: amt('80D_parents'),
    sec80E: amt('80E'), sec80G: amt('80G'), sec80TTA: amt('80TTA'), homeLoanInterest: amt('24B'), lta: amt('lta'), otherDeductions: amt('other'),
  };
  const last = mine.at(-1)?.input as { components?: Array<{ code: string; kind: string; monthly: number }> } | undefined;
  const monthly = (code: string) => (last?.components ?? []).filter((c) => c.code === code && c.kind === 'earning').reduce((s, c) => s + Number(c.monthly), 0);
  const old = declaration.regime === 'old' && rules?.success && rules.data.incomeTax.oldRegime && rules.data.incomeTax.deductionCaps;
  const reliefs = old && rules?.success ? oldRegimeReliefs(declaration, { basic: monthly('BASIC') * 12, hra: monthly('HRA') * 12 }, rules.data.incomeTax.deductionCaps!) : { exemptions: 0, deductions: 0 };
  const regime = rules?.success ? (old ? rules.data.incomeTax.oldRegime! : rules.data.incomeTax) : null;
  const std = regime?.standardDeduction ?? 0;
  const prevIncome = amt('prev_employer');
  const income = Math.max(0, taxableSalary + prevIncome - std - reliefs.exemptions - reliefs.deductions);
  const tax = regime ? annualIncomeTax(income, regime) : 0;
  return (
    <article className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-line bg-surface p-8 print:border-0 print:p-0">
      <div className="flex items-center justify-between print:hidden"><Link href={back} className="text-sm text-muted">← Back</Link><PrintButton /></div>
      <header className="text-center"><h1 className="text-xl font-semibold">Form No. 16 — Part B (working)</h1><p className="text-sm text-muted">Details of salary paid and tax deducted · FY {fy} · {d ? `${d.regime} regime` : 'new regime (no declaration)'}</p></header>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">Employee</dt><dd>{name} ({emp.employee_code})</dd>
        <dt className="text-muted">Employer</dt><dd>{ctx.org.name}</dd>
        <dt className="text-muted">Months paid (locked runs)</dt><dd>{mine.length}</dd>
      </dl>
      <table className="w-full border border-line text-sm">
        <tbody>
          <Row n="1" label="Gross salary (excluding reimbursements)" value={grossSalary} />
          <Row n="2" label="Less: exemptions under section 10 (HRA, LTA)" value={reliefs.exemptions} />
          <Row n="3" label="Salary from previous employer" value={prevIncome} />
          <Row n="4" label="Standard deduction u/s 16(ia)" value={std} />
          <Row n="5" label="Professional tax u/s 16(iii) (deducted)" value={pt} />
          <Row n="6" label="Deductions under Chapter VI-A and 24(b)" value={reliefs.deductions} />
          <Row n="7" label="Total taxable income" value={income} strong />
          <Row n="8" label="Tax on total income (with rebate, relief and cess)" value={tax} strong />
          <Row n="9" label="Tax deducted at source by this employer" value={tds} />
          <Row n="10" label="Tax payable / (refundable)" value={tax - tds - Number((d?.tax_declaration_items ?? []).filter((i) => i.section === 'prev_employer').reduce((a, i) => a + Number(i.tds ?? 0), 0))} strong />
        </tbody>
      </table>
      <p className="text-xs text-muted">A working copy from PeopleCore’s payroll records, computed with statutory rules that have not been professionally validated. Part A (TDS deposited) is issued from TRACES. Professional tax is shown for reference and isn’t deducted in this working.</p>
    </article>
  );
}

function Row({ n, label, value, strong }: { n: string; label: string; value: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-semibold' : ''}><td className="border border-line p-2 text-muted">{n}</td><td className="border border-line p-2">{label}</td><td className="border border-line p-2 text-right tabular-nums">{inr.format(value)}</td></tr>
  );
}
