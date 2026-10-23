import { NextResponse, type NextRequest } from 'next/server';
import { isIsoDate, toCsv } from '@peoplecore/shared';
import { auditEventsForExport, type AuditRange } from '@/server/audit';
import { getOrgContext } from '@/server/context';
import { namesForUsers } from '@/server/employees';
import { createClient } from '@/server/supabase';

const ACTIONS: Record<string, string> = { insert: 'Created', update: 'Updated', delete: 'Deleted' };

/** The audit log for a period as CSV (Audit log › Download CSV), for people who may read it. RLS decides the rows. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('audit.read', 'org')) return new NextResponse('Not found', { status: 404 });
  const sp = request.nextUrl.searchParams;
  const range: AuditRange = { from: isIsoDate(sp.get('from') ?? '') ? sp.get('from')! : undefined, to: isIsoDate(sp.get('to') ?? '') ? sp.get('to')! : undefined };
  const { rows, more } = await auditEventsForExport(ctx.org.id, range, ctx.org.timezone);
  if (more) return new NextResponse('Too many entries for one file: choose a shorter period on the Audit log page.', { status: 413 });
  // Recorded before the file is handed over; if that's refused, there is no file.
  const supabase = await createClient();
  const { error } = await supabase.rpc('log_audit_export', { p_org: ctx.org.id, p_row_count: rows.length, p_from: range.from, p_to: range.to });
  if (error) return new NextResponse('Not found', { status: 404 });

  const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (let i = 0; i < actorIds.length; i += 150) {
    for (const [id, name] of await namesForUsers(ctx.org.id, actorIds.slice(i, i + 150))) names.set(id, name);
  }
  const when = new Intl.DateTimeFormat('sv-SE', { timeZone: ctx.org.timezone, dateStyle: 'short', timeStyle: 'medium' });
  const csv = toCsv(
    [`When (${ctx.org.timezone})`, 'Who', 'User id', 'Action', 'Record type', 'Record id', 'Changes'],
    rows.map((r) => [
      when.format(new Date(r.occurred_at)), r.actor_user_id ? (names.get(r.actor_user_id) ?? '') : 'System', r.actor_user_id ?? '',
      ACTIONS[r.action] ?? r.action, r.entity_type, r.entity_id ?? '', r.changes ? JSON.stringify(r.changes) : '',
    ]),
  );
  const period = range.from || range.to ? `-${range.from ?? 'start'}-to-${range.to ?? 'now'}` : '';
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-log-${slug}${period}.csv"`, 'Cache-Control': 'no-store' },
  });
}
