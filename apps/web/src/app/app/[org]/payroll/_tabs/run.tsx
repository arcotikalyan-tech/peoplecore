import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { fetchInputs } from '@/server/payroll';
import { createClient } from '@/server/supabase';
import { approvedClaimsTotal, approvedEncashments, monthEnd, monthInputs, payrollPeople, pendingAdjustments, readiness, revisions, runResults } from '@/server/payroll-suite';
import { addAdjustmentAction, approveRunAction, cancelRunAction, computeRunAction, lockRunAction, removeAdjustmentAction } from '../actions';
import { ActionForm } from '@/components/action-form';
import { inr, monthLabel } from '../format';
import { AdjustmentForm, RunAction } from '../payroll-forms';
import { decideRevisionAction, holdAction, lopImportAction, saveInputAction, startCycleAction } from '../suite-actions';
import { DecisionForm, HoldForm, InlineNumber, LopImportForm, StartCycleForm } from './forms';
import { Card, cycleState, Figure, lakhs, Pill, qs, type TabProps } from './shared';

const STEP_KEYS = ['precheck', 'inputs', 'calculate', 'approve', 'disburse'] as const;
const STEP_LABELS = { precheck: ['Pre-checks', 'Salaries · PAN · bank'], inputs: ['Inputs & Variables', 'LOP · adhoc · tax'], calculate: ['Calculate', 'Payslips computed'], approve: ['Approve', 'Maker ≠ checker'], disburse: ['Disburse & Payslips', 'Bank advice · payslips'] };
const INPUTS = [
  { key: 'overview', label: 'Overview' }, { key: 'attendance', label: 'Attendance & Leave' }, { key: 'variable', label: 'Variable & Adhoc' },
  { key: 'revisions', label: 'Salary Revisions' }, { key: 'arrears', label: 'Arrears' }, { key: 'tax', label: 'Tax Override' },
  { key: 'hold', label: 'Salary on Hold' }, { key: 'wage', label: 'Wage based inputs' },
];

type Ex = { code: string; message: string; blocking: boolean };

