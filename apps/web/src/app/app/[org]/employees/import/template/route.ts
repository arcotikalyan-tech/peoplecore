import { NextResponse, type NextRequest } from 'next/server';
import { IMPORT_COLUMNS, toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';

/** The import template: every column, with one example row (fictional). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const ctx = await getOrgContext((await params).org);
  if (!ctx.can('employee.create', 'org')) return new NextResponse('Not found', { status: 404 });
  const csv = toCsv(IMPORT_COLUMNS.map((c) => c.header), [IMPORT_COLUMNS.map((c) => c.example)]);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="peoplecore-employee-import-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
