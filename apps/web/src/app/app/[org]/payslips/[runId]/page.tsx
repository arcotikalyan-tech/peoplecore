import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { buttonClass } from '@/components/ui/button';
import { Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { getEmployee, getMyEmployee } from '@/server/employees';
import { getPayslip } from '@/server/payroll';
import { payrollSettings } from '@/server/payroll-suite';
import { inr as inrWhole, monthLabel } from '../../payroll/format';

const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const metadata: Metadata = { title: 'Payslip' };

/** One payslip. Your own by default; payroll staff can open anyone's from the run (?employee=). RLS decides. */
export default async function PayslipPage({ params, searchParams }: { params: Promise<{ org: string; runId: string }>; searchParams: Promise<{ employee?: string }> }) {
  const { org: slug, runId } = await params;
  const { employee: requested } = await searchParams;
  if (!z.uuid().safeParse(runId).success || (requested && !z.uuid().safeParse(requested).success)) notFound();
  const ctx = await getOrgContext(slug);
  const employeeId = requested ?? (await getMyEmployee(ctx.org.id, ctx.user.id))?.id;
  if (!employeeId) notFound();
  const [slip, employee, settings] = await Promise.all([getPayslip(ctx.org.id, runId, employeeId), getEmployee(ctx.org.id, employeeId), payrollSettings(ctx.org.id)]);
  if (!slip) notFound();
  const inr = settings?.payslip_show_paise ?? true ? inrPaise : inrWhole;
  const group = (kind: string) => slip.lines.filter((l) => l.kind === kind);
  const section = (title: string, kind: string) => (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-line text-sm" aria-label={title}>
        {group(kind).map((l) => (
          <li key={l.code} className="flex justify-between px-5 py-2"><span>{l.name}</span><span className="tabular-nums">{inr.format(Number(l.amount))}</span></li>
        ))}
        {group(kind).length === 0 && <li className="px-5 py-2 text-muted">None</li>}
      </ul>
    </Card>
  );

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/payslips?tab=payslips`} className="hover:text-fg">← My Pay</Link>}
        title={`Payslip · ${monthLabel(slip.period_month)}`}
        description={employee ? `${[employee.first_name, employee.last_name].filter(Boolean).join(' ')} · ${employee.employee_code}` : undefined}
        actions={<a href={`/app/${slug}/payslips/${runId}/pdf${requested ? `?employee=${requested}` : ''}`} download className={buttonClass('secondary')}>Download PDF</a>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Summary" />
          <DetailList items={[
            { label: 'Payable days', value: `${Number(slip.payable_days)} (loss of pay: ${Number(slip.lop_days)})` },
            { label: 'Gross earnings', value: inr.format(Number(slip.gross)) },
            { label: 'Deductions', value: inr.format(Number(slip.deductions)) },
            { label: 'Net pay', value: <span className="text-lg font-semibold">{inr.format(Number(slip.net))}</span> },
          ]} />
        </Card>
        {section('Earnings', 'earning')}
        {section('Deductions', 'deduction')}
      </div>
    </>
  );
}
