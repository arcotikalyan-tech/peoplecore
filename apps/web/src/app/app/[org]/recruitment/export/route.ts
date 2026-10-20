import { NextResponse } from 'next/server';
import { APPLICATION_STAGE_LABELS, CANDIDATE_SOURCE_LABELS, toCsv, type CandidateSource } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { hiringData } from '@/server/hiring';
import { createClient } from '@/server/supabase';

/** Candidates and their applications as CSV, read through RLS as the caller (recruitment.read org-wide); the export is logged. */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('recruitment.read', 'org')) return new NextResponse('Not found', { status: 404 });
  const { jobs, applications } = await hiringData(ctx.org.id);
  const job = new Map(jobs.map((j) => [j.id, j]));
  const supabase = await createClient();
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: 'hiring_candidates', p_params: {} as never, p_rows: applications.length });
  const csv = toCsv(['Candidate', 'Email', 'Phone', 'Company', 'Source', 'Job code', 'Job', 'Stage', 'Stage since', 'Applied'],
    applications.map((a) => [a.candidate.name, a.candidate.email ?? '', a.candidate.phone ?? '', a.candidate.company ?? '',
      CANDIDATE_SOURCE_LABELS[a.candidate.source as CandidateSource] ?? a.candidate.source, job.get(a.requisitionId)?.code ?? '', job.get(a.requisitionId)?.title ?? '',
      APPLICATION_STAGE_LABELS[a.stage], a.stageChangedAt.slice(0, 10), a.createdAt.slice(0, 10)]));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="candidates.csv"', 'Cache-Control': 'no-store' } });
}
