import { NextResponse, type NextRequest } from 'next/server';
import { FORM_CLASSES, jurisdictionName, REGIMES, toCsv, todayIn } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { evaluations, scopeOf, statutoryFacts } from '@/server/statutory';

/** The form library as CSV (?scope=mine: only the forms that apply to the organization). No personal data. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('statutory.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const mine = req.nextUrl.searchParams.get('scope') === 'mine';
  const rows = evaluations(scopeOf(await statutoryFacts(ctx.org.id)), todayIn(ctx.org.timezone)).filter((e) => !mine || e.applies);
  const csv = toCsv(['ID', 'Artifact', 'Form', 'Act', 'Class', 'Jurisdiction', 'Regime', 'Frequency', 'Due / trigger', 'Data source', 'Confidence', 'Applies to you'],
    rows.map(({ form: f, applies }) => [f.id, f.name, f.form, f.act, FORM_CLASSES[f.cls], jurisdictionName(f.jurisdiction), REGIMES[f.regime], f.frequency, f.trigger, f.source, f.confidence, applies ? 'Yes' : 'No']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="statutory-${mine ? 'applicable' : 'library'}.csv"`, 'Cache-Control': 'no-store' } });
}
