import { NextResponse, type NextRequest } from 'next/server';
import { toCsv, todayIn } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/**
 * The vendor bank file: approved and failed vendor payments with each vendor's account, as a NEFT/RTGS bulk-upload
 * CSV with the company's debit account. vendor_bank_advice checks vendor.manage and records the download.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('vendor.manage', 'org')) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const [{ data, error }, { data: bank }] = await Promise.all([
    supabase.rpc('vendor_bank_advice', { p_org: ctx.org.id }),
    supabase.from('payroll_bank_settings').select('account_number').eq('organization_id', ctx.org.id).maybeSingle(),
  ]);
  if (error) return new NextResponse('Not found', { status: 404 });
  const day = todayIn(ctx.org.timezone);
  const csv = toCsv(['Payment type', 'Beneficiary name', 'Beneficiary account number', 'IFSC', 'Amount', 'Debit account number', 'Value date', 'Narration'],
    (data ?? []).map((r) => [Number(r.amount) >= 200000 ? 'RTGS' : 'NEFT', r.account_holder ?? r.vendor_name, r.account_number ?? 'MISSING', r.ifsc ?? 'MISSING',
      Number(r.amount).toFixed(2), bank?.account_number ?? '', day, `Invoice ${r.invoice_number}`]));
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vendor-payments-${day}.csv"`, 'Cache-Control': 'no-store' },
  });
}
