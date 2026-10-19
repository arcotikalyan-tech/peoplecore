import { NextResponse, type NextRequest } from 'next/server';
import { isIsoDate, todayIn, toCsv } from '@peoplecore/shared';
import { peopleDay, structureNames } from '@/server/attendance-ops';
import { getOrgContext } from '@/server/context';

/** One day's attendance for everyone the caller may see, as CSV (the hub's Export). RLS decides the rows. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!(ctx.can('attendance.read', 'org') || ctx.can('attendance.read', 'team'))) return new NextResponse('Not found', { status: 404 });
  const tz = ctx.org.timezone;
  const raw = request.nextUrl.searchParams.get('date') ?? '';
  const date = isIsoDate(raw) ? raw : todayIn(tz);
  const names = await structureNames(ctx.org.id);
  const dept = new Map(names.departments.map((d) => [d.id, d.name]));
  const loc = new Map(names.locations.map((l) => [l.id, l.name]));
  const rows = [];
  for (let page = 1; page <= 40; page++) {
    const r = await peopleDay(ctx.org.id, date, { page });
    rows.push(...r.rows);
    if (rows.length >= r.total || r.rows.length === 0) break;
  }
  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
  const csv = toCsv(
    ['Employee code', 'Name', 'Department', 'Location', 'Status', 'First in', 'Last out', 'Worked (min)', 'Late (min)', 'Early out (min)', 'Overtime (min)', 'Punches', 'Regularized'],
    rows.map((p) => [p.code, p.name, p.departmentId ? dept.get(p.departmentId) ?? '' : '', p.locationId ? loc.get(p.locationId) ?? '' : '',
      p.status ?? (p.punches ? '' : 'absent'), time(p.firstIn), time(p.lastOut), p.worked, p.late, p.earlyOut, p.overtime, p.punches, p.regularized ? 'yes' : '']),
  );
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${slug}-${date}.csv"`, 'Cache-Control': 'no-store' },
  });
}
