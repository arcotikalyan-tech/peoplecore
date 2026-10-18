import { NextResponse, type NextRequest } from 'next/server';
import { todayIn, toCsv } from '@peoplecore/shared';
import { getMonthSummary } from '@/server/attendance';
import { getOrgContext } from '@/server/context';

/** The monthly summary as CSV, for payroll. Needs attendance.read across the organization. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('attendance.read', 'org')) return new NextResponse('Not found', { status: 404 });
  const raw = request.nextUrl.searchParams.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : todayIn(ctx.org.timezone).slice(0, 7);
  const rows = await getMonthSummary(ctx.org.id, `${month}-01`);
  const csv = toCsv(
    ['Employee code', 'Name', 'Days in period', 'Present', 'Half days', 'Absent', 'Paid leave', 'Unpaid leave', 'Weekly offs', 'Holidays', 'Not marked', 'Late days', 'Payable days', 'LOP days'],
    rows.map((r) => [r.employee_code, r.employee_name, r.days_in_period, r.present, r.half_days, r.absent, r.paid_leave, r.unpaid_leave,
      r.weekly_offs, r.holidays, r.not_marked, r.late_days, r.payable_days, r.lop_days]),
  );
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance-${slug}-${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
