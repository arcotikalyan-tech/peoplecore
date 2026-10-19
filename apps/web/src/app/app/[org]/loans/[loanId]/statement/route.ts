import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { INSTALMENT_LABEL, KIND_LABEL } from '@/lib/loans';
import { getOrgContext } from '@/server/context';
import { listLoans, loanInstallments } from '@/server/loans';

/** A loan's statement as CSV, for the borrower and payroll (RLS decides). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; loanId: string }> }) {
  const { org, loanId } = await params;
  const ctx = await getOrgContext(org);
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) return new NextResponse('Not found', { status: 404 });
  const loan = (await listLoans(ctx.org.id)).find((l) => l.id === loanId);
  if (!loan) return new NextResponse('Not found', { status: 404 });
  const rows = await loanInstallments(ctx.org.id, [loan.id]);
  const csv = toCsv(['Loan', 'Amount', 'Rate %', 'EMI #', 'Month', 'Opening balance', 'Principal', 'Interest', 'EMI', 'Status', 'Paid on'],
    rows.map((r) => [KIND_LABEL[loan.kind] ?? loan.kind, loan.amount.toFixed(2), loan.interest_rate.toFixed(2), r.seq, r.due_month.slice(0, 7),
      r.opening_balance.toFixed(2), r.principal.toFixed(2), r.interest.toFixed(2), r.emi.toFixed(2), INSTALMENT_LABEL[r.status] ?? r.status, r.paid_at?.slice(0, 10) ?? '']));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="loan-statement.csv"', 'Cache-Control': 'no-store' } });
}
