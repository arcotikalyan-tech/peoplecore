import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Bank transfer file for selected approved claims. expense_bank_advice checks finance and bank access and records the export. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const ids = (req.nextUrl.searchParams.get('claims') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 500);
  if (ids.length === 0) return new NextResponse('Choose the claims to pay.', { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('expense_bank_advice', { p_org: ctx.org.id, p_claims: ids });
  if (error) return new NextResponse(error.code === '42501' ? 'The bank file needs finance and bank-details access.' : 'The bank file could not be built.', { status: error.code === '42501' ? 403 : 500 });
  const csv = toCsv(['Employee code', 'Employee name', 'Account holder', 'Bank', 'Account number', 'IFSC', 'Amount', 'Narration'],
    data.map((r) => [r.employee_code, r.employee_name, r.account_holder_name ?? 'NO BANK ACCOUNT', r.bank_name ?? '', r.account_number ?? '', r.ifsc ?? '', Number(r.amount).toFixed(2), 'Expense reimbursement']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="expense-bank-transfer.csv"', 'Cache-Control': 'no-store' } });
}
