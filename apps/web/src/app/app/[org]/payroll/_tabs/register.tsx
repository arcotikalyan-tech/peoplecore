import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { monthInputs, payouts, payrollPeople, readiness, runResults } from '@/server/payroll-suite';
import { approveRunAction, cancelRunAction, computeRunAction, lockRunAction } from '../actions';
import { RunAction } from '../payroll-forms';
import { lopImportAction } from '../suite-actions';
import { LopImportForm } from './forms';
import { inr, Pill, qs, type TabProps } from './shared';

const STATUTORY = new Set(['PF', 'ESI', 'PT', 'TDS', 'EPF_ER', 'EPS_ER', 'EDLI_ER', 'PFADM_ER', 'ESI_ER']);

/** The pay register: every employee's profile, statutory numbers, bank, attendance, earnings, deductions and status. */
export async function RegisterTab({ ctx, slug, base, month, run, prepares, approves, sp }: TabProps) {
  const m = month.slice(0, 7);
  const [people, ready, inputs, results, paid] = await Promise.all([
    payrollPeople(ctx.org.id, month), readiness(ctx.org.id), monthInputs(ctx.org.id, month),
    run && run.status !== 'draft' ? runResults(run.id) : Promise.resolve(new Map()),
    run?.status === 'locked' ? payouts(run.id) : Promise.resolve(new Map()),
  ]);
  const earnings: Array<[string, string]> = [...new Map<string, string>([...results.values()].flatMap((r) => r.lines.filter((l: { kind: string; code: string }) => l.kind === 'earning' && !STATUTORY.has(l.code))
    .map((l: { code: string; name: string }) => [l.code, l.name] as [string, string]))).entries()];
  const flags = (id: string, ctc: number | null) => {
    const r = ready.get(id);
    return [!ctc && 'No salary', !r?.pan && 'Missing PAN', !r?.bank && 'No bank', (!r?.uan || !r?.esic) && 'Incomplete Profile'].filter(Boolean) as string[];
  };
  const q = (sp.q ?? '').toLowerCase();
  const rows = people.filter((p) => {
    if (q && !`${p.name} ${p.code} ${p.department ?? ''}`.toLowerCase().includes(q)) return false;
    if (sp.dept && p.department !== sp.dept) return false;
    if (sp.flag === 'pan' && ready.get(p.id)?.pan) return false;
    if (sp.flag === 'bank' && ready.get(p.id)?.bank) return false;
    if (sp.flag === 'salary' && p.ctc) return false;
    if (sp.flag === 'attention' && !results.get(p.id)?.has_blocking) return false;
    return true;
  });
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))] as string[];
  const changed = people.some((p) => flags(p.id, p.ctc).length > 0);
  const amt = (id: string, code: string) => results.get(id)?.lines.filter((l: { code: string }) => l.code === code).reduce((s: number, l: { amount: number }) => s + l.amount, 0) ?? 0;
  const frozen = run?.status === 'approved' || run?.status === 'locked';
  const netSum = rows.reduce((s, p) => s + Number(results.get(p.id)?.net ?? 0), 0);

  return (
    <div className="space-y-4">
      {changed && <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">⚠ There are changes in Employee Data. Please check Filters.</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form action={base} className="flex flex-wrap items-end gap-2" aria-label="Filter employees">
          <input type="hidden" name="tab" value="register" /><input type="hidden" name="month" value={m} />
          <input name="q" defaultValue={sp.q} placeholder="Search name or ID" aria-label="Search" className="h-9 w-52 rounded-md border border-line-strong bg-surface px-3 text-sm" />
          <select name="dept" defaultValue={sp.dept ?? ''} aria-label="Department" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
            <option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select name="flag" defaultValue={sp.flag ?? ''} aria-label="Show" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
            <option value="">Everyone</option><option value="pan">Missing PAN</option><option value="bank">No bank details</option><option value="salary">No salary</option><option value="attention">Needs attention</option>
          </select>
          <button className={buttonClass('secondary', 'sm')}>⛃ Filter Employees</button>
        </form>
        <div className="flex flex-wrap items-end gap-2">
          {prepares && run && !frozen && <LopImportForm action={lopImportAction.bind(null, slug)} month={month} />}
          {run && run.status !== 'draft' && <a href={`/app/${slug}/payroll/register?month=${m}`} className={buttonClass('secondary', 'sm')} download>⬇ Export</a>}
        </div>
      </div>

      <div className="lift-soft scroll-thin overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[1800px] text-sm">
          <caption className="sr-only">Pay register for {m}</caption>
          <thead>
            <tr className="border-b border-line bg-subtle/50 text-[10px] font-semibold uppercase tracking-wider text-muted">
              <th colSpan={2} className="sticky left-0 bg-subtle px-3 py-1.5 text-left">Employee</th>
              <th colSpan={4} className="px-3 text-left">Profile</th><th colSpan={4} className="px-3 text-left">Statutory IDs</th>
              <th colSpan={4} className="px-3 text-left">Bank</th><th colSpan={2} className="px-3 text-left">Attendance</th>
              <th colSpan={earnings.length + 1} className="px-3 text-left">Earnings</th><th colSpan={5} className="px-3 text-left">Deductions</th>
              <th colSpan={2} className="sticky right-0 bg-subtle px-3 text-left">Payroll</th>
            </tr>
            <tr className="border-b border-line text-left text-[11px] text-muted">
              {['ID', 'Employee Name', 'Changes', 'Location', 'PT Location', 'Department', 'Designation', 'PAN', 'UAN', 'ESIC', 'Bank Name', 'IFSC', 'Account', 'Payment Mode', 'Working / Payable days', 'Payout Status',
                'Gross', ...earnings.map(([, n]) => n), 'Income Tax', 'PT', 'PF', 'ESI', 'LOP', 'Net Pay', 'Status'].map((h, i) => (
                <th key={`${h}${i}`} className={`whitespace-nowrap px-3 py-2 font-semibold ${i === 0 ? 'sticky left-0 bg-surface' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={30} className="px-3 py-8 text-center text-muted">No employees match.</td></tr>}
            {rows.map((p) => {
              const r = results.get(p.id);
              const rd = ready.get(p.id);
              const f = flags(p.id, p.ctc);
              const input = (r?.input ?? {}) as { statutory?: { ptState?: string | null }; daysInPeriod?: number; payableDays?: number };
              const po = paid.get(p.id);
              return (
                <tr key={p.id} className="hover:bg-subtle/40">
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 text-xs text-muted">{p.code}</td>
                  <td className="whitespace-nowrap px-3 font-medium">{p.name}</td>
                  <td className="whitespace-nowrap px-3">{f.length ? <><Pill tone="warning">{f[0]}</Pill>{f.length > 1 && <span className="ml-1 text-xs text-muted">+{f.length - 1}</span>}</> : <Pill tone="success">OK</Pill>}</td>
                  <td className="px-3 text-muted">{p.location ?? '—'}</td>
                  <td className="px-3 text-muted">{input.statutory?.ptState ?? '—'}</td>
                  <td className="px-3">{p.department ?? '—'}</td>
                  <td className="px-3">{p.designation ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{rd?.pan ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{rd?.uan ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{rd?.esic ?? '—'}</td>
                  <td className="whitespace-nowrap px-3">{rd?.bank ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{rd?.ifsc ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{rd?.last4 ? `••${rd.last4}` : '—'}</td>
                  <td className="whitespace-nowrap px-3">{rd?.bank ? 'Bank Transfer' : 'Cheque / cash'}</td>
                  <td className="px-3 tabular-nums">{r ? `${input.daysInPeriod}/${Number(r.payable_days)}` : '—'}</td>
                  <td className="px-3">{po ? <Pill tone={po.status === 'paid' ? 'success' : po.status === 'on_hold' ? 'muted' : 'warning'}>{po.status.replace('_', ' ')}</Pill> : inputs.get(p.id)?.on_hold ? <Pill>Hold</Pill> : 'Pay'}</td>
                  <td className="px-3 tabular-nums font-medium">{r ? inr.format(Number(r.gross)) : '—'}</td>
                  {earnings.map(([code]) => <td key={code} className="px-3 tabular-nums">{r ? inr.format(amt(p.id, code)) : '—'}</td>)}
                  <td className="px-3 tabular-nums">{r ? inr.format(amt(p.id, 'TDS')) : '—'}</td>
                  <td className="px-3 tabular-nums">{r ? inr.format(amt(p.id, 'PT')) : '—'}</td>
                  <td className="px-3 tabular-nums">{r ? inr.format(amt(p.id, 'PF')) : '—'}</td>
                  <td className="px-3 tabular-nums">{r ? inr.format(amt(p.id, 'ESI')) : '—'}</td>
                  <td className="px-3 tabular-nums">{r ? Number(r.lop_days) : '—'}</td>
                  <td className="sticky right-0 whitespace-nowrap bg-surface px-3 tabular-nums font-semibold">{r ? inr.format(Number(r.net)) : '—'}</td>
                  <td className="whitespace-nowrap px-3">
                    {r ? <Pill tone={r.has_blocking ? 'danger' : run?.status === 'locked' ? 'success' : 'warning'}>{r.has_blocking ? 'Attention' : run?.status === 'locked' ? 'Completed' : 'Pending'}</Pill> : <Pill>Not calculated</Pill>}
                    {r && run && <Link href={`/app/${slug}/payslips/${run.id}?employee=${p.id}`} className="ml-2 text-primary" aria-label={`Payslip of ${p.name}`}>👁</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">← scroll horizontally to see all columns · employee ID frozen left · net pay frozen right · showing {rows.length} of {people.length}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {prepares && run && (run.status === 'computed' || run.status === 'draft') && <RunAction action={cancelRunAction.bind(null, slug)} runId={run.id} submit="REVERT" variant="ghost" />}
          {prepares && run && (run.status === 'draft' || run.status === 'computed') && <RunAction action={computeRunAction.bind(null, slug)} runId={run.id} submit="CALCULATE" variant="secondary" />}
          {approves && run?.status === 'computed' && run.prepared_by !== ctx.user.id && <RunAction action={approveRunAction.bind(null, slug)} runId={run.id} submit="RUN PAYROLL (APPROVE)" />}
          {run && run.status !== 'draft' && <Link href={`/app/${slug}/payslips/${run.id}?employee=${rows.find((p) => results.has(p.id))?.id ?? ''}`} className={buttonClass('secondary', 'sm')}>PREVIEW PAYSLIPS</Link>}
          {run?.status === 'approved' && <RunAction action={lockRunAction.bind(null, slug)} runId={run.id} submit="GENERATE PAYSLIPS" />}
          {!run && <Link href={qs(base, { tab: 'run', month: m, step: 'precheck' })} className={buttonClass('primary', 'sm')}>Start this month’s payroll</Link>}
        </div>
        <p className="text-sm">Net pay of shown: <span className="font-semibold tabular-nums">{inr.format(netSum)}</span> ({rows.filter((p) => results.has(p.id)).length})</p>
      </div>
    </div>
  );
}
