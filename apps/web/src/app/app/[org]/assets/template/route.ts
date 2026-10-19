import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';

/** A blank CSV template for importing assets. Sample rows use made-up values. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('asset.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const csv = toCsv(['name', 'category', 'tag', 'serial_number', 'condition', 'location', 'purchased_on', 'purchase_cost', 'warranty_until', 'notes'], [
    ['ThinkPad T14 Gen 4', 'Laptop', '', 'SN-EXAMPLE-001', 'new', '', '2026-04-01', '98000', '2029-03-31', ''],
    ['Dell 27" monitor', 'Monitor', '', 'SN-EXAMPLE-002', 'good', '', '', '', '', 'Desk 4'],
  ]);
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="assets-template.csv"' } });
}
