import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { getMonthSummary } from '@/server/attendance';
import { requirePermission } from '@/server/context';

export const metadata: Metadata = { title: 'Monthly attendance' };

const monthParam = (v: string | undefined, today: string) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7));

export default async function SummaryPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ month?: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'attendance.read', 'org');
  const month = monthParam((await searchParams).month, todayIn(ctx.org.timezone));
  const rows = await getMonthSummary(ctx.org.id, `${month}-01`);
  const base = `/app/${slug}/attendance`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={base} className="hover:text-fg">← Attendance</Link>}
        title="Monthly attendance"
        description="Payroll input, recomputed from punches, shifts, holidays and approved leave each time it’s opened. Days after today aren’t judged yet."
        actions={<a className={buttonClass('secondary')} href={`${base}/summary/export?month=${month}`} download>Export CSV</a>}
      />
      <form className="mb-4 flex items-end gap-2" action="">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Month</span>
          <input type="month" name="month" defaultValue={month} className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm" />
        </label>
        <button className={buttonClass('secondary')}>Show</button>
      </form>
      <Card>
        <CardHeader title={new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} description={`${rows.length} employees`} />
        <Table caption="Monthly attendance summary">
          <thead>
            <tr><Th>Code</Th><Th>Employee</Th><Th>Present</Th><Th>Absent</Th><Th>Paid leave</Th><Th>Unpaid leave</Th><Th>Offs & holidays</Th><Th>Late days</Th><Th>Payable</Th><Th>LOP</Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_id}>
                <Td className="font-mono text-xs">{r.employee_code}</Td>
                <Td className="font-medium">{r.employee_name}</Td>
                <Td className="tabular-nums">{r.present}</Td>
                <Td className="tabular-nums">{r.absent}</Td>
                <Td className="tabular-nums">{r.paid_leave}</Td>
                <Td className="tabular-nums">{r.unpaid_leave}</Td>
                <Td className="tabular-nums">{r.weekly_offs + r.holidays}</Td>
                <Td className="tabular-nums">{r.late_days}</Td>
                <Td className="tabular-nums font-medium">{r.payable_days}</Td>
                <Td className="tabular-nums">{r.lop_days}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
