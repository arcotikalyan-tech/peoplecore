import { NextResponse, type NextRequest } from 'next/server';
import { todayIn, toCsv } from '@peoplecore/shared';
import { assetCategories, listAssets, type AssetStatus } from '@/server/assets';
import { getOrgContext } from '@/server/context';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { filterAssets } from '../_tabs/filter';
import { ASSET_STATUS_LABEL, bookValue, CONDITION_LABEL } from '../tone';

/** The asset register as CSV, with the register's filters. Asset managers only (RLS also limits the rows). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('asset.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const [assets, categories, structure, emps] = await Promise.all([
    listAssets(ctx.org.id), assetCategories(ctx.org.id), getStructure(ctx.org.id),
    supabase.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const people = new Map(emps.map((e) => [e.id, e]));
  const name = (id: string) => { const e = people.get(id); return e ? [e.first_name, e.last_name].filter(Boolean).join(' ') : ''; };
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const life = new Map(categories.map((c) => [c.id, c.useful_life_months]));
  const today = todayIn(ctx.org.timezone);
  const rows = filterAssets(assets, Object.fromEntries(req.nextUrl.searchParams), name);
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: 'asset_register', p_params: { rows: rows.length } as never, p_rows: rows.length });
  const csv = toCsv(['Tag', 'Name', 'Category', 'Serial number', 'Status', 'Condition', 'Location', 'Assigned to', 'Employee ID', 'Purchased on', 'Purchase cost', 'Book value', 'Warranty until'],
    rows.map((a) => [a.tag, a.name, a.category, a.serial_number ?? '', ASSET_STATUS_LABEL[a.status as AssetStatus], CONDITION_LABEL[a.condition] ?? a.condition,
      a.location_id ? loc.get(a.location_id) ?? '' : '', a.issue ? name(a.issue.employee_id) : '', a.issue ? people.get(a.issue.employee_id)?.employee_code ?? '' : '',
      a.purchased_on ?? '', a.purchase_cost?.toFixed(2) ?? '', a.purchase_cost === null ? '' : bookValue(a.purchase_cost, a.purchased_on, life.get(a.category_id), today).toFixed(2),
      a.warranty_until ?? '']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="asset-register.csv"', 'Cache-Control': 'no-store' } });
}
