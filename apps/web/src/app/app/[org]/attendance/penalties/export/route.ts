import { NextResponse, type NextRequest } from 'next/server';
import { attendanceCycleMonth, PENALTY_KIND_LABELS, PENALTY_METHOD_LABELS, todayIn, toCsv, type PenaltyKind, type PenaltyMethod } from '@peoplecore/shared';
import { penaltyLeaveTypes, penaltyLog, rulesSetup } from '@/server/attendance-ops';
import { getOrgContext } from '@/server/context';
import { namesFor } from '@/server/leave';

/** A cycle's penalties as CSV (Logs › Penalties › Export). RLS decides whose rows come back. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!(ctx.can('attendance.read', 'org') || ctx.can('attendance.read', 'team'))) return new NextResponse('Not found', { status: 404 });
  const raw = request.nextUrl.searchParams.get('month') ?? '';
  const setup = await rulesSetup(ctx.org.id);
  const month = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : attendanceCycleMonth(todayIn(ctx.org.timezone), setup.settings?.cycle_start_day ?? 1);
  const [rows, leaveTypes] = await Promise.all([penaltyLog(ctx.org.id, month), penaltyLeaveTypes(ctx.org.id)]);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  const leaveName = new Map(leaveTypes.map((t) => [t.value, t.label]));
  const csv = toCsv(
    ['Employee', 'Anomaly', 'Detail', 'Penalty', 'Deduction (days)', 'From leave', 'Loss of pay (days)', 'Cycle', 'Applied on', 'Status'],
    rows.map((r) => [
      names.get(r.employee_id) ?? '', PENALTY_KIND_LABELS[r.kind as PenaltyKind] ?? r.kind, r.detail ?? '',
      r.method ? PENALTY_METHOD_LABELS[r.method as PenaltyMethod] : '', r.total_days,
      r.leave_split.map((x) => `${leaveName.get(x.leaveTypeId) ?? 'Leave'} ${x.days}`).join('; '), r.days, month.slice(0, 7),
      r.applied_at.slice(0, 10), r.reverted_at ? 'reverted' : 'applied',
    ]),
  );
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="penalties-${slug}-${month.slice(0, 7)}.csv"`, 'Cache-Control': 'no-store' },
  });
}
