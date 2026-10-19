import Link from 'next/link';
import { formatDate, formatDateTime } from '@/lib/format';
import { declarations, exportLog, fyOf, lockedLineTotals, monthEnd, payrollPeople, payrollSettings, readiness, recentRuns, revisions } from '@/server/payroll-suite';
import { monthLabel } from '../format';
import { Card, cycleState, Figure, lakhs, qs, STEPS, type TabProps } from './shared';

export async function HubTab({ ctx, base, month, run }: TabProps) {
  const m = month.slice(0, 7);
  const [people, ready, settings, runs, revs, decls, log] = await Promise.all([
    payrollPeople(ctx.org.id, month), readiness(ctx.org.id), payrollSettings(ctx.org.id), recentRuns(ctx.org.id, 6),
    revisions(ctx.org.id), declarations(ctx.org.id, fyOf(month)), exportLog(ctx.org.id),
  ]);
  const lines = run && run.status !== 'draft' ? await lockedLineTotals(ctx.org.id, [run.id]) : [];
  const sum = (code: string) => lines.filter((l) => l.code === code).reduce((s, l) => s + l.amount, 0);
  const state = cycleState(run);
  const end = monthEnd(month);
  const noSalary = people.filter((p) => !p.ctc);
  const missingPan = people.filter((p) => !ready.get(p.id)?.pan);
  const missingBank = people.filter((p) => !ready.get(p.id)?.bank);
  const pendingRevs = revs.filter((r) => r.status === 'pending');
  const pendingDecl = decls.filter((d) => d.status === 'submitted');
  const contracted = people.reduce((s, p) => s + (p.payBasis === 'monthly' ? p.monthlyGross : 0), 0);
  const gross = run && run.status !== 'draft' ? Number(run.total_gross) : contracted;
  const net = run && run.status !== 'draft' ? Number(run.total_net) : contracted;
  const deductions = run && run.status !== 'draft' ? Number(run.total_deductions) : 0;
  const payDay = settings?.pay_day ? `${String(settings.pay_day).padStart(2, '0')}${month.slice(4, 8)}` : end;
  const go = (tab: string, extra: Record<string, string> = {}) => qs(base, { tab, month: m, ...extra });

  const attention = [
    noSalary.length && { icon: '💰', text: `${noSalary.length} employee${noSalary.length === 1 ? '' : 's'} without a salary`, sub: 'They’re paid nothing until one is assigned', href: go('people', { view: 'salaries', filter: 'nosalary' }) },
    missingPan.length && { icon: '🪪', text: `${missingPan.length} employee${missingPan.length === 1 ? '' : 's'} with missing PAN`, sub: 'Required for TDS filing', href: go('register', { flag: 'pan' }) },
    missingBank.length && { icon: '🏦', text: `${missingBank.length} without bank details`, sub: 'Needed for the bank advice', href: go('settings', { view: 'payout' }) },
    pendingRevs.length && { icon: '↗', text: `${pendingRevs.length} salary revision${pendingRevs.length === 1 ? '' : 's'} waiting for sign-off`, sub: 'Another payroll approver must approve', href: go('people', { view: 'revisions' }) },
    pendingDecl.length && { icon: '📚', text: `${pendingDecl.length} tax declaration${pendingDecl.length === 1 ? '' : 's'} to review`, sub: `FY ${fyOf(month)}`, href: go('declarations') },
    run?.status === 'computed' && { icon: '✅', text: 'Calculated payroll is waiting for approval', sub: 'Someone other than the preparer approves', href: go('run', { step: 'approve' }) },
  ].filter(Boolean) as Array<{ icon: string; text: string; sub: string; href: string }>;

  const activity = [
    ...runs.flatMap((r) => [
      r.locked_at && { at: r.locked_at, text: `${monthLabel(r.period_month)} payroll locked and payslips released` },
      r.status === 'approved' && { at: r.locked_at ?? '', text: `${monthLabel(r.period_month)} payroll approved` },
    ]),
    ...revs.slice(0, 10).map((r) => ({ at: r.decided_at ?? r.requested_at, text: `Salary revision ${r.status === 'pending' ? 'proposed' : r.status}` })),
    ...log.slice(0, 10).map((l) => ({ at: l.at, text: `${l.actor} downloaded ${String(l.report).replace(/_/g, ' ')}` })),
  ].filter((a): a is { at: string; text: string } => Boolean(a && a.at)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  const quick = [
    { icon: '▶', label: 'Run Payroll', sub: `Stepped flow · ${monthLabel(month).slice(0, 3)} ${month.slice(0, 4)}`, href: go('run') },
    { icon: '＋', label: 'Add to Payroll', sub: noSalary.length ? `Onboard ${noSalary.length} pending` : 'Everyone has a salary', href: go('people', { view: 'salaries', filter: 'nosalary' }) },
    { icon: '↗', label: 'Salary Revision', sub: `${pendingRevs.length} pending sign-off`, href: go('people', { view: 'revisions' }) },
    { icon: '📄', label: 'Generate Payslips', sub: 'Lock · PDF · notify', href: go('run', { step: 'disburse' }) },
    { icon: '🎯', label: 'Bonus Run', sub: 'Bonus, incentives, adhoc', href: go('run', { step: 'inputs', input: 'variable' }) },
    { icon: '📥', label: 'LOP Import', sub: 'CSV · adjustments', href: go('run', { step: 'inputs', input: 'attendance' }) },
    { icon: '🏦', label: 'Bank Advice', sub: 'NEFT · HDFC · ICICI file', href: go('payout') },
    { icon: '⚙', label: 'Payroll Settings', sub: 'Structures · statutory', href: go('settings') },
  ];

  return (
    <div className="space-y-5">
      {attention.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary-soft/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-lg text-primary-fg">✦</span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Today · {monthLabel(month)}</p>
              <p className="text-sm font-medium">{attention.length} item{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} your attention before the payroll cut-off.</p>
            </div>
          </div>
          <a href="#attention" className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-primary">View Tasks</a>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="lift-soft rounded-2xl border border-line bg-surface p-6" aria-label="Current cycle">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Current cycle · {formatDate(month)} – {formatDate(end)}</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">{state.title}</h2>
                <p className="mt-2 text-sm text-muted">Step {state.step} of 5 · <span className="font-medium text-fg">{STEPS[state.step - 1]}</span> — {people.length} employees{attention.length ? ` · ${attention.length} needing attention` : ''}</p>
                <ol className="mt-5 grid grid-cols-5 gap-2" aria-label="Payroll steps">
                  {STEPS.map((s, i) => (
                    <li key={s} className="text-center">
                      <span className={`block h-1.5 rounded-full ${i + 1 < state.step || state.label === 'Completed' ? 'bg-success' : i + 1 === state.step ? 'bg-primary' : 'bg-line'}`} />
                      <span className={`mt-2 block text-xs ${i + 1 === state.step ? 'font-semibold text-primary' : 'text-muted'}`}>{s}</span>
                    </li>
                  ))}
                </ol>
                <Link href={go('run')} className="mt-5 inline-flex rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg">
                  {run ? (run.status === 'locked' ? 'View payouts →' : 'Continue Run →') : 'Start Run →'}
                </Link>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{run && run.status !== 'draft' ? 'Net payout' : 'Contracted payroll'}</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight text-primary">{lakhs(net)}</p>
                <p className="mt-2 text-sm text-muted">Gross {lakhs(gross)} · Deductions {lakhs(deductions)}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Employees" value={people.length} tone="success" note={`${noSalary.length} without salary`} />
            <Figure label="Gross pay" value={lakhs(gross)} />
            <Figure label="Net payout" value={lakhs(net)} tone="success" note={`paying ${formatDate(payDay)}`} />
            <Figure label="Tax · TDS" value={lakhs(sum('TDS'))} tone="warning" note={lines.length ? `PF ${lakhs(sum('PF'))} · ESI ${lakhs(sum('ESI'))}` : 'After calculation'} />
          </div>

          <Card title="Quick Actions">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quick.map((q) => (
                <li key={q.label}>
                  <Link href={q.href} className="lift flex h-full flex-col gap-2 rounded-xl border border-line bg-subtle/40 p-3">
                    <span aria-hidden="true" className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">{q.icon}</span>
                    <span className="text-sm font-semibold">{q.label}</span>
                    <span className="text-xs text-muted">{q.sub}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Needs Your Attention" action={attention.length > 0 && <span className="text-xs text-muted">{attention.length} open</span>}>
            <div id="attention" />
            {attention.length === 0 ? <p className="text-sm text-muted">Nothing needs attention. 🎉</p> : (
              <ul className="space-y-2">
                {attention.map((a) => (
                  <li key={a.text}>
                    <Link href={a.href} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:border-line-strong">
                      <span aria-hidden="true" className="text-lg">{a.icon}</span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{a.text}</span><span className="block text-xs text-muted">{a.sub}</span></span>
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">Action needed</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent Activity">
            {activity.length === 0 ? <p className="text-sm text-muted">No payroll activity recorded yet.</p> : (
              <ol className="space-y-3">
                {activity.map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    <span><span className="block">{a.text}</span><span className="text-xs text-muted">{formatDateTime(a.at, ctx.org.timezone)}</span></span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Last 6 cycles">
            {runs.length === 0 ? <p className="text-sm text-muted">No payroll runs yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2">
                    <Link href={qs(base, { tab: 'run', month: r.period_month.slice(0, 7) })} className="font-medium hover:text-primary">{monthLabel(r.period_month)}</Link>
                    <span className="text-xs capitalize text-muted">{r.status}</span>
                    <span className="tabular-nums">{lakhs(Number(r.total_net))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
