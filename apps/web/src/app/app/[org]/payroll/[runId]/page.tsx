import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Alert, Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { buttonClass } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { namesFor } from '@/server/leave';
import { aiAvailable } from '@/server/ai';
import { getRun, runVariance } from '@/server/payroll';
import { approveRunAction, cancelRunAction, computeRunAction, lockRunAction, summariseVarianceAction } from '../actions';
import { inr, monthLabel, STATUS_TONE } from '../format';
import { RunAction } from '../payroll-forms';
import { VarianceSummaryButton } from './variance-summary';

export const metadata: Metadata = { title: 'Payroll run' };

export default async function RunPage({ params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org: slug, runId } = await params;
  if (!z.uuid().safeParse(runId).success) notFound();
  const ctx = await getOrgContext(slug);
  const prepares = ctx.can('payroll.prepare', 'org');
  const approves = ctx.can('payroll.approve', 'org');
  if (!prepares && !approves) notFound();
  const data = await getRun(ctx.org.id, runId);
  if (!data) notFound();
  const { run, employees, ruleSet } = data;
  const computed = employees.length > 0 && run.status !== 'cancelled';
  const [names, variance, ai] = await Promise.all([
    namesFor(ctx.org.id, employees.map((e) => e.employee_id)),
    computed ? runVariance(ctx.org.id, run) : Promise.resolve(null),
    computed ? aiAvailable(ctx) : Promise.resolve(false),
  ]);
  const blocking = employees.filter((e) => e.has_blocking).length;
  const preparedByMe = run.prepared_by === ctx.user.id;
  const tz = ctx.org.timezone;
  const sorted = [...employees].sort((a, b) => Number(b.has_blocking) - Number(a.has_blocking) || (names.get(a.employee_id) ?? '').localeCompare(names.get(b.employee_id) ?? ''));

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/payroll`} className="hover:text-fg">← Payroll</Link>}
        title={`Payroll · ${monthLabel(run.period_month)}`} actions={<Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>} />
      {!ruleSet.validated && (
        <div className="mb-6">
          <Alert tone="warning" title={`Statutory rules ${ruleSet.code} are not professionally validated`}>
            PF, ESI, professional tax and TDS are computed from rules that a qualified professional has not signed off. Check the figures before paying real salaries.
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Employees" description={blocking ? `${blocking} with blocking exceptions` : `${employees.length} payslips`} />
          {employees.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Not computed yet.</p> : (
            <Table caption="Payroll results">
              <thead><tr><Th>Employee</Th><Th>Payable days</Th><Th>Gross</Th><Th>Deductions</Th><Th>Net</Th><Th>Notes</Th></tr></thead>
              <tbody>
                {sorted.map((e) => {
                  const ex = (e.exceptions as Array<{ code: string; message: string; blocking: boolean }>) ?? [];
                  return (
                    <tr key={e.employee_id}>
                      <Td className="font-medium"><Link className="hover:underline" href={`/app/${slug}/payslips/${runId}?employee=${e.employee_id}`}>{names.get(e.employee_id) ?? '—'}</Link></Td>
                      <Td className="tabular-nums">{Number(e.payable_days)}</Td>
                      <Td className="tabular-nums">{inr.format(Number(e.gross))}</Td>
                      <Td className="tabular-nums">{inr.format(Number(e.deductions))}</Td>
                      <Td className="tabular-nums font-medium">{inr.format(Number(e.net))}</Td>
                      <Td className="text-xs">{ex.map((x) => <span key={x.code} className={`block ${x.blocking ? 'font-medium text-danger' : 'text-muted'}`}>{x.message}</span>)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Totals" />
            <DetailList items={[
              { label: 'Gross', value: inr.format(Number(run.total_gross)) },
              { label: 'Deductions', value: inr.format(Number(run.total_deductions)) },
              { label: 'Net pay', value: inr.format(Number(run.total_net)) },
              { label: 'Employer cost', value: inr.format(Number(run.total_employer_cost)) },
              { label: 'Computed', value: run.computed_at ? formatDateTime(run.computed_at, tz) : null },
              { label: 'Approved', value: run.approved_at ? formatDateTime(run.approved_at, tz) : null },
              { label: 'Locked', value: run.locked_at ? formatDateTime(run.locked_at, tz) : null },
              { label: 'Loss of pay', value: run.lop_from_absence ? 'Unpaid leave and absences' : 'Unpaid leave only' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Next step" />
            <div className="space-y-3 px-5 py-4 text-sm">
              {prepares && (run.status === 'draft' || run.status === 'computed') && (
                <RunAction action={computeRunAction.bind(null, slug)} runId={runId} submit={run.status === 'draft' ? 'Compute payslips' : 'Recompute'} variant={run.status === 'draft' ? 'primary' : 'secondary'} />
              )}
              {run.status === 'computed' && approves && !preparedByMe && (
                <>
                  <p className="text-muted">Approving recomputes the run from today’s inputs and only succeeds if they match what was computed.</p>
                  <RunAction action={approveRunAction.bind(null, slug)} runId={runId} submit="Verify and approve" />
                </>
              )}
              {run.status === 'computed' && preparedByMe && <p className="text-muted">You prepared this run, so someone else with payroll approval must approve it.</p>}
              {run.status === 'approved' && <RunAction action={lockRunAction.bind(null, slug)} runId={runId} submit="Lock and release payslips" />}
              {run.status === 'locked' && approves && ctx.can('employee.bank.read', 'org') && (
                <a className={buttonClass('secondary')} href={`/app/${slug}/payroll/${runId}/bank-file`} download>Download bank file</a>
              )}
              {run.status === 'locked' && (
                <a className={buttonClass('secondary')} href={`/app/${slug}/payroll/${runId}/journal`} download>Download journal (CSV)</a>
              )}
              {run.status !== 'locked' && run.status !== 'cancelled' && (
                <RunAction action={cancelRunAction.bind(null, slug)} runId={runId} submit="Cancel run" variant="ghost" />
              )}
            </div>
          </Card>
        </div>
      </div>
      {computed && (
        <Card className="mt-6">
          <CardHeader title={variance ? `Changes since ${monthLabel(variance.previous.period_month)}` : 'Changes since the last run'}
            description={variance
              ? `Net pay ${inr.format(variance.report.totals.currentNet)} against ${inr.format(variance.report.totals.previousNet)}${variance.report.totals.changePct === null ? '' : ` (${variance.report.totals.changePct > 0 ? '+' : ''}${variance.report.totals.changePct}%)`}. ${variance.report.steady} steady; changes of ₹1,000 and 5% or more are listed.`
              : 'There is no earlier locked run to compare with.'} />
          {variance && (
            <>
              <Table caption="Changes since the last run">
                <thead><tr><Th>Employee</Th><Th>Last run</Th><Th>This run</Th><Th>Change</Th><Th>Why</Th></tr></thead>
                <tbody>
                  {variance.report.variances.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No material changes.</td></tr>}
                  {variance.report.variances.map((v) => (
                    <tr key={v.employeeId}>
                      <Td className="font-medium">{names.get(v.employeeId) ?? variance.code(v.employeeId)}</Td>
                      <Td className="tabular-nums">{v.previousNet === null ? '—' : inr.format(v.previousNet)}</Td>
                      <Td className="tabular-nums">{v.currentNet === null ? '—' : inr.format(v.currentNet)}</Td>
                      <Td className="tabular-nums">{v.change === null ? (v.kind === 'joined' ? 'Joined' : 'Left') : `${v.change > 0 ? '+' : ''}${inr.format(v.change)} (${v.changePct}%)`}</Td>
                      <Td className="text-xs text-muted">{v.reasons.join('; ')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {ai && variance.report.variances.length > 0 && <VarianceSummaryButton action={summariseVarianceAction.bind(null, slug)} runId={runId} />}
            </>
          )}
        </Card>
      )}
    </>
  );
}
