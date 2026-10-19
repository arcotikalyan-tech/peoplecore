import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { todayIn } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { declarations, payrollPeople } from '@/server/payroll-suite';

/** Every employee's declaration items for a financial year (payroll staff; RLS limits the rows). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('payroll.prepare', 'org') && !ctx.can('payroll.approve', 'org')) return new NextResponse('Not found', { status: 404 });
  const fy = req.nextUrl.searchParams.get('fy') ?? '';
  if (!/^\d{4}-\d{2}$/.test(fy)) return new NextResponse('Bad request', { status: 400 });
  const [decls, people] = await Promise.all([declarations(ctx.org.id, fy), payrollPeople(ctx.org.id, `${todayIn(ctx.org.timezone).slice(0, 7)}-01`)]);
  const who = new Map(people.map((p) => [p.id, p]));
  const rows = decls.flatMap((d) => (d.tax_declaration_items.length ? d.tax_declaration_items : [null]).map((i) => [
    who.get(d.employee_id)?.code ?? '', who.get(d.employee_id)?.name ?? '', d.regime, d.status, i?.section ?? '', i?.label ?? '',
    i ? String(Number(i.declared)) : '', i?.approved == null ? '' : String(Number(i.approved)), i?.tds == null ? '' : String(Number(i.tds)), i?.status ?? '',
  ]));
  const csv = toCsv(['Employee code', 'Name', 'Regime', 'Declaration status', 'Section', 'Item', 'Declared', 'Approved', 'TDS (earlier employer)', 'Item status'], rows);
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tax-declarations-${fy}.csv"`, 'Cache-Control': 'no-store' },
  });
}
