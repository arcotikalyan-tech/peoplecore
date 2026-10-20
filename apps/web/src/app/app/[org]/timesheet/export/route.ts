import { NextResponse, type NextRequest } from 'next/server';
import { toCsv, todayIn } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { tsEntries, tsPeople, tsWorkspace } from '@/server/timesheet';

/**
 * Time logs as CSV (?kind=detailed with from/to and optional emp/project) or the unbilled billable rollup by project
 * (?kind=rollup, timesheet admins). Read through RLS as the caller: members export their own time, managers their reports'.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const sp = req.nextUrl.searchParams;
  const iso = (k: string, f: string) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) ?? '') ? sp.get(k)! : f);
  const today = todayIn(ctx.org.timezone);
  const [ws, people] = await Promise.all([tsWorkspace(ctx.org.id), tsPeople(ctx.org.id)]);
  const project = (id: string) => ws.projects.find((p) => p.id === id);
  const client = (id: string | null | undefined) => ws.clients.find((c) => c.id === id)?.name ?? '';
  const headers = { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' };

  if (sp.get('kind') === 'rollup') {
    if (!ctx.can('timesheet.manage', 'org')) return new NextResponse('Not found', { status: 404 });
    const entries = (await tsEntries(ctx.org.id, { from: '2000-01-01', to: today, status: ['approved'] })).filter((e) => e.billable && !e.invoice_id);
    const rows = ws.projects.map((p) => {
      const es = entries.filter((e) => e.project_id === p.id);
      return [p.name, client(p.client_id), es[0]?.currency ?? '', (es.reduce((s, e) => s + e.minutes, 0) / 60).toFixed(2), es.reduce((s, e) => s + (e.minutes / 60) * (e.rate ?? 0), 0).toFixed(2)];
    }).filter((r) => Number(r[3]) > 0);
    return new NextResponse(toCsv(['Project', 'Client', 'Currency', 'Billable hours', 'Amount'], rows), { headers: { ...headers, 'Content-Disposition': 'attachment; filename="timesheet-billable-rollup.csv"' } });
  }

  const entries = await tsEntries(ctx.org.id, {
    from: iso('from', today), to: iso('to', today),
    employeeId: /^[0-9a-f-]{36}$/.test(sp.get('emp') ?? '') ? sp.get('emp')! : undefined,
    projectId: /^[0-9a-f-]{36}$/.test(sp.get('project') ?? '') ? sp.get('project')! : undefined,
  });
  const csv = toCsv(['Date', 'Employee ID', 'Employee', 'Client', 'Project', 'Task', 'Description', 'Start', 'End', 'Hours', 'Billable', 'Rate', 'Currency', 'Status'],
    entries.map((e) => [e.work_date, people.get(e.employee_id)?.code ?? '', people.get(e.employee_id)?.name ?? '', client(project(e.project_id)?.client_id), project(e.project_id)?.name ?? '',
      ws.tasks.find((t) => t.id === e.task_id)?.name ?? '', e.description ?? '', e.start_time?.slice(0, 5) ?? '', e.end_time?.slice(0, 5) ?? '', (e.minutes / 60).toFixed(2),
      e.billable ? 'Yes' : 'No', e.rate === null ? '' : e.rate.toFixed(2), e.currency, e.status]));
  return new NextResponse(csv, { headers: { ...headers, 'Content-Disposition': `attachment; filename="timesheet-${iso('from', today)}-to-${iso('to', today)}.csv"` } });
}
