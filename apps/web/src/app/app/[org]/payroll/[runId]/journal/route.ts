import { NextResponse, type NextRequest } from 'next/server';
import { payrollJournal } from '@peoplecore/payroll';
import { toCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/** Accounting journal for a locked run. payroll_journal_items checks payroll staff, sums the line items and audits the export. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org, runId } = await params;
  if (!z.uuid().safeParse(runId).success) return new NextResponse('Not found', { status: 404 });
  await getOrgContext(org);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('payroll_journal_items', { p_run: runId });
  if (error) return new NextResponse(error.code === '22023' ? error.message : 'Not found', { status: error.code === '22023' ? 409 : 404 });
  const journal = payrollJournal(data.map((i) => ({ code: i.code, name: i.name, kind: i.kind, amount: Number(i.amount) })));
  const money = (n: number) => (n ? n.toFixed(2) : '');
  const csv = toCsv(['Account', 'Component code', 'Description', 'Debit', 'Credit'], [
    ...journal.lines.map((l) => [l.account, l.code ?? '', l.description, money(l.debit), money(l.credit)]),
    ['Total', '', '', journal.totals.debit.toFixed(2), journal.totals.credit.toFixed(2)],
  ]);
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="payroll-journal-${runId.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store' },
  });
}
