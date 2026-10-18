import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { ActionForm } from '@/components/action-form';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { createClient } from '@/server/supabase';
import { listRuns } from '@/server/payroll';
import { addAdjustmentAction, createRunAction, removeAdjustmentAction } from './actions';
import { inr, monthLabel, STATUS_TONE } from './format';
import { AdjustmentForm, NewRunForm } from './payroll-forms';

export const metadata: Metadata = { title: 'Payroll' };


export default async function PayrollPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('payroll.prepare', 'org') && !ctx.can('payroll.approve', 'org')) notFound();
  const supabase = await createClient();
  const [runs, adjustments, employees] = await Promise.all([
    listRuns(ctx.org.id),
    supabase.from('payroll_adjustments').select('id, employee_id, name, kind, amount, reason, applied_run_id, created_at')
      .eq('organization_id', ctx.org.id).order('created_at', { ascending: false }).limit(50).then((r) => r.data ?? []),
    ctx.can('payroll.prepare', 'org') ? managerOptions(ctx.org.id) : Promise.resolve([]),
  ]);
  const names = await namesFor(ctx.org.id, adjustments.map((a) => a.employee_id));
  const today = todayIn(ctx.org.timezone);

  return (
    <>
      <PageHeader title="Payroll" description="Prepared by one person, approved by another, then locked. Locked runs never change; corrections go into the next run." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Runs" />
          <Table caption="Payroll runs">
            <thead><tr><Th>Month</Th><Th>Status</Th><Th>Employees</Th><Th>Gross</Th><Th>Net pay</Th><Th>Employer cost</Th></tr></thead>
            <tbody>
              {runs.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">No payroll runs yet.</td></tr>}
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium"><Link className="text-primary hover:underline" href={`/app/${slug}/payroll/${r.id}`}>{monthLabel(r.period_month)}</Link></Td>
                  <Td><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></Td>
                  <Td className="tabular-nums">{r.employee_count}</Td>
                  <Td className="tabular-nums">{inr.format(Number(r.total_gross))}</Td>
                  <Td className="tabular-nums">{inr.format(Number(r.total_net))}</Td>
                  <Td className="tabular-nums">{inr.format(Number(r.total_employer_cost))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-6">
          {ctx.can('payroll.prepare', 'org') && (
            <Card>
              <CardHeader title="New run" />
              <NewRunForm action={createRunAction.bind(null, slug)} defaultMonth={today.slice(0, 7)} />
            </Card>
          )}
          <Card>
            <CardHeader title="Adjustments" description="Arrears and recoveries are paid in full with the next run; locked runs never change." />
            {adjustments.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None recorded.</p> : (
              <ul className="divide-y divide-line text-sm" aria-label="Adjustments">
                {adjustments.map((a) => (
                  <li key={a.id} className="space-y-1 px-5 py-3">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{names.get(a.employee_id) ?? 'Employee'} · {a.name}</span>
                      <span className="tabular-nums">{a.kind === 'deduction' ? '−' : ''}{inr.format(Number(a.amount))}</span>
                    </div>
                    <p className="text-xs text-muted">{a.reason} · {formatDate(a.created_at)} · {a.applied_run_id ? 'Paid' : 'Next run'}</p>
                    {!a.applied_run_id && ctx.can('payroll.prepare', 'org') && (
                      <ActionForm action={removeAdjustmentAction.bind(null, slug)} label={`Remove ${a.name}`} submit="Remove" hidden={{ adjustmentId: a.id }} variant="ghost" size="sm" className="inline-flex" />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {ctx.can('payroll.prepare', 'org') && <AdjustmentForm action={addAdjustmentAction.bind(null, slug)} employees={employees} />}
          </Card>
        </div>
      </div>
    </>
  );
}
