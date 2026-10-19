import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubTabs, Panel, StatCard } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { KIND_LABEL, LOAN_STATUS } from '@/lib/loans';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { listLoans, loanEligibility, loanInstallments, loanProgress, loanSettings, type InstalmentRow, type LoanRow } from '@/server/loans';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { ApprovalsPanel } from '../inbox/inbox-forms';
import { decideApprovalAction } from '../inbox/actions';
import { applyLoanAction, cancelLoanAction, saveLoanSettingsAction } from './actions';
import { month, ScheduleTable } from './schedule';
import { ApplyForm, CancelLoanButton, LoanSettingsForm, Simulator } from './loans-client';

export const metadata: Metadata = { title: 'Loans' };

type Search = Record<string, string | undefined>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const th = 'px-3 py-2 font-semibold';

/**
 * Loans and salary advances (Kredily's payroll-native Loans). Employees: their loans, eligibility and an EMI
 * simulator, applying, and statements. Payroll: a hub, the loan tracker, approvals and the loan policy.
 */
export default async function LoansPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const base = `/app/${slug}/loans`;
  const today = todayIn(ctx.org.timezone);
  const payroll = (ctx.can('payroll.prepare', 'org') || ctx.can('payroll.approve', 'org')) && (await viewModeFor(ctx)) === 'admin';
  const supabase = await createClient();
  const pending = await supabase.rpc('my_pending_approvals', { p_org: ctx.org.id }).then((r) => (r.data ?? []).filter((a) => a.subject_type === 'loan'));

  if (payroll) {
    const [loans, settings, people] = await Promise.all([
      listLoans(ctx.org.id), loanSettings(ctx.org.id),
      supabase.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    ]);
    const installments = await loanInstallments(ctx.org.id);
    const progress = loanProgress(installments);
    const who = new Map(people.map((p) => [p.id, { code: p.employee_code, name: [p.first_name, p.last_name].filter(Boolean).join(' ') }]));
    const tabs = [
      { key: 'hub', label: '✦ Hub' }, { key: 'tracker', label: 'Loan Tracker', count: loans.filter((l) => l.status === 'approved').length },
      { key: 'approvals', label: 'Approvals', count: pending.length }, { key: 'settings', label: 'Policy' },
    ];
    const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
    return (
      <>
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Loans &amp; Advances</h1>
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Payroll-native</span></div>
            <p className="mt-1 text-sm text-muted">Applications, disbursal and EMIs recovered through payroll.</p>
          </div>
        </header>
        <HubTabs base={base} label="Loan sections" tabs={tabs} current={tab} />
        {tab === 'hub' && <AdminHub base={base} today={today} loans={loans} installments={installments} who={who} />}
        {tab === 'tracker' && <Tracker base={base} sp={sp} loans={loans} progress={progress} who={who} />}
        {tab === 'approvals' && (
          <Panel title={`Waiting for your decision · ${pending.length}`} flush>
            <ApprovalsPanel action={decideApprovalAction.bind(null, slug)} items={pending.map((a) => ({
              id: a.id, summary: a.summary, href: a.link ? `/app/${slug}${a.link}` : null, stepLabel: a.step_label,
              meta: `From ${a.requested_by_name} · ${formatDateTime(a.created_at, ctx.org.timezone)}`,
              onBehalfOf: a.via === 'delegation' ? (a.on_behalf_of_name ?? 'a colleague') : null, escalated: a.escalated,
            }))} />
          </Panel>
        )}
        {tab === 'settings' && (
          <Panel title="Loan policy">
            {ctx.can('payroll.approve', 'org') ? <LoanSettingsForm action={saveLoanSettingsAction.bind(null, slug)} s={settings} />
              : <p className="text-sm text-muted">Only payroll approvers can change the loan policy.</p>}
          </Panel>
        )}
      </>
    );
  }

  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const [loans, eligibility] = await Promise.all([me ? listLoans(ctx.org.id, me.id) : Promise.resolve([]), me ? loanEligibility(ctx.org.id) : Promise.resolve(null)]);
  const installments = loans.length ? await loanInstallments(ctx.org.id, loans.map((l) => l.id)) : [];
  const progress = loanProgress(installments);
  const tabs = [
    { key: 'mine', label: 'My Loans', count: loans.filter((l) => ['pending', 'approved', 'active'].includes(l.status)).length },
    { key: 'simulator', label: 'Eligibility & Simulator' }, { key: 'apply', label: 'Apply' }, { key: 'statements', label: 'Statements' },
    ...(pending.length ? [{ key: 'approvals', label: 'Approvals', count: pending.length }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'mine';
  const limits = eligibility && { maxAmount: eligibility.maxAmount, maxTenure: eligibility.maxTenure, interestRate: eligibility.interestRate, maxEmi: eligibility.maxEmi, monthlyGross: eligibility.monthlyGross };

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">My Loans</h1>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Payroll-native</span></div>
          <p className="mt-1 text-sm text-muted">Know what you can borrow before asking — total clarity on cost, schedule &amp; payroll impact.</p>
        </div>
        <Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=simulator`}>🧮 Simulate a loan</Link>
      </header>
      <HubTabs base={base} label="Loan sections" tabs={tabs} current={tab} />
      {tab === 'mine' && (
        <Panel title="My Loans" flush>
          {loans.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No loans yet. Check what you can borrow on <Link className="text-primary hover:underline" href={`${base}?tab=simulator`}>Eligibility &amp; Simulator</Link>.</p> : (
            <ul className="divide-y divide-line" aria-label="My loans">
              {loans.map((l) => {
                const p = progress.get(l.id);
                return (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                    <div>
                      <p className="font-medium"><Link className="text-primary hover:underline" href={`${base}/${l.id}`}>{KIND_LABEL[l.kind]} · {inr.format(l.amount)}</Link></p>
                      <p className="text-xs text-muted">{[`EMI ${inr.format(l.emi)} × ${l.tenure_months}`, `${l.interest_rate}%`, l.purpose, `applied ${formatDate(l.created_at.slice(0, 10))}`].join(' · ')}</p>
                      {p && l.status === 'active' && <p className="mt-1 text-xs">{p.paid} of {p.total} paid · {inr.format(p.outstanding)} outstanding{p.next ? ` · next ${month(p.next.due_month)}` : ''}</p>}
                    </div>
                    <span className="flex items-center gap-2">
                      <Badge tone={LOAN_STATUS[l.status]?.tone}>{LOAN_STATUS[l.status]?.label ?? l.status}</Badge>
                      {l.status === 'pending' && <CancelLoanButton action={cancelLoanAction.bind(null, slug)} loanId={l.id} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
      {tab === 'simulator' && (
        !eligibility || !limits ? <Panel title="Eligibility"><p className="text-sm text-muted">Loans are for employees with a profile here.</p></Panel> : (
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Panel title="Your eligibility">
              <p className={`text-sm font-semibold ${eligibility.eligible ? 'text-success' : 'text-danger'}`}>{eligibility.eligible ? '✓ You can apply' : 'Not eligible right now'}</p>
              {!eligibility.eligible && <ul className="mt-2 list-disc pl-5 text-sm text-muted" aria-label="Reasons">{eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <dl className="mt-4 space-y-2 text-sm">
                {[['Borrow up to', inr.format(eligibility.maxAmount)], ['EMIs up to', `${inr.format(eligibility.maxEmi)} a month`], ['Longest tenure', `${eligibility.maxTenure} months`],
                  ['Interest', `${eligibility.interestRate}% a year (advances 0%)`], ['Monthly gross', inr.format(eligibility.monthlyGross)], ['Service', `${eligibility.serviceMonths} months`],
                  ['Current EMIs', inr.format(eligibility.currentEmi)]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
                ))}
              </dl>
            </Panel>
            <Panel title="Simulator"><Simulator limits={limits} applyHref={`${base}?tab=apply`} /></Panel>
          </div>
        )
      )}
      {tab === 'apply' && (
        !eligibility || !limits ? <Panel title="Apply"><p className="text-sm text-muted">Loans are for employees with a profile here.</p></Panel>
          : !eligibility.eligible ? <Panel title="Apply"><p className="text-sm text-danger">{eligibility.reasons[0]}</p></Panel> : (
            <Panel title="Apply for a loan or salary advance">
              <ApplyForm action={applyLoanAction.bind(null, slug)} limits={limits}
                defaults={{ kind: sp.kind === 'advance' ? 'advance' : 'loan', amount: /^\d+$/.test(sp.amount ?? '') ? sp.amount! : '', tenure: /^\d+$/.test(sp.tenure ?? '') ? sp.tenure! : '12' }} />
            </Panel>
          )
      )}
      {tab === 'statements' && <Statements base={base} loans={loans.filter((l) => l.status === 'active' || l.status === 'closed')} installments={installments} sp={sp} />}
      {tab === 'approvals' && (
        <Panel title={`Waiting for your decision · ${pending.length}`} flush>
          <ApprovalsPanel action={decideApprovalAction.bind(null, slug)} items={pending.map((a) => ({
            id: a.id, summary: a.summary, href: a.link ? `/app/${slug}${a.link}` : null, stepLabel: a.step_label,
            meta: `From ${a.requested_by_name} · ${formatDateTime(a.created_at, ctx.org.timezone)}`,
            onBehalfOf: a.via === 'delegation' ? (a.on_behalf_of_name ?? 'a colleague') : null, escalated: a.escalated,
          }))} />
        </Panel>
      )}
    </>
  );
}

function Statements({ base, loans, installments, sp }: { base: string; loans: LoanRow[]; installments: InstalmentRow[]; sp: Search }) {
  if (loans.length === 0) return <Panel title="Statements"><p className="text-sm text-muted">Statements appear once a loan is disbursed.</p></Panel>;
  const loan = loans.find((l) => l.id === sp.loan) ?? loans[0]!;
  const rows = installments.filter((i) => i.loan_id === loan.id);
  const paid = rows.filter((r) => r.status === 'paid');
  return (
    <Panel title="Statement" meta={`${KIND_LABEL[loan.kind]} · ${inr.format(loan.amount)}`} flush
      action={<a className="text-sm text-primary hover:underline" href={`${base}/${loan.id}/statement`} download>⬇ Download CSV</a>}>
      {loans.length > 1 && (
        <nav aria-label="Choose loan" className="flex flex-wrap gap-2 px-5 pb-3">
          {loans.map((l) => <Link key={l.id} href={`${base}?tab=statements&loan=${l.id}`} className={`rounded-lg border px-3 py-1 text-sm ${l.id === loan.id ? 'border-primary text-primary' : 'border-line'}`}>{KIND_LABEL[l.kind]} · {inr.format(l.amount)}</Link>)}
        </nav>
      )}
      <p className="px-5 pb-3 text-sm text-muted">Disbursed {loan.disbursed_on ? formatDate(loan.disbursed_on) : '—'} · repaid {inr.format(paid.reduce((s, r) => s + r.emi, 0))} in {paid.length} EMI{paid.length === 1 ? '' : 's'}{loan.closure_note ? ` · ${loan.closure_note}` : ''}</p>
      <ScheduleTable rows={rows} />
    </Panel>
  );
}

function AdminHub({ base, today, loans, installments, who }: { base: string; today: string; loans: LoanRow[]; installments: InstalmentRow[]; who: Map<string, { code: string; name: string }> }) {
  const active = loans.filter((l) => l.status === 'active');
  const outstanding = installments.filter((i) => i.status === 'scheduled' || i.status === 'queued').reduce((s, i) => s + i.principal, 0);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const dueNow = installments.filter((i) => i.due_month === thisMonth && i.status !== 'foreclosed');
  const toDisburse = loans.filter((l) => l.status === 'approved');
  const inApproval = loans.filter((l) => l.status === 'pending');
  const lent = loans.filter((l) => l.disbursed_on).reduce((s, l) => s + l.amount, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active loans" value={active.length} note={`${inr.format(lent)} lent in all`} tone="primary" href={`${base}?tab=tracker&status=active`} />
        <StatCard label="Outstanding" value={inr.format(outstanding)} note="principal still to recover" />
        <StatCard label={`EMIs · ${month(thisMonth)}`} value={inr.format(dueNow.reduce((s, i) => s + i.emi, 0))} note={`${dueNow.filter((i) => i.status === 'paid').length} of ${dueNow.length} recovered`} tone="success" />
        <StatCard label="To act on" value={toDisburse.length + inApproval.length} note={`${toDisburse.length} to disburse · ${inApproval.length} in approval`} tone={toDisburse.length ? 'warning' : 'muted'} href={`${base}?tab=tracker&status=approved`} />
      </div>
      <Panel title="Ready to disburse" flush>
        <ul className="divide-y divide-line" aria-label="Ready to disburse">
          {toDisburse.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing waiting. Approved loans appear here.</li>}
          {toDisburse.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span><span className="font-medium">{who.get(l.employee_id)?.name ?? 'Employee'}</span> · {KIND_LABEL[l.kind]} {inr.format(l.amount)} · EMI {inr.format(l.emi)} × {l.tenure_months}</span>
              <Link className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg" href={`${base}/${l.id}`}>Disburse</Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Tracker({ base, sp, loans, progress, who }: {
  base: string; sp: Search; loans: LoanRow[]; progress: ReturnType<typeof loanProgress>; who: Map<string, { code: string; name: string }>;
}) {
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = loans.filter((l) => (!sp.status || l.status === sp.status) && (!sp.kind || l.kind === sp.kind)
    && (!q || `${who.get(l.employee_id)?.name ?? ''} ${who.get(l.employee_id)?.code ?? ''} ${l.purpose}`.toLowerCase().includes(q)));
  const sel = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm';
  return (
    <Panel title="Loan Tracker" meta={`${rows.length}`} flush>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2 px-5 py-3" aria-label="Filter loans">
        <input type="hidden" name="tab" value="tracker" />
        <input name="q" type="search" defaultValue={sp.q} placeholder="Search name, ID, purpose…" aria-label="Search loans" className={`${sel} w-56`} />
        <select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className={sel}><option value="">All statuses</option>{Object.entries(LOAN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="kind" defaultValue={sp.kind ?? ''} aria-label="Type" className={sel}><option value="">All types</option><option value="loan">Personal loan</option><option value="advance">Salary advance</option></select>
        <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">⨁ Filter</button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Loans">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-2">Employee</th><th className={th}>Type</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>EMI</th><th className={th}>Paid</th><th className={`${th} text-right`}>Outstanding</th><th className={th}>Status</th><th className={th} /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-muted">No loans.</td></tr>}
            {rows.map((l) => {
              const p = progress.get(l.id);
              const w = who.get(l.employee_id);
              return (
                <tr key={l.id}>
                  <td className="px-5 py-2"><span className="font-medium">{w?.name ?? '—'}</span> <span className="text-xs text-muted">{w?.code}</span></td>
                  <td className="px-3">{KIND_LABEL[l.kind]}</td>
                  <td className="px-3 text-right tabular-nums">{inr.format(l.amount)}</td>
                  <td className="px-3 text-right tabular-nums">{inr.format(l.emi)} × {l.tenure_months}</td>
                  <td className="px-3 tabular-nums">{p ? `${p.paid}/${p.total}` : '—'}</td>
                  <td className="px-3 text-right tabular-nums">{p ? inr.format(p.outstanding) : '—'}</td>
                  <td className="px-3"><Badge tone={LOAN_STATUS[l.status]?.tone}>{LOAN_STATUS[l.status]?.label ?? l.status}</Badge></td>
                  <td className="px-3"><Link className="text-primary hover:underline" href={`${base}/${l.id}`} aria-label={`Open loan for ${w?.name ?? 'employee'}`}>Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
