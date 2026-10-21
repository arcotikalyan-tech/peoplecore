import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/**
 * Bank advice for a locked run, in the company's chosen bulk-upload layout (Settings › Bank Integration). Only
 * pending and failed payouts; payroll_bank_advice checks payroll.approve + bank access and audits the download.
 * The bank layouts follow each bank's common bulk-upload columns; confirm with the bank before the first upload.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org, runId } = await params;
  if (!z.uuid().safeParse(runId).success) return new NextResponse('Not found', { status: 404 });
  const ctx = await getOrgContext(org);
  const supabase = await createClient();
  const [{ data, error }, { data: bank }, { data: run }] = await Promise.all([
    supabase.rpc('payroll_bank_advice', { p_run: runId }),
    supabase.from('payroll_bank_settings').select('account_number, ifsc, bank_name, file_format').eq('organization_id', ctx.org.id).maybeSingle(),
    supabase.from('payroll_runs').select('period_month').eq('id', runId).maybeSingle(),
  ]);
  if (error) return new NextResponse(error.code === '22023' ? error.message : 'Not found', { status: error.code === '22023' ? 409 : 404 });
  // ?format= picks another bank's layout for this download (Payout › Bank advice buttons); else the saved one.
  const asked = req.nextUrl.searchParams.get('format');
  const format = asked && ['generic', 'hdfc', 'icici', 'sbi', 'axis', 'bob'].includes(asked) ? asked : bank?.file_format ?? 'generic';
  const day = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  const amount = (n: number | string) => Number(n).toFixed(2);
  const sameBank = (ifsc: string | null) => Boolean(ifsc && bank?.ifsc && ifsc.slice(0, 4) === bank.ifsc.slice(0, 4));
  const narration = `Salary ${run?.period_month?.slice(0, 7) ?? ''}`;
  let csv: string;
  if (format === 'hdfc') {
    csv = toCsv(['Transaction Type', 'Beneficiary Code', 'Beneficiary Account Number', 'Instrument Amount', 'Beneficiary Name', 'Payment Date', 'IFSC Code', 'Debit Account Number', 'Narration'],
      data.map((r) => [sameBank(r.ifsc) ? 'I' : 'N', r.employee_code, r.account_number ?? 'MISSING', amount(r.amount), r.account_holder ?? r.employee_name, day, r.ifsc ?? 'MISSING', bank?.account_number ?? '', narration]));
  } else if (format === 'icici') {
    csv = toCsv(['Debit Ac No', 'Beneficiary Ac No', 'Beneficiary Name', 'Amt', 'Pay Mod', 'Date', 'IFSC', 'Remarks'],
      data.map((r) => [bank?.account_number ?? '', r.account_number ?? 'MISSING', r.account_holder ?? r.employee_name, amount(r.amount), sameBank(r.ifsc) ? 'I' : 'N', day, r.ifsc ?? 'MISSING', narration]));
  } else if (format === 'axis') {
    csv = toCsv(['Payment Method Name', 'Payment Amount', 'Activation Date', 'Beneficiary Name', 'Beneficiary Account No', 'Debit Account No', 'Beneficiary IFSC', 'Remarks'],
      data.map((r) => [sameBank(r.ifsc) ? 'FT' : 'NEFT', amount(r.amount), day, r.account_holder ?? r.employee_name, r.account_number ?? 'MISSING', bank?.account_number ?? '', r.ifsc ?? 'MISSING', narration]));
  } else if (format === 'bob') {
    csv = toCsv(['Beneficiary Name', 'Beneficiary Account No', 'IFSC Code', 'Amount', 'Transaction Type', 'Debit Account No', 'Narration'],
      data.map((r) => [r.account_holder ?? r.employee_name, r.account_number ?? 'MISSING', r.ifsc ?? 'MISSING', amount(r.amount), sameBank(r.ifsc) ? 'TRF' : 'NEFT', bank?.account_number ?? '', narration]));
  } else if (format === 'sbi') {
    csv = toCsv(['Beneficiary Name', 'Beneficiary Account Number', 'IFSC', 'Amount', 'Remarks'],
      data.map((r) => [r.account_holder ?? r.employee_name, r.account_number ?? 'MISSING', r.ifsc ?? 'MISSING', amount(r.amount), narration]));
  } else {
    csv = toCsv(['Employee code', 'Name', 'Account holder', 'Bank', 'Account number', 'IFSC', 'Amount', 'Narration'],
      data.map((r) => [r.employee_code, r.employee_name, r.account_holder ?? 'MISSING', r.bank_name ?? '', r.account_number ?? 'MISSING', r.ifsc ?? 'MISSING', amount(r.amount), narration]));
  }
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bank-advice-${format}-${run?.period_month?.slice(0, 7) ?? runId.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store' },
  });
}
