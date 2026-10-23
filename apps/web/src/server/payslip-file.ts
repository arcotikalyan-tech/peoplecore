import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { payslipPdf, type PdfImage } from '@peoplecore/payroll';
import type { Database } from '@peoplecore/db/types';
import { readLogoFile } from './document-storage';
import { pdfImage } from './pdf-image';

// Logos by storage path (a new logo gets a new path), so a run's payslips don't each fetch and decode it.
const logos = new Map<string, PdfImage | null>();
async function logoFor(path: string | null | undefined): Promise<PdfImage | null> {
  if (!path) return null;
  if (!logos.has(path)) {
    const bytes = await readLogoFile(path);
    if (logos.size >= 50) logos.delete(logos.keys().next().value!);
    logos.set(path, bytes ? pdfImage(bytes) : null);
  }
  return logos.get(path) ?? null;
}

/**
 * One payslip as a PDF, read with the caller's own client (the website's session, or the phone app's token): RLS
 * decides whose payslips come back, so this never widens access. Null when there is no such payslip for them.
 */
export async function payslipFile(supabase: SupabaseClient<Database>, orgId: string, orgName: string, runId: string, employeeId: string) {
  const [row, lines, employee, settings, company] = await Promise.all([
    supabase.from('payroll_run_employees').select('*').eq('organization_id', orgId).eq('run_id', runId).eq('employee_id', employeeId).maybeSingle(),
    supabase.from('payroll_line_items').select('code, name, kind, amount').eq('run_id', runId).eq('employee_id', employeeId).order('id'),
    supabase.from('employees').select('first_name, middle_name, last_name, employee_code, department_id, designation_id').eq('organization_id', orgId).eq('id', employeeId).maybeSingle(),
    supabase.from('payroll_settings').select('payslip_show_paise').eq('organization_id', orgId).maybeSingle(),
    supabase.from('company_profiles').select('logo_path').eq('organization_id', orgId).maybeSingle(),
  ]);
  const slip = row.data;
  const emp = employee.data;
  if (!slip || !emp || lines.error) return null;
  const [department, designation, logo] = await Promise.all([
    emp.department_id ? supabase.from('departments').select('name').eq('organization_id', orgId).eq('id', emp.department_id).maybeSingle() : null,
    emp.designation_id ? supabase.from('designations').select('title').eq('organization_id', orgId).eq('id', emp.designation_id).maybeSingle() : null,
    logoFor(company.data?.logo_path),
  ]);
  const of = (kind: string) => (lines.data ?? []).filter((l) => l.kind === kind).map((l) => ({ name: l.name, amount: Number(l.amount) }));
  const pdf = payslipPdf({
    organization: orgName,
    periodMonth: slip.period_month,
    employee: {
      name: [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' '),
      code: emp.employee_code,
      department: department?.data?.name ?? null,
      designation: designation?.data?.title ?? null,
    },
    payableDays: Number(slip.payable_days),
    lopDays: Number(slip.lop_days),
    earnings: of('earning'),
    deductions: of('deduction'),
    totals: { gross: Number(slip.gross), deductions: Number(slip.deductions), net: Number(slip.net) },
    showPaise: settings.data?.payslip_show_paise ?? true,
    logo,
  });
  return { pdf, fileName: `payslip-${slip.period_month.slice(0, 7)}-${emp.employee_code.replace(/[^\w-]/g, '')}.pdf` };
}
