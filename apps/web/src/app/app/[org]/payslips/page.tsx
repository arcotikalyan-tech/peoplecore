import type { Metadata } from 'next';
import Link from 'next/link';
import { computePayslip, ruleSetSchema, type Declaration } from '@peoplecore/payroll';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { HubHeader, HubTabs, SubTabs } from '@/components/ui/hub';
import { EmptyState } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getPayslips } from '@/server/payroll';
import { fyOf, myDeclaration, payrollSettings } from '@/server/payroll-suite';
import { getBankSummary, getIdentitySummary } from '@/server/sensitive';
import { createClient } from '@/server/supabase';
import { saveMyDeclarationAction } from '../payroll/suite-actions';
import { MyDeclarationForm } from '../payroll/_tabs/forms';
import { Card, Figure, inr, lakhs, Pill } from '../payroll/_tabs/shared';
import { monthLabel } from '../payroll/format';

export const metadata: Metadata = { title: 'My Pay' };

const FY_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const fyMonthIso = (fy: string, i: number) => {
  const y = Number(fy.slice(0, 4)) + (i >= 9 ? 1 : 0);
  return `${y}-${String(((i + 3) % 12) + 1).padStart(2, '0')}-01`;
};

/** My Pay (Kredily's employee payroll): payslips, tax center, salary structure, reimbursements, bank and IDs. */
export default async function MyPayPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const base = `/app/${slug}/payslips`;
  const tabs = [{ key: 'hub', label: '✦ Hub' }, { key: 'payslips', label: 'Payslips' }, { key: 'tax', label: 'Tax Center' }, { key: 'structure', label: 'Salary Structure' },
    { key: 'reimbursements', label: 'Reimbursements' }, { key: 'bank', label: 'Bank & Account' }];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const today = todayIn(ctx.org.timezone);
  const currentFy = fyOf(`${today.slice(0, 7)}-01`);
  const start = Number(currentFy.slice(0, 4));
  const years = [0, 1, 2, 3, 4].map((k) => `${start - k}-${String((start - k + 1) % 100).padStart(2, '0')}`);
  const fy = years.includes(sp.fy ?? '') ? sp.fy! : currentFy;

  if (!me) return (<><HubHeader title="My Pay" /><EmptyState title="No employee record" description="Your account isn’t linked to an employee record, so there’s no pay to show." /></>);

  const supabase = await createClient();
  const [slips, settings, decl] = await Promise.all([getPayslips(ctx.org.id, me.id), payrollSettings(ctx.org.id), myDeclaration(ctx.org.id, me.id, fy)]);
  const inFy = slips.filter((s) => fyOf(s.period_month) === fy);
  const latest = slips[0];

  return (
    <>
      <HubHeader title="My Pay" badge="Reimagined" subtitle="Payslips, tax, salary and bank details in one place."
        actions={latest && <a href={`${base}/${latest.run_id}/pdf`} download className={buttonClass('primary', 'sm')}>⬇ Download Payslip</a>} />
      <HubTabs base={base} label="My pay sections" tabs={tabs} current={tab} />

      {tab === 'hub' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Last net pay" value={latest ? inr.format(Number(latest.net)) : '—'} tone="success" note={latest ? monthLabel(latest.period_month) : 'No payslips yet'} />
            <Figure label={`Gross · FY ${currentFy}`} value={lakhs(slips.filter((s) => fyOf(s.period_month) === currentFy).reduce((a, s) => a + Number(s.gross), 0))} />
            <Figure label={`Deductions · FY ${currentFy}`} value={lakhs(slips.filter((s) => fyOf(s.period_month) === currentFy).reduce((a, s) => a + Number(s.deductions), 0))} tone="warning" />
            <Figure label="Tax regime" value={decl?.regime === 'old' ? 'Old' : 'New'} tone="primary" note={decl ? `Declaration ${decl.status}` : `Default (${settings?.default_regime ?? 'new'})`} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Recent payslips" action={<Link href={`${base}?tab=payslips`} className="text-xs text-primary">View all →</Link>}>
              <SlipList base={base} slips={slips.slice(0, 4)} />
            </Card>
            <Card title="Tax declaration" action={<Link href={`${base}?tab=tax&view=declarations`} className="text-xs text-primary">Open →</Link>}>
              <p className="text-sm text-muted">{settings?.declaration_open ? `The declaration window is open${settings.declaration_until ? ` until ${formatDate(settings.declaration_until)}` : ''}. Choose your regime and declare investments to reduce TDS.` : 'The declaration window is closed.'}</p>
              {decl?.review_note && <p className="mt-2 text-sm">Payroll: “{decl.review_note}”</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'payslips' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {years.map((y) => <Link key={y} href={`${base}?tab=payslips&fy=${y}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${y === fy ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted'}`}>FY {y}</Link>)}
          </div>
          <Card title="Payslip History">
            {inFy.length === 0 ? <div className="py-8 text-center"><p className="text-2xl" aria-hidden="true">📄</p><p className="font-medium">No payslips found</p><p className="text-sm text-muted">No payslips available for this FY.</p></div>
              : <SlipList base={base} slips={inFy} />}
          </Card>
        </div>
      )}

      {tab === 'tax' && await (async () => {
        const view = ['summary', 'computation', 'declarations', 'projection'].includes(sp.view ?? '') ? sp.view! : 'summary';
        // Engine projection for the year from the current salary, locked YTD figures and the declaration.
        const end = `${today.slice(0, 7)}-01`;
        const [{ data: rec }, { data: sets }] = await Promise.all([
          supabase.from('compensation_records').select('id, pay_basis').eq('employee_id', me.id).lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`).maybeSingle(),
          supabase.from('statutory_rule_sets').select('rules, effective_from').lte('effective_from', end).order('effective_from', { ascending: false }).limit(1),
        ]);
        const { data: lines } = rec ? await supabase.from('compensation_lines').select('component_id, monthly_amount').eq('record_id', rec.id) : { data: [] };
        const { data: comps } = await supabase.from('salary_components').select('id, code, name, kind, taxable, pf_wage').eq('organization_id', ctx.org.id);
        const cmap = new Map((comps ?? []).map((c) => [c.id, c]));
        const components = (lines ?? []).map((l) => ({ code: cmap.get(l.component_id)?.code ?? '', name: cmap.get(l.component_id)?.name ?? '', kind: cmap.get(l.component_id)?.kind ?? 'earning',
          monthly: Number(l.monthly_amount), taxable: cmap.get(l.component_id)?.taxable ?? true, pfWage: cmap.get(l.component_id)?.pf_wage ?? false }));
        const fyLocked = slips.filter((s) => fyOf(s.period_month) === currentFy);
        const { data: tdsRows } = fyLocked.length ? await supabase.from('payroll_line_items').select('run_id, code, name, kind, amount').eq('employee_id', me.id).in('run_id', fyLocked.map((s) => s.run_id)) : { data: [] };
        const paidTds = (tdsRows ?? []).filter((l) => l.code === 'TDS').reduce((s, l) => s + Number(l.amount), 0);
        const { data: taxableRows } = fyLocked.length ? await supabase.from('payroll_run_employees').select('taxable, period_month').eq('employee_id', me.id).in('run_id', fyLocked.map((s) => s.run_id)) : { data: [] };
        const ytdTaxable = (taxableRows ?? []).filter((r) => r.period_month < end).reduce((s, r) => s + Number(r.taxable), 0);
        const amt = (s: string) => (decl?.tax_declaration_items ?? []).filter((i) => i.section === s && i.status !== 'rejected').reduce((a, i) => a + Number(i.approved ?? i.declared), 0);
        const declaration: Declaration = {
          regime: (decl?.regime ?? settings?.default_regime ?? 'new') as 'old' | 'new', metro: decl?.metro, seniorSelf: decl?.senior_self, seniorParents: decl?.senior_parents,
          rentPaidAnnual: amt('hra'), sec80C: amt('80C'), sec80CCD1B: amt('80CCD1B'), sec80DSelf: amt('80D_self'), sec80DParents: amt('80D_parents'), sec80E: amt('80E'),
          sec80G: amt('80G'), sec80TTA: amt('80TTA'), homeLoanInterest: amt('24B'), lta: amt('lta'), otherDeductions: amt('other'),
          prevEmployerTaxable: amt('prev_employer'), prevEmployerTds: (decl?.tax_declaration_items ?? []).filter((i) => i.section === 'prev_employer').reduce((a, i) => a + Number(i.tds ?? 0), 0),
        };
        const rules = sets?.[0] ? ruleSetSchema.safeParse(sets[0].rules) : null;
        const projection = rules?.success && components.length ? computePayslip({
          employeeId: me.id, employeeCode: '', name: '', components, daysInPeriod: 30, payableDays: 30, statutory: { pf: true, esi: null, ptState: null },
          ytd: { taxableIncome: ytdTaxable, tds: (tdsRows ?? []).filter((l) => l.code === 'TDS').reduce((s, l) => s + Number(l.amount), 0) }, reimbursements: 0, declaration,
        }, rules.data, { month: end.slice(0, 7) }) : null;
        const tdsThisMonth = projection?.lines.find((l) => l.code === 'TDS')?.amount ?? 0;
        const byMonth = (code: string, iso: string) => {
          const s = slips.find((x) => x.period_month === iso);
          if (!s) return null;
          return (tdsRows ?? []).filter((l) => l.run_id === s.run_id && l.code === code).reduce((a, l) => a + Number(l.amount), 0);
        };
        return (
          <div className="space-y-4">
            <SubTabs base={base} label="Tax center" current={view} extra={{ tab: 'tax' }} tabs={[{ key: 'summary', label: 'Tax Summary' }, { key: 'computation', label: 'Tax Computation' }, { key: 'declarations', label: 'Declarations' }, { key: 'projection', label: 'Tax Projection Sheet' }]} />
            {view === 'summary' && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure label="Regime" value={declaration.regime === 'old' ? 'Old regime' : 'New regime'} tone="primary" note={decl ? `Declaration ${decl.status}` : 'Not declared'} />
                <Figure label="Projected taxable income" value={projection?.tax ? lakhs(projection.tax.projectedAnnualTaxable) : '—'} note={`FY ${currentFy}`} />
                <Figure label="Tax for the year" value={projection?.tax ? inr.format(projection.tax.annualTax) : '—'} tone="warning" note="With rebate, relief and 4% cess" />
                <Figure label="TDS paid so far" value={inr.format(paidTds)} tone="success" note={`About ${inr.format(tdsThisMonth)} a month from now`} />
              </div>
            )}
            {view === 'computation' && (
              <Card title={`Tax computation · FY ${currentFy}`}>
                {!projection?.tax ? <p className="text-sm text-muted">No salary on record yet.</p> : (
                  <table className="w-full text-sm"><tbody className="divide-y divide-line">
                    {[
                      ['Salary paid so far (taxable)', ytdTaxable],
                      ['Salary for the rest of the year (projected)', components.filter((c) => c.kind === 'earning' && c.taxable).reduce((s, c) => s + c.monthly, 0) * projection.tax.monthsRemaining],
                      ['Earlier employer', declaration.prevEmployerTaxable ?? 0],
                      ['Less: standard deduction', -(declaration.regime === 'old' && rules?.success ? rules.data.incomeTax.oldRegime?.standardDeduction ?? 0 : rules?.success ? rules.data.incomeTax.standardDeduction : 0)],
                      ['Less: exemptions (HRA, LTA)', -(projection.tax.exemptions ?? 0)],
                      ['Less: deductions (Chapter VI-A, home loan)', -(projection.tax.deductions ?? 0)],
                      ['Taxable income', projection.tax.projectedAnnualTaxable],
                      ['Tax for the year', projection.tax.annualTax],
                      ['Already deducted (this employer and earlier)', -(paidTds + (declaration.prevEmployerTds ?? 0))],
                      ['Still to deduct', Math.max(0, projection.tax.annualTax - paidTds - (declaration.prevEmployerTds ?? 0))],
                    ].map(([l, v], i) => <tr key={i} className={i === 6 || i === 9 ? 'font-semibold' : ''}><td className="py-2">{l}</td><td className="text-right tabular-nums">{inr.format(Number(v))}</td></tr>)}
                  </tbody></table>
                )}
                <p className="mt-3 text-xs text-muted">An estimate from today’s salary and your declaration. Payroll recalculates every month.</p>
              </Card>
            )}
            {view === 'declarations' && (
              <Card title={`Declarations · FY ${fy}`} action={decl && <Pill tone={decl.status === 'approved' ? 'success' : decl.status === 'submitted' ? 'warning' : decl.status === 'rejected' ? 'danger' : 'muted'}>{decl.status}</Pill>}>
                {decl?.review_note && <p className="mb-3 rounded-lg bg-subtle px-3 py-2 text-sm">Payroll: “{decl.review_note}”</p>}
                {!settings?.declaration_open && <p className="mb-3 text-sm text-warning">The declaration window is closed.</p>}
                <MyDeclarationForm action={saveMyDeclarationAction.bind(null, slug)} fy={fy} open={Boolean(settings?.declaration_open)}
                  declaration={decl ? { regime: decl.regime, status: decl.status, metro: decl.metro, senior_self: decl.senior_self, senior_parents: decl.senior_parents, review_note: decl.review_note,
                    items: decl.tax_declaration_items.map((i) => ({ section: i.section, declared: Number(i.declared), tds: i.tds === null ? null : Number(i.tds), approved: i.approved === null ? null : Number(i.approved), status: i.status, details: (i.details ?? {}) as Record<string, string> })) } : null} />
                {decl && <p className="mt-3 text-sm"><Link href={`/app/${slug}/payroll/forms/${me.id}?fy=${fy}&form=12bb`} className="text-primary hover:underline">Form 12BB</Link> · <Link href={`/app/${slug}/payroll/forms/${me.id}?fy=${fy}&form=16`} className="text-primary hover:underline">Form 16 Part B (working)</Link></p>}
              </Card>
            )}
            {view === 'projection' && (
              <Card title={`Tax projection sheet · FY ${currentFy}`}>
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full min-w-[900px] text-xs">
                    <thead><tr className="border-b border-line text-left uppercase tracking-wider text-muted"><th className="py-2">Component</th>{FY_MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}<th className="text-right">Total</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {(['Gross', 'Income Tax', 'Net Pay'] as const).map((row) => {
                        const vals = FY_MONTHS.map((_, i) => {
                          const iso = fyMonthIso(currentFy, i);
                          const s = slips.find((x) => x.period_month === iso);
                          if (s) return row === 'Gross' ? Number(s.gross) : row === 'Net Pay' ? Number(s.net) : byMonth('TDS', iso) ?? 0;
                          if (iso < end || !projection) return 0;
                          return row === 'Gross' ? projection.gross : row === 'Net Pay' ? projection.net : tdsThisMonth;
                        });
                        return <tr key={row}><td className="py-2 font-medium">{row}</td>{vals.map((v, i) => <td key={i} className={`text-right tabular-nums ${fyMonthIso(currentFy, i) >= end && !slips.some((x) => x.period_month === fyMonthIso(currentFy, i)) ? 'text-muted' : ''}`}>{inr.format(v)}</td>)}<td className="text-right font-semibold tabular-nums">{inr.format(vals.reduce((a, b) => a + b, 0))}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <ol className="mt-3 list-decimal pl-5 text-xs text-muted"><li>Grey months are projected from today’s salary; variable pay will differ.</li><li>Changes to declarations change income tax.</li><li>Not all HRA qualifies for exemption.</li></ol>
              </Card>
            )}
          </div>
        );
      })()}

      {tab === 'structure' && await (async () => {
        const { data: recs } = await supabase.from('compensation_records').select('id, effective_from, effective_to, annual_ctc, note, structure_id').eq('employee_id', me.id).order('effective_from', { ascending: false });
        const cur = (recs ?? []).find((r) => !r.effective_to || r.effective_to >= today) ?? recs?.[0];
        const { data: lines } = cur ? await supabase.from('compensation_lines').select('component_id, monthly_amount').eq('record_id', cur.id) : { data: [] };
        const { data: comps } = await supabase.from('salary_components').select('id, name, kind, position').eq('organization_id', ctx.org.id).order('position');
        const gross = (lines ?? []).reduce((s, l) => s + Number(l.monthly_amount), 0);
        const { data: emp } = await supabase.from('employees').select('date_of_joining').eq('id', me.id).maybeSingle();
        const joined = emp?.date_of_joining;
        return (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Current Salary" action={cur && <span className="text-xs text-muted">Effective: {formatDate(cur.effective_from)}</span>}>
              {!cur ? <p className="text-sm text-muted">No salary on record yet.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Component</th><th className="text-right">Monthly</th><th className="text-right">Annual</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    <tr className="font-semibold"><td className="py-2">GROSS</td><td className="text-right tabular-nums">{inr.format(gross)}</td><td className="text-right tabular-nums">{inr.format(gross * 12)}</td></tr>
                    {(comps ?? []).filter((c) => (lines ?? []).some((l) => l.component_id === c.id)).map((c) => {
                      const v = Number((lines ?? []).find((l) => l.component_id === c.id)!.monthly_amount);
                      return <tr key={c.id}><td className="py-2">{c.name}</td><td className="text-right tabular-nums">{inr.format(v)}</td><td className="text-right tabular-nums">{inr.format(v * 12)}</td></tr>;
                    })}
                    <tr className="text-muted"><td className="py-2">PF / ESI employer</td><td className="text-right" colSpan={2}>Calculated each month</td></tr>
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-muted">* Effective date reflects the most recent change in gross or structure breakup.</p>
            </Card>
            <Card title="Revision History">
              <ol className="space-y-3">
                {(recs ?? []).map((r) => (
                  <li key={r.id} className="flex gap-3 text-sm">
                    <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    <span><span className="block font-medium">{inr.format(Number(r.annual_ctc))} a year</span><span className="text-xs text-muted">From {formatDate(r.effective_from)}{r.note ? ` · ${r.note}` : ''}</span></span>
                  </li>
                ))}
                <li className="flex gap-3 text-sm"><span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-success" /><span><span className="block font-medium">Joined</span><span className="text-xs text-muted">{joined ? formatDate(joined) : ''}</span></span></li>
              </ol>
            </Card>
          </div>
        );
      })()}

      {tab === 'reimbursements' && await (async () => {
        const { data: claims } = await supabase.from('expense_claims').select('id, title, total, status, created_at').eq('employee_id', me.id).order('created_at', { ascending: false }).limit(100);
        const from = `${currentFy.slice(0, 4)}-04-01`;
        const fyClaims = (claims ?? []).filter((c) => c.created_at >= from);
        const s = (f: (c: { status: string }) => boolean) => fyClaims.filter(f).reduce((a, c) => a + Number(c.total), 0);
        return (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Figure label="Claimed YTD" value={inr.format(s(() => true))} note="This financial year" />
              <Figure label="In review" value={inr.format(s((c) => c.status === 'pending'))} tone="warning" note={`${fyClaims.filter((c) => c.status === 'pending').length} claim(s) pending`} />
              <Figure label="Approved" value={inr.format(s((c) => c.status === 'approved'))} tone="primary" note="Paid with the next payroll" />
              <Figure label="Disbursed" value={inr.format(s((c) => c.status === 'paid'))} tone="success" note="Paid with payroll" />
            </div>
            <Card title="My Claims" action={<Link href={`/app/${slug}/expenses`} className="text-xs text-primary">New claim →</Link>}>
              {(claims ?? []).length === 0 ? <p className="text-sm text-muted">No reimbursement claims submitted yet.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {(claims ?? []).map((c) => <li key={c.id} className="flex items-center justify-between py-2"><Link href={`/app/${slug}/expenses/${c.id}`} className="font-medium hover:text-primary">{c.title}</Link><Pill tone={c.status === 'paid' ? 'success' : c.status === 'approved' ? 'primary' : c.status === 'rejected' ? 'danger' : 'warning'}>{c.status}</Pill><span className="tabular-nums">{inr.format(Number(c.total))}</span></li>)}
                </ul>
              )}
            </Card>
          </div>
        );
      })()}

      {tab === 'bank' && await (async () => {
        const [bank, identity] = await Promise.all([getBankSummary(me.id).catch(() => null), getIdentitySummary(me.id).catch(() => null)]);
        const profile = `/app/${slug}/employees/${me.id}`;
        return (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Salary Bank Account" action={<Link href={profile} className="text-xs text-primary">Edit →</Link>}>
              {bank?.account_number ? (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted">Bank</dt><dd>{bank.bank_name}</dd>
                  <dt className="text-muted">Account</dt><dd className="font-mono">{bank.account_number}</dd>
                  <dt className="text-muted">IFSC</dt><dd className="font-mono">{bank.ifsc}</dd>
                  <dt className="text-muted">Holder</dt><dd>{bank.account_holder_name}</dd>
                </dl>
              ) : <p className="text-sm text-muted">No bank account on file. Add one to receive salary credits.</p>}
              <p className="mt-3 text-xs text-muted">ⓘ Any change to bank details is recorded in the audit log; payroll uses the account on file when the month is locked.</p>
            </Card>
            <Card title="Identity & Statutory" action={<Link href={profile} className="text-xs text-primary">Edit →</Link>}>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">PAN</dt><dd className="font-mono">{identity?.pan ?? '—'}</dd>
                <dt className="text-muted">Aadhaar</dt><dd className="font-mono">{identity?.aadhaar_last4 ? `XXXX XXXX ${identity.aadhaar_last4}` : '—'}</dd>
                <dt className="text-muted">UAN (PF)</dt><dd className="font-mono">{identity?.uan ?? '—'}</dd>
                <dt className="text-muted">ESI number</dt><dd className="font-mono">{identity?.esic_number ?? '—'}</dd>
              </dl>
            </Card>
          </div>
        );
      })()}
    </>
  );
}

function SlipList({ base, slips }: { base: string; slips: Array<{ run_id: string; period_month: string; payable_days: number | string; gross: number | string; deductions: number | string; net: number | string }> }) {
  if (slips.length === 0) return <p className="text-sm text-muted">No payslips yet.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Payslips</caption>
      <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Month</th><th className="text-right">Paid days</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th><th /></tr></thead>
      <tbody className="divide-y divide-line">
        {slips.map((s) => (
          <tr key={s.run_id}>
            <td className="py-2 font-medium"><Link className="text-primary hover:underline" href={`${base}/${s.run_id}`}>{monthLabel(s.period_month)}</Link></td>
            <td className="text-right tabular-nums">{Number(s.payable_days)}</td>
            <td className="text-right tabular-nums">{inr.format(Number(s.gross))}</td>
            <td className="text-right tabular-nums">{inr.format(Number(s.deductions))}</td>
            <td className="text-right font-semibold tabular-nums">{inr.format(Number(s.net))}</td>
            <td className="text-right"><a href={`${base}/${s.run_id}/pdf`} download className="text-xs text-primary">⬇ PDF</a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
