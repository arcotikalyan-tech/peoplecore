import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** A calendar's holidays for a year as CSV (the same columns the import takes). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const cal = req.nextUrl.searchParams.get('cal') ?? '';
  const year = /^\d{4}$/.test(req.nextUrl.searchParams.get('year') ?? '') ? req.nextUrl.searchParams.get('year')! : new Date().getUTCFullYear().toString();
  if (!/^[0-9a-f-]{36}$/i.test(cal)) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from('holidays').select('holiday_date, name, is_optional, description')
    .eq('organization_id', ctx.org.id).eq('calendar_id', cal).gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`).order('holiday_date');
  const csv = toCsv(['date', 'name', 'type', 'description'], (data ?? []).map((h) => [h.holiday_date, h.name, h.is_optional ? 'optional' : 'public', h.description ?? '']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="holidays-${year}.csv"` } });
}
