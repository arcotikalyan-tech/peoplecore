import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';

/** Blank CSV templates for importing categories or expenses (finance). Sample rows use made-up values. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('expense.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const kind = req.nextUrl.searchParams.get('kind');
  const csv = kind === 'expenses'
    ? toCsv(['employee_code', 'date', 'category_code', 'amount', 'merchant', 'description'], [['EMP0001', '2026-10-01', 'TRAVEL', '1250', 'Example Travels', 'Client visit']])
    : toCsv(['code', 'name', 'requires_receipt', 'max_per_item', 'sub_categories'], [['TRAVEL', 'Travel', 'yes', '', 'Flight; Train; Bus'], ['INTERNET', 'Internet', 'yes', '1500', '']]);
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind === 'expenses' ? 'expenses' : 'expense-categories'}-template.csv"` } });
}