export async function RunTab({ ctx, slug, base, month, run, prepares, approves, sp }: TabProps) {
  const m = month.slice(0, 7);
  const state = cycleState(run);
  const step = (STEP_KEYS as readonly string[]).includes(sp.step ?? '') ? sp.step! : STEP_KEYS[state.step - 1]!;
  const input = INPUTS.some((i) => i.key === sp.input) ? sp.input! : 'overview';
  const frozen = run?.status === 'approved' || run?.status === 'locked';
  const editable = prepares && !frozen;

  const [people, ready, inputs, adjustments, revs, encash, claims, results] = await Promise.all([
    payrollPeople(ctx.org.id, month), readiness(ctx.org.id), monthInputs(ctx.org.id, month), pendingAdjustments(ctx.org.id),
    revisions(ctx.org.id), approvedEncashments(ctx.org.id), approvedClaimsTotal(ctx.org.id),
    run && run.status !== 'draft' ? runResults(run.id) : Promise.resolve(new Map()),
  ]);
  // What the engine will see for each employee (live for an open run, as stored once frozen).
  let engine = new Map<string, { payableDays: number; daysInPeriod: number; penaltyDays?: number; units?: number | null; payBasis?: string; declaration?: { regime?: string } | null }>();
  if (run && !frozen && (step === 'inputs' || step === 'calculate')) {
    try {
      const { inputs: ri } = await fetchInputs(run.id);
      engine = new Map(ri.employees.map((e) => [e.employeeId, e as never]));
    } catch { /* shown as not computed */ }
  } else if (results.size) {
    engine = new Map([...results.entries()].map(([id, r]) => [id, r.input as never]));
  }
  const name = new Map(people.map((p) => [p.id, p]));
  const ruleSet = run ? (await (await createClient()).from('statutory_rule_sets').select('code, validated').eq('id', run.rule_set_id).maybeSingle()).data : null;
  const stepHref = (s: string, extra: Record<string, string> = {}) => qs(base, { tab: 'run', month: m, step: s, ...extra });
  const total = (code: string) => [...results.values()].reduce((s, r) => s + r.lines.filter((l: { code: string }) => l.code === code).reduce((a: number, l: { amount: number }) => a + l.amount, 0), 0);
  const calculated = results.size;

  const missingSalary = people.filter((p) => !p.ctc);
  const missingPan = people.filter((p) => !ready.get(p.id)?.pan);
  const missingBank = people.filter((p) => !ready.get(p.id)?.bank);
  const pendingRevs = revs.filter((r) => r.status === 'pending' && r.effective_from <= monthEnd(month));
  const blocking = [...results.values()].filter((r) => r.has_blocking);

  return (
    <div className="space-y-5">
      <nav aria-label="Payroll steps" className="lift-soft rounded-2xl border border-line bg-surface px-5 py-4">
        <ol className="flex flex-wrap items-center gap-3">
          {STEP_KEYS.map((k, i) => {
            const done = i + 1 < state.step || state.label === 'Completed';
            const here = k === step;
            return (
              <li key={k} className="flex items-center gap-3">
                {i > 0 && <span aria-hidden="true" className={`h-0.5 w-6 ${done ? 'bg-success' : 'bg-line'}`} />}
                <Link href={stepHref(k)} aria-current={here ? 'step' : undefined} className="flex items-center gap-2.5">
                  <span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${done ? 'bg-success-soft text-success' : here ? 'bg-primary text-primary-fg' : 'bg-subtle text-muted'}`}>{done ? '✓' : i + 1}</span>
                  <span><span className={`block text-sm font-semibold ${here ? 'text-primary' : ''}`}>{STEP_LABELS[k][0]}</span><span className="block text-[11px] text-muted">{STEP_LABELS[k][1]}</span></span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 'precheck' && (
        <Card title="Step 1 · Pre-checks" action={<span className="text-xs text-muted">{monthLabel(month)} · {people.length} employees</span>}>
          <ul className="divide-y divide-line">
            {[
              { ok: missingSalary.length === 0, text: 'Every employee has a salary', detail: missingSalary.length ? `${missingSalary.length} without: ${missingSalary.slice(0, 4).map((p) => p.name).join(', ')}${missingSalary.length > 4 ? '…' : ''}` : 'All set', href: qs(base, { tab: 'people', month: m, view: 'salaries', filter: 'nosalary' }), blocking: false },
              { ok: missingPan.length === 0, text: 'PAN on file (needed for TDS returns)', detail: missingPan.length ? `${missingPan.length} missing` : 'All set', href: qs(base, { tab: 'register', month: m, flag: 'pan' }), blocking: false },
              { ok: missingBank.length === 0, text: 'Bank details for salary transfer', detail: missingBank.length ? `${missingBank.length} missing — they’ll be paid outside the bank advice` : 'All set', href: qs(base, { tab: 'settings', month: m, view: 'payout' }), blocking: false },
              { ok: pendingRevs.length === 0, text: 'No salary revisions waiting for sign-off', detail: pendingRevs.length ? `${pendingRevs.length} pending — approve them first so this month pays the new salary` : 'All set', href: qs(base, { tab: 'people', month: m, view: 'revisions' }), blocking: false },
              { ok: true, text: 'Attendance synced', detail: 'Each day is recomputed from punches, leave and holidays when inputs are fetched', href: `/app/${slug}/attendance?tab=logs&view=monthly&month=${m}`, blocking: false },
              { ok: true, text: `Reimbursements and leave encashment`, detail: `${claims.length} approved expense claim${claims.length === 1 ? '' : 's'} (${inr.format(claims.reduce((s, c) => s + Number(c.total), 0))}) and ${encash.length} encashment${encash.length === 1 ? '' : 's'} will be paid this run`, href: `/app/${slug}/expenses`, blocking: false },
            ].map((c) => (
              <li key={c.text} className="flex items-center gap-3 py-3">
                <span aria-hidden="true" className={`grid size-6 place-items-center rounded-full text-xs font-bold ${c.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{c.ok ? '✓' : '!'}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{c.text}</span><span className="block text-xs text-muted">{c.detail}</span></span>
                <Link href={c.href} className="text-xs font-medium text-primary hover:underline">Open →</Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            {!run && prepares && <StartCycleForm action={startCycleAction.bind(null, slug)} month={month} label={`Start payroll for ${monthLabel(month)}`} />}
            {!run && !prepares && <p className="text-sm text-muted">Someone with payroll preparation access starts the cycle.</p>}
            {run && <Link href={stepHref('inputs')} className={buttonClass('primary', 'sm')}>Next: Inputs & Variables →</Link>}
          </div>
        </Card>
      )}

      {step === 'inputs' && (
        !run ? <NoRun base={base} m={m} /> : (
          <Card title="Step 2 · Inputs & Variables" action={<span className="text-xs text-muted">{monthLabel(month)} · {people.length} employees{frozen ? ' · frozen (approved)' : ''}</span>}>
            <nav aria-label="Inputs" className="mb-5 rounded-xl border border-line bg-subtle/40 p-1.5">
              <ul className="flex flex-wrap gap-1">
                {INPUTS.map((t) => (
                  <li key={t.key}>
                    <Link href={stepHref('inputs', { input: t.key })} aria-current={t.key === input ? 'page' : undefined}
                      className={`block rounded-lg px-3 py-1.5 text-sm ${t.key === input ? 'bg-surface font-semibold shadow-sm' : 'text-muted hover:text-fg'}`}>{t.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>

            {input === 'overview' && (
              <>
                <div className="grid gap-3 sm:grid-cols-5">
                  <Figure label="Total employees" value={people.length} />
                  <Figure label="Calculated" value={calculated} tone="success" />
                  <Figure label="Pending" value={Math.max(0, people.length - calculated)} tone="warning" />
                  <Figure label="Gross pay" value={lakhs(Number(run.total_gross))} tone="primary" />
                  <Figure label="Net pay" value={lakhs(Number(run.total_net))} tone="success" />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Figure label="Income tax" value={inr.format(total('TDS'))} tone="warning" />
                  <Figure label="PF" value={inr.format(total('PF'))} />
                  <Figure label="ESI" value={inr.format(total('ESI'))} />
                  <Figure label="PT" value={inr.format(total('PT'))} />
                </div>
                <div className="mt-4 flex justify-end"><Link href={stepHref('inputs', { input: 'attendance' })} className={buttonClass('primary', 'sm')}>Next: Attendance & Leave →</Link></div>
              </>
            )}

            {input === 'attendance' && (
              <>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <p className="text-sm text-muted">Loss of pay comes from unpaid leave{run.lop_from_absence ? ', absences' : ''} and attendance penalties. Override it for anyone; an override replaces the computed LOP.</p>
                  {editable && <LopImportForm action={lopImportAction.bind(null, slug)} month={month} />}
                </div>
                <Grid head={['Employee', 'Days', 'Penalty days', 'Payable days', 'LOP', 'LOP override']}>
                  {people.map((p) => {
                    const e = engine.get(p.id);
                    const lop = e ? e.daysInPeriod - e.payableDays : null;
                    return (
                      <tr key={p.id}>
                        <Who p={p} />
                        <td className="tabular-nums">{e?.daysInPeriod ?? '—'}</td>
                        <td className="tabular-nums">{e?.penaltyDays ?? 0}</td>
                        <td className="tabular-nums font-medium">{e?.payableDays ?? '—'}</td>
                        <td className="tabular-nums">{lop ?? '—'}</td>
                        <td><InlineNumber action={saveInputAction.bind(null, slug)} employeeId={p.id} month={month} field="lop_days" value={inputs.get(p.id)?.lop_days ?? null} label={`LOP override for ${p.name}`} placeholder="auto" disabled={!editable} /></td>
                      </tr>
                    );
                  })}
                </Grid>
              </>
            )}

            {input === 'variable' && (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Bonus, incentives and one-off deductions</h3>
                  <p className="mb-3 text-xs text-muted">Paid (or recovered) in full in the next run that’s calculated, never prorated.</p>
                  {editable ? <AdjustmentForm action={addAdjustmentAction.bind(null, slug)} employees={people.map((p) => ({ value: p.id, label: `${p.name} · ${p.code}` }))} />
                    : <p className="text-sm text-muted">This month is approved; new items go into the next run.</p>}
                </div>
                <AdjustmentList slug={slug} items={adjustments.filter((a) => !a.applied_run_id && a.code !== 'ARREAR')} names={name} editable={editable} />
              </div>
            )}

            {input === 'revisions' && (
              <Grid head={['Employee', 'Effective', 'Current CTC', 'New CTC', 'Change', 'Status', '']}>
                {revs.filter((r) => r.status === 'pending' || r.effective_from <= monthEnd(month)).slice(0, 50).map((r) => {
                  const p = name.get(r.employee_id);
                  const prev = Number(r.previous_annual_ctc ?? 0);
                  const next = Number(r.annual_ctc);
                  return (
                    <tr key={r.id}>
                      <td className="py-2 font-medium">{p?.name ?? '—'}</td>
                      <td>{formatDate(r.effective_from)}</td>
                      <td className="tabular-nums">{inr.format(prev)}</td>
                      <td className="tabular-nums">{inr.format(next)}</td>
                      <td className="tabular-nums">{prev ? `${(((next - prev) / prev) * 100).toFixed(1)}%` : '—'}</td>
                      <td><Pill tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'muted'}>{r.status}</Pill></td>
                      <td>{r.status === 'pending' && <DecisionForm action={decideRevisionAction.bind(null, slug)} hidden={{ revisionId: r.id }} canDecide={approves && r.requested_by !== ctx.user.id} canWithdraw={r.requested_by === ctx.user.id} />}</td>
                    </tr>
                  );
                })}
              </Grid>
            )}

            {input === 'arrears' && (
              <div className="space-y-3">
                <p className="text-sm text-muted">Arrears come from approved revisions that start in months already paid, or are added by hand under Variable & Adhoc (type “Arrears”).</p>
                <AdjustmentList slug={slug} items={adjustments.filter((a) => a.code === 'ARREAR' && !a.applied_run_id)} names={name} editable={editable} empty="No arrears to pay." />
              </div>
            )}

            {input === 'tax' && (
              <Grid head={['Employee', 'Regime', 'Computed TDS', 'Override (₹ this month)']}>
                {people.map((p) => {
                  const r = results.get(p.id);
                  const tds = r?.lines.find((l: { code: string }) => l.code === 'TDS')?.amount ?? 0;
                  const e = engine.get(p.id);
                  return (
                    <tr key={p.id}>
                      <Who p={p} />
                      <td className="capitalize">{e?.declaration?.regime ?? 'new'}</td>
                      <td className="tabular-nums">{r ? inr.format(tds) : '—'}</td>
                      <td><InlineNumber action={saveInputAction.bind(null, slug)} employeeId={p.id} month={month} field="tds_override" value={inputs.get(p.id)?.tds_override ?? null} label={`TDS override for ${p.name}`} placeholder="auto" disabled={!editable} /></td>
                    </tr>
                  );
                })}
              </Grid>
            )}

            {input === 'hold' && (
              <Grid head={['Employee', 'Net (last calculated)', 'Hold']}>
                {people.map((p) => {
                  const i = inputs.get(p.id);
                  return (
                    <tr key={p.id}>
                      <Who p={p} />
                      <td className="tabular-nums">{results.get(p.id) ? inr.format(Number(results.get(p.id).net)) : '—'}</td>
                      <td><HoldForm action={holdAction.bind(null, slug)} employeeId={p.id} month={month} onHold={i?.on_hold ?? false} reason={i?.hold_reason ?? null} disabled={!editable} /></td>
                    </tr>
                  );
                })}
              </Grid>
            )}

            {input === 'wage' && (
              people.filter((p) => p.payBasis !== 'monthly').length === 0
                ? <p className="text-sm text-muted">No one is on a daily or hourly wage. Assign a wage structure under People & Salaries.</p>
                : (
                  <Grid head={['Employee', 'Basis', 'Rate', 'From attendance', 'Days / hours to pay']}>
                    {people.filter((p) => p.payBasis !== 'monthly').map((p) => {
                      const e = engine.get(p.id);
                      return (
                        <tr key={p.id}>
                          <Who p={p} />
                          <td className="capitalize">{p.payBasis}</td>
                          <td className="tabular-nums">{inr.format(p.monthlyGross)} / {p.payBasis === 'daily' ? 'day' : 'hour'}</td>
                          <td className="tabular-nums">{e?.units ?? '—'}</td>
                          <td><InlineNumber action={saveInputAction.bind(null, slug)} employeeId={p.id} month={month} field="units" value={inputs.get(p.id)?.units ?? null} label={`Units for ${p.name}`} placeholder="auto" disabled={!editable} /></td>
                        </tr>
                      );
                    })}
                  </Grid>
                )
            )}
            <div className="mt-5 flex justify-end"><Link href={stepHref('calculate')} className={buttonClass('primary', 'sm')}>Next: Calculate →</Link></div>
          </Card>
        )
      )}

      {step === 'calculate' && (
        !run ? <NoRun base={base} m={m} /> : (
          <Card title="Step 3 · Calculate" action={<span className="text-xs text-muted">{monthLabel(month)} · {people.length} employees</span>}>
            <div className="grid gap-3 sm:grid-cols-5">
              <Figure label="Total employees" value={people.length} />
              <Figure label="Calculated" value={calculated} tone="success" />
              <Figure label="Needs attention" value={blocking.length} tone={blocking.length ? 'danger' : 'success'} />
              <Figure label="Gross pay" value={lakhs(Number(run.total_gross))} tone="primary" />
              <Figure label="Net pay" value={lakhs(Number(run.total_net))} tone="success" />
            </div>
            {ruleSet && !ruleSet.validated && (
              <div className="mt-4"><Alert tone="warning" title={`Statutory rules ${ruleSet.code} are not professionally validated`}>
                PF, ESI, professional tax and TDS are computed from rules that a qualified professional has not signed off. Check the figures before paying real salaries.
              </Alert></div>
            )}
            {blocking.length > 0 && (
              <div className="mt-4"><Alert tone="danger" title={`${blocking.length} payslip${blocking.length === 1 ? '' : 's'} can’t be approved yet`}>
                <ul className="list-disc pl-5">{blocking.slice(0, 8).map((r) => <li key={r.employee_id}>{name.get(r.employee_id)?.name ?? 'Employee'}: {(r.exceptions as Ex[]).filter((x) => x.blocking).map((x) => x.message).join(' ')}</li>)}</ul>
              </Alert></div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {editable && <RunAction action={computeRunAction.bind(null, slug)} runId={run.id} submit={run.status === 'draft' ? 'Calculate payroll' : 'Recalculate'} variant={run.status === 'draft' ? 'primary' : 'secondary'} />}
              {calculated > 0 && <Link href={qs(base, { tab: 'register', month: m })} className={buttonClass('secondary', 'sm')}>Open the pay register</Link>}
              {calculated > 0 && <Link href={`/app/${slug}/payroll/${run.id}`} className={buttonClass('ghost', 'sm')}>Changes since last month</Link>}
              {run.status === 'computed' && <Link href={stepHref('approve')} className={buttonClass('primary', 'sm')}>Next: Approve →</Link>}
            </div>
          </Card>
        )
      )}

      {step === 'approve' && (
        !run ? <NoRun base={base} m={m} /> : (
          <Card title="Step 4 · Approve">
            {run.status === 'draft' && <p className="text-sm text-muted">Calculate the payroll first.</p>}
            {run.status === 'computed' && (
              <div className="space-y-3 text-sm">
                <p>Gross {inr.format(Number(run.total_gross))} · deductions {inr.format(Number(run.total_deductions))} · net {inr.format(Number(run.total_net))} for {run.employee_count} employees.</p>
                {run.prepared_by === ctx.user.id
                  ? <Alert tone="info" title="Waiting for a second person">You calculated this run, so someone else with payroll approval must approve it.</Alert>
                  : approves ? (
                    <>
                      <p className="text-muted">Approving re-fetches today’s inputs and only succeeds if they still match what was calculated.</p>
                      <RunAction action={approveRunAction.bind(null, slug)} runId={run.id} submit="Verify and approve" />
                    </>
                  ) : <p className="text-muted">Someone with payroll approval access approves the run.</p>}
              </div>
            )}
            {frozen && <p className="text-sm text-success">Approved{run.approved_at ? ` on ${formatDate(run.approved_at.slice(0, 10))}` : ''}.</p>}
            {editable && run.status !== 'draft' && <div className="mt-4 border-t border-line pt-4"><RunAction action={cancelRunAction.bind(null, slug)} runId={run.id} submit="Revert (cancel this run)" variant="ghost" /></div>}
          </Card>
        )
      )}

      {step === 'disburse' && (
        !run ? <NoRun base={base} m={m} /> : (
          <Card title="Step 5 · Disburse & Payslips">
            {run.status === 'approved' && (
              <div className="space-y-3 text-sm">
                <p>Locking releases payslips to employees, marks reimbursements, adjustments and encashments as paid, and opens the payouts. It can’t be undone; corrections go into next month.</p>
                <RunAction action={lockRunAction.bind(null, slug)} runId={run.id} submit="Lock & generate payslips" />
              </div>
            )}
            {run.status === 'locked' && (
              <div className="flex flex-wrap gap-2">
                <Link href={qs(base, { tab: 'payout', month: m })} className={buttonClass('primary', 'sm')}>Payouts & bank advice</Link>
                <Link href={qs(base, { tab: 'register', month: m })} className={buttonClass('secondary', 'sm')}>Payslips (pay register)</Link>
                <a href={`/app/${slug}/payroll/${run.id}/journal`} className={buttonClass('secondary', 'sm')} download>⬇ Journal voucher</a>
                <Link href={qs(base, { tab: 'compliance', month: m })} className={buttonClass('secondary', 'sm')}>Statutory files</Link>
              </div>
            )}
            {(run.status === 'draft' || run.status === 'computed') && <p className="text-sm text-muted">Approve the run first.</p>}
          </Card>
        )
      )}
    </div>
  );
}

function NoRun({ base, m }: { base: string; m: string }) {
  return (
    <Card>
      <p className="text-sm text-muted">This month’s payroll hasn’t been started. <Link className="font-medium text-primary hover:underline" href={qs(base, { tab: 'run', month: m, step: 'precheck' })}>Start it from the pre-checks →</Link></p>
    </Card>
  );
}

function Grid({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">{head.map((h, i) => <th key={i} className="py-2 pr-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

function Who({ p }: { p: { name: string; code: string; department: string | null } }) {
  return <td className="py-2 pr-3"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.code}{p.department ? ` · ${p.department}` : ''}</span></td>;
}

function AdjustmentList({ slug, items, names, editable, empty = 'Nothing added for this run.' }: {
  slug: string; editable: boolean; empty?: string; names: Map<string, { name: string }>;
  items: Array<{ id: string; employee_id: string; name: string; kind: string; amount: number | string; reason: string }>;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line rounded-xl border border-line text-sm" aria-label="Adjustments">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <span><span className="font-medium">{names.get(a.employee_id)?.name ?? 'Employee'}</span> · {a.name}<span className="block text-xs text-muted">{a.reason}</span></span>
          <span className={`tabular-nums font-medium ${a.kind === 'deduction' ? 'text-danger' : 'text-success'}`}>{a.kind === 'deduction' ? '−' : '+'}{inr.format(Number(a.amount))}</span>
          {editable && <ActionForm action={removeAdjustmentAction.bind(null, slug)} label={`Remove ${a.name}`} submit="Remove" hidden={{ adjustmentId: a.id }} variant="ghost" size="sm" className="inline-flex" />}
        </li>
      ))}
    </ul>
  );
}

