import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { monthRun, payrollPeople, runResults } from '@/server/payroll-suite';

/** The pay register for a month as CSV: one row per employee, one column per earning and deduction. Payroll staff only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.can('payroll.prepare', 'org') && !ctx.can('payroll.approve', 'org')) return new NextResponse('Not found', { status: 404 });
  const m = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return new NextResponse('Bad request', { status: 400 });
  const run = await monthRun(ctx.org.id, `${m}-01`);
  if (!run || run.status === 'draft') return new NextResponse('This month hasn’t been calculated yet.', { status: 409 });
  const [people, results] = await Promise.all([payrollPeople(ctx.org.id, `${m}-01`), runResults(run.id)]);
  const codes = new Map<string, { name: string; kind: string }>();
  for (const r of results.values()) for (const l of r.lines) if (!codes.has(l.code)) codes.set(l.code, { name: l.name, kind: l.kind });
  const order = [...codes.entries()].sort((a, b) => ['earning', 'deduction', 'employer'].indexOf(a[1].kind) - ['earning', 'deduction', 'employer'].indexOf(b[1].kind));
  const csv = toCsv(
    ['Employee code', 'Name', 'Department', 'Designation', 'Payable days', 'LOP days', ...order.map(([, c]) => `${c.name} (${c.kind})`), 'Gross', 'Deductions', 'Net pay', 'Employer cost'],
    people.filter((p) => results.has(p.id)).map((p) => {
      const r = results.get(p.id)!;
      return [p.code, p.name, p.department ?? '', p.designation ?? '', String(Number(r.payable_days)), String(Number(r.lop_days)),
        ...order.map(([code]) => String(r.lines.filter((l: { code: string }) => l.code === code).reduce((s: number, l: { amount: number }) => s + l.amount, 0))),
        String(Number(r.gross)), String(Number(r.deductions)), String(Number(r.net)), String(Number(r.employer_cost))];
    }),
  );
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pay-register-${m}.csv"`, 'Cache-Control': 'no-store' },
  });
}
