import { NextResponse, type NextRequest } from 'next/server';
import { todayIn, toCsv, type CsvValue } from '@peoplecore/shared';
import { REPORT_BY_KEY } from '@/lib/report-catalog';
import { toXlsx } from '@/lib/xlsx';
import { getOrgContext } from '@/server/context';
import { canRun, readParams, runReport, type Params } from '@/server/reports';
import { createClient } from '@/server/supabase';

/**
 * Generates one report as Excel (or CSV) for the signed-in user. Data is read through RLS as that user; every export
 * is recorded (report, parameters, row count). Problems ("no processed payroll for that month") come back as JSON
 * so the page can show them; statutory files that keep their own format come back as a link to their download.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const sp = req.nextUrl.searchParams;
  const info = REPORT_BY_KEY.get(sp.get('report') ?? '');
  if (!info || !canRun(ctx, info.access)) return NextResponse.json({ message: 'You can’t run this report.' }, { status: 403 });
  const p = readParams(info, sp, todayIn(ctx.org.timezone));
  const out = await runReport(ctx, info.key, p).catch((e: unknown) => ({ kind: 'error' as const, message: e instanceof Error ? e.message : 'The report failed.' }));
  if (out.kind === 'error') return NextResponse.json({ message: out.message }, { status: 409 });
  if (out.kind === 'link') return NextResponse.json({ link: out.url });

  const used: Partial<Record<keyof Params, unknown>> = {};
  if (info.param === 'range') { used.from = p.from; used.to = p.to; }
  if (info.param === 'month') used.month = p.month;
  if (info.param === 'year' || info.param === 'quarter') used.year = p.year;
  if (info.param === 'quarter') used.quarter = p.quarter;
  if (info.param === 'asof') used.asof = p.asof;
  if (p.department) used.department = p.department;
  if (p.location) used.location = p.location;
  if (p.template) used.template = p.template;
  if (info.key === 'custom_builder') { used.columns = p.columns; used.group = p.group; }
  const supabase = await createClient();
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: info.key, p_params: used as never, p_rows: out.rows });

  const csv = sp.get('format') === 'csv';
  const name = `${out.name}.${csv ? 'csv' : 'xlsx'}`.replace(/[^A-Za-z0-9._-]/g, '-');
  const body = csv
    ? toCsv(out.sheets[0]!.columns, out.sheets[0]!.rows as ReadonlyArray<readonly CsvValue[]>)
    : Buffer.from(toXlsx(out.sheets));
  return new NextResponse(body, {
    headers: {
      'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Report-Rows': String(out.rows),
    },
  });
}
