import { NextResponse, type NextRequest } from 'next/server';
import { payslipPdf } from '@peoplecore/payroll';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { getEmployee, getMyEmployee } from '@/server/employees';
import { getPayslip } from '@/server/payroll';
import { createClient } from '@/server/supabase';

/** One payslip as a PDF. Same reads as the payslip page, as the signed-in user: RLS decides whose slip they get. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org: slug, runId } = await params;
  const requested = req.nextUrl.searchParams.get('employee');
  if (!z.uuid().safeParse(runId).success || (requested && !z.uuid().safeParse(requested).success)) return new NextResponse('Not found', { status: 404 });
  const ctx = await getOrgContext(slug);
  const employeeId = requested ?? (await getMyEmployee(ctx.org.id, ctx.user.id))?.id;
  if (!employeeId) return new NextResponse('Not found', { status: 404 });
  const [slip, employee] = await Promise.all([getPayslip(ctx.org.id, runId, employeeId), getEmployee(ctx.org.id, employeeId)]);
  if (!slip || !employee) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const [department, designation] = await Promise.all([
    employee.department_id ? supabase.from('departments').select('name').eq('organization_id', ctx.org.id).eq('id', employee.department_id).maybeSingle() : null,
    employee.designation_id ? supabase.from('designations').select('title').eq('organization_id', ctx.org.id).eq('id', employee.designation_id).maybeSingle() : null,
  ]);
  const lines = (kind: string) => slip.lines.filter((l) => l.kind === kind).map((l) => ({ name: l.name, amount: Number(l.amount) }));
  const pdf = payslipPdf({
    organization: ctx.org.name,
    periodMonth: slip.period_month,
    employee: {
      name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
      code: employee.employee_code,
      department: department?.data?.name ?? null,
      designation: designation?.data?.title ?? null,
    },
    payableDays: Number(slip.payable_days),
    lopDays: Number(slip.lop_days),
    earnings: lines('earning'),
    deductions: lines('deduction'),
    totals: { gross: Number(slip.gross), deductions: Number(slip.deductions), net: Number(slip.net) },
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${slip.period_month.slice(0, 7)}-${employee.employee_code.replace(/[^\w-]/g, '')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
