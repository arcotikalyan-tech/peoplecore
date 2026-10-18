import { NextResponse, type NextRequest } from 'next/server';
import { isIsoDate, todayIn, toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getBalanceSheet, getLeaveSettings, getRequestsBoard, getRules, leaveCycle, leaveEmployees } from '@/server/leave-ops';

/**
 * Leave exports as CSV: requests (what the caller can see), balances, assignments, the assignment import
 * template, and the caller's own requests. RLS decides which rows come back.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.read')) return new NextResponse('Not found', { status: 404 });
  const sp = request.nextUrl.searchParams;
  const kind = sp.get('kind') ?? 'requests';
  const today = todayIn(ctx.org.timezone);
  const date = (k: string) => { const v = sp.get(k) ?? ''; return isIsoDate(v) ? v : undefined; };

  let header: string[];
  let rows: (string | number | null)[][];
  if (kind === 'template') {
    if (!ctx.can('leave.manage', 'org')) return new NextResponse('Not found', { status: 404 });
    header = ['Employee code', 'Leave rule', 'Effective from'];
    rows = [['E-001', 'CL', today]];
  } else if (kind === 'requests' || kind === 'mine') {
    const me = kind === 'mine' ? await getMyEmployee(ctx.org.id, ctx.user.id) : null;
    if (kind === 'mine' && !me) return new NextResponse('Not found', { status: 404 });
    const [list, { rules }, emps] = await Promise.all([
      getRequestsBoard(ctx.org.id, { status: sp.get('status') ?? undefined, typeId: sp.get('type') ?? undefined, from: date('from'), to: date('to') }, 5000),
      getRules(ctx.org.id, today), leaveEmployees(ctx.org.id),
    ]);
    const typeName = new Map(rules.map((r) => [r.id, r.name]));
    header = ['Employee code', 'Employee', 'Department', 'Leave type', 'From', 'To', 'Days', 'Reason', 'Status', 'Actioned by', 'Applied on'];
    rows = list.filter((r) => !me || r.employee_id === me.id).map((r) => {
      const e = emps.byId.get(r.employee_id);
      return [e?.code ?? '', e?.name ?? '', e?.department ?? '', typeName.get(r.leave_type_id) ?? '', r.start_date, r.end_date, r.days, r.reason, r.status, r.actionedBy, r.created_at.slice(0, 10)];
    });
  } else if (kind === 'balances') {
    const settings = await getLeaveSettings(ctx.org.id);
    const cycle = leaveCycle(today, settings.year_start_month);
    const [sheet, { rules }, emps] = await Promise.all([getBalanceSheet(ctx.org.id, cycle.start), getRules(ctx.org.id, today), leaveEmployees(ctx.org.id)]);
    const typeName = new Map(rules.map((r) => [r.id, r.name]));
    header = ['Employee code', 'Employee', 'Department', 'Leave type', 'Carried forward', 'Credited', 'Applied', 'Penalty', 'Other', 'Balance', 'Pending', 'Available'];
    rows = sheet.filter((s) => s.applies || s.balance !== 0).map((s) => {
      const e = emps.byId.get(s.employee_id);
      return [e?.code ?? '', e?.name ?? '', e?.department ?? '', typeName.get(s.leave_type_id) ?? '', s.carried, s.credited, s.applied, s.penalty, s.other, s.balance, s.pending, s.balance - s.pending];
    });
  } else if (kind === 'assignments') {
    const [{ rules, assignments }, emps] = await Promise.all([getRules(ctx.org.id, today), leaveEmployees(ctx.org.id)]);
    header = ['Employee code', 'Employee', 'Department', 'Leave rule', 'Rule code', 'Effective from'];
    const everyone = rules.filter((r) => r.is_active && r.applies_to === 'everyone');
    rows = emps.list.flatMap((e) => [
      ...everyone.map((r) => [e.code, e.name, e.department, r.name, r.code, 'everyone'] as (string | null)[]),
      ...assignments.filter((a) => a.employee_id === e.id).map((a) => {
        const r = rules.find((x) => x.id === a.leave_type_id);
        return [e.code, e.name, e.department, r?.name ?? '', r?.code ?? '', a.effective_from];
      }),
    ]);
  } else {
    return new NextResponse('Not found', { status: 404 });
  }
  return new NextResponse(toCsv(header, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leave-${kind}-${slug}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
