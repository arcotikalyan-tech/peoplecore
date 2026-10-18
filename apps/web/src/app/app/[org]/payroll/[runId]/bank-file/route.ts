import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Bank transfer file for a locked run. payroll_bank_file checks payroll.approve + bank access and audits the export. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org, runId } = await params;
  if (!z.uuid().safeParse(runId).success) return new NextResponse('Not found', { status: 404 });
  await getOrgContext(org);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('payroll_bank_file', { p_run: runId });
  if (error) return new NextResponse(error.code === '22023' ? error.message : 'Not found', { status: error.code === '22023' ? 409 : 404 });
  const csv = toCsv(['Employee code', 'Name', 'Account holder', 'Account number', 'IFSC', 'Amount'],
    data.map((r) => [r.employee_code, r.employee_name, r.account_holder ?? 'MISSING', r.account_number ?? 'MISSING', r.ifsc ?? 'MISSING', Number(r.amount).toFixed(2)]));
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bank-transfer-${runId.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store' },
  });
}
