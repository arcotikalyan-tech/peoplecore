import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { getOrgContext } from '@/server/context';
import { listRuns } from '@/server/payroll';
import { createRunAction } from './actions';
import { inr, monthLabel, STATUS_TONE } from './format';
import { NewRunForm } from './payroll-forms';

export const metadata: Metadata = { title: 'Payroll' };


export default async function PayrollPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('payroll.prepare', 'org') && !ctx.can('payroll.approve', 'org')) notFound();
  const runs = await listRuns(ctx.org.id);
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
        {ctx.can('payroll.prepare', 'org') && (
          <Card>
            <CardHeader title="New run" />
            <NewRunForm action={createRunAction.bind(null, slug)} defaultMonth={today.slice(0, 7)} />
          </Card>
        )}
      </div>
    </>
  );
}
