import { NextResponse, type NextRequest } from 'next/server';
import { todayIn, toCsv } from '@peoplecore/shared';
import { endorsementReason, rosterKeys } from '@/lib/insurance';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/**
 * The endorsement (?kind=endorsement, additions and deletions) or the full insured roster as CSV, for the insurer.
 * The endorsement follows HR's choice: ?only= lists the changes to include, ?skip= the ones left out (roster keys).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('insurance.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') === 'endorsement' ? 'endorsement' : 'roster';
  const supabase = await createClient();
  const [{ data, error }, { count: syncs }] = await Promise.all([
    supabase.rpc('insurance_endorsement', { p_org: ctx.org.id }),
    supabase.from('insurance_syncs').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id),
  ]);
  if (error) return new NextResponse('Not found', { status: 404 });
  const only = sp.has('only') ? new Set(rosterKeys(sp.getAll('only'))) : null;
  const skip = new Set(rosterKeys(sp.getAll('skip')));
  const rows = data.filter((r) => (kind === 'endorsement' ? r.change !== 'covered' && (!only || only.has(r.key)) && !skip.has(r.key) : r.change !== 'deletion'));
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: `insurance_${kind}`, p_params: {} as never, p_rows: rows.length });
  const today = todayIn(ctx.org.timezone);
  const csv = toCsv(['Change', 'Reason', 'Employee ID', 'Employee', 'Member', 'Relationship', 'Date of birth', 'Gender', 'Sum insured', 'Effective'],
    rows.map((r) => [r.change === 'covered' ? 'Covered' : r.change === 'addition' ? 'Addition' : 'Deletion', r.change === 'covered' ? '' : endorsementReason(r, !syncs, today),
      r.employee_code, r.employee_name, r.member_name, r.relationship, r.date_of_birth ?? '', r.gender ?? '', r.sum_insured === null ? '' : Number(r.sum_insured).toFixed(2), r.effective ?? '']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="insurance-${kind}-${today}.csv"`, 'Cache-Control': 'no-store' } });
}
