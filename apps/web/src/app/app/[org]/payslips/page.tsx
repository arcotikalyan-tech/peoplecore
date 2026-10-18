import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getPayslips } from '@/server/payroll';
import { inr, monthLabel } from '../payroll/format';

export const metadata: Metadata = { title: 'Payslips' };

export default async function PayslipsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const slips = me ? await getPayslips(ctx.org.id, me.id) : [];
  return (
    <>
      <PageHeader title="Payslips" description="Released once payroll for the month is approved and locked." />
      <Card>
        <CardHeader title="Your payslips" />
        <Table caption="Your payslips">
          <thead><tr><Th>Month</Th><Th>Payable days</Th><Th>Gross</Th><Th>Deductions</Th><Th>Net pay</Th></tr></thead>
          <tbody>
            {slips.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No payslips yet.</td></tr>}
            {slips.map((s) => (
              <tr key={s.run_id}>
                <Td className="font-medium"><Link className="text-primary hover:underline" href={`/app/${slug}/payslips/${s.run_id}`}>{monthLabel(s.period_month)}</Link></Td>
                <Td className="tabular-nums">{Number(s.payable_days)}</Td>
                <Td className="tabular-nums">{inr.format(Number(s.gross))}</Td>
                <Td className="tabular-nums">{inr.format(Number(s.deductions))}</Td>
                <Td className="tabular-nums font-medium">{inr.format(Number(s.net))}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
