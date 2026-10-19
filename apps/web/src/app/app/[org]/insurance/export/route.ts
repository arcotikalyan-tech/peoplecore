import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** The endorsement (?kind=endorsement, additions and deletions) or the full insured roster as CSV, for the insurer. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('insurance.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const kind = req.nextUrl.searchParams.get('kind') === 'endorsement' ? 'endorsement' : 'roster';
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('insurance_endorsement', { p_org: ctx.org.id });
  if (error) return new NextResponse('Not found', { status: 404 });
  const rows = data.filter((r) => (kind === 'endorsement' ? r.change !== 'covered' : r.change !== 'deletion'));
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: `insurance_${kind}`, p_params: {} as never, p_rows: rows.length });
  const csv = toCsv(['Change', 'Employee ID', 'Employee', 'Member', 'Relationship', 'Date of birth', 'Gender', 'Sum insured', 'Effective'],
    rows.map((r) => [r.change === 'covered' ? 'Covered' : r.change === 'addition' ? 'Addition' : 'Deletion', r.employee_code, r.employee_name, r.member_name, r.relationship,
      r.date_of_birth ?? '', r.gender ?? '', r.sum_insured === null ? '' : Number(r.sum_insured).toFixed(2), r.effective ?? '']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="insurance-${kind}.csv"`, 'Cache-Control': 'no-store' } });
}
