import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { allCategories, claimRows } from '@/server/expenses';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { claimState, filterClaims } from '../_tabs/shared';

/** Claims as CSV: everything finance can see (with the list's filters), or the caller's own claims (?mine=1). RLS decides. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const sp = req.nextUrl.searchParams;
  const mine = sp.get('mine') === '1' || !ctx.can('expense.manage', 'org');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  if (mine && !me) return new NextResponse('Not found', { status: 404 });
  const [rows, cats, structure] = await Promise.all([
    claimRows(ctx.org.id, mine ? { employeeId: me!.id } : { excludeDrafts: true }), allCategories(ctx.org.id), getStructure(ctx.org.id),
  ]);
  const supabase = await createClient();
  const { data: emps } = await supabase.from('employees').select('id, employee_code, first_name, last_name, department_id').eq('organization_id', ctx.org.id);
  const people = new Map((emps ?? []).map((e) => [e.id, e]));
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const cat = new Map(cats.map((c) => [c.id, c.name]));
  const list = filterClaims(rows, Object.fromEntries(sp), people);
  await supabase.rpc('log_report_export', { p_org: ctx.org.id, p_report: 'expense_claims', p_params: { mine, rows: list.length } as never, p_rows: list.length });
  const csv = toCsv(['Employee ID', 'Name', 'Department', 'Claim', 'Category', 'Merchant', 'Expense date', 'Amount', 'Receipts', 'Status', 'Submitted', 'Decided', 'Paid', 'Payout', 'Reference'],
    list.map((c) => {
      const e = people.get(c.employee_id);
      return [e?.employee_code ?? '', e ? [e.first_name, e.last_name].filter(Boolean).join(' ') : '', e?.department_id ? dept.get(e.department_id) ?? '' : '', c.title,
        c.categoryIds.map((id) => cat.get(id) ?? '').join('; '), c.merchant ?? '', c.expenseDate ?? '', c.total.toFixed(2), `${c.receipts}/${c.items}`, claimState(c),
        c.submitted_at?.slice(0, 10) ?? '', c.decided_at?.slice(0, 10) ?? '', c.paid_at?.slice(0, 10) ?? '', c.payout_mode ?? '', c.payout_reference ?? ''];
    }));
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="expense-claims.csv"`, 'Cache-Control': 'no-store' } });
}
