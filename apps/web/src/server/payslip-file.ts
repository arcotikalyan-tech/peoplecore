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

/** The financial year a month falls in, as tax declarations name it: April 2026 to March 2027 is "2026-27". */
const fyOf = (month: string) => {
  const y = Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < 4 ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

/** "4th Floor, …, HSR Layout," then "Bengaluru, Karnataka - 560102", as a letterhead prints a registered office. */
function addressLines(a: { line1: string; line2: string | null; city: string; state: string | null; pincode: string | null } | null | undefined) {
  if (!a) return [];
  const second = `${[a.city, a.state].filter(Boolean).join(', ')}${a.pincode ? ` - ${a.pincode}` : ''}`;
  return [`${[a.line1, a.line2].filter(Boolean).join(', ')},`, second].filter((l) => l && l !== ',');
}

/**
 * One payslip as a PDF, read with the caller's own client (the website's session, or the phone app's token): RLS
 * decides whose payslips come back, so this never widens access. Null when there is no such payslip for them.
 *
 * The PAN, UAN and bank account print in full, as on any payslip, so they are read with the audited reveal calls
 * (the employee's own, or payroll's); someone without that access gets the masked values instead.
 */
export async function payslipFile(supabase: SupabaseClient<Database>, orgId: string, orgName: string, runId: string, employeeId: string) {
  const [row, lines, employee, settings, company, address, org] = await Promise.all([
    supabase.from('payroll_run_employees').select('*').eq('organization_id', orgId).eq('run_id', runId).eq('employee_id', employeeId).maybeSingle(),
    supabase.from('payroll_line_items').select('code, name, kind, amount').eq('run_id', runId).eq('employee_id', employeeId).order('id'),
    supabase.from('employees').select('first_name, middle_name, last_name, employee_code, department_id, designation_id, location_id, date_of_joining').eq('organization_id', orgId).eq('id', employeeId).maybeSingle(),
    supabase.from('payroll_settings').select('payslip_show_paise, default_regime').eq('organization_id', orgId).maybeSingle(),
    supabase.from('company_profiles').select('logo_path, legal_name').eq('organization_id', orgId).maybeSingle(),
    supabase.from('company_addresses').select('line1, line2, city, state, pincode').eq('organization_id', orgId).eq('kind', 'registered').limit(1).maybeSingle(),
    supabase.from('organizations').select('timezone').eq('id', orgId).maybeSingle(),
  ]);
  const slip = row.data;
  const emp = employee.data;
  if (!slip || !emp || lines.error) return null;
  const reveal = async <T,>(full: PromiseLike<{ data: T[] | null; error: unknown }>, masked: PromiseLike<{ data: T[] | null; error: unknown }>) => {
    const a = await full;
    if (!a.error && a.data?.[0]) return a.data[0];
    const b = await masked;
    return b.error ? null : b.data?.[0] ?? null;
  };
  const [department, designation, location, personal, declaration, identity, bank, logo] = await Promise.all([
    emp.department_id ? supabase.from('departments').select('name').eq('organization_id', orgId).eq('id', emp.department_id).maybeSingle() : null,
    emp.designation_id ? supabase.from('designations').select('title').eq('organization_id', orgId).eq('id', emp.designation_id).maybeSingle() : null,
    emp.location_id ? supabase.from('locations').select('name').eq('organization_id', orgId).eq('id', emp.location_id).maybeSingle() : null,
    supabase.from('employee_personal').select('date_of_birth').eq('organization_id', orgId).eq('employee_id', employeeId).maybeSingle(),
    supabase.from('tax_declarations').select('regime').eq('organization_id', orgId).eq('employee_id', employeeId).eq('fy', fyOf(slip.period_month)).maybeSingle(),
    reveal(supabase.rpc('reveal_employee_identity', { p_employee: employeeId }), supabase.rpc('employee_identity_summary', { p_employee: employeeId })),
    reveal(supabase.rpc('reveal_employee_bank_account', { p_employee: employeeId }), supabase.rpc('employee_bank_summary', { p_employee: employeeId })),
    logoFor(company.data?.logo_path),
  ]);
  const of = (kind: string) => (lines.data ?? []).filter((l) => l.kind === kind).map((l) => ({ name: l.name, amount: Number(l.amount) }));
  const input = (slip.input ?? {}) as { daysInPeriod?: number | string };
  const pdf = payslipPdf({
    organization: orgName,
    company: { legalName: company.data?.legal_name ?? null, addressLines: addressLines(address.data) },
    periodMonth: slip.period_month,
    employee: {
      name: [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(' '),
      code: emp.employee_code,
      department: department?.data?.name ?? null,
      designation: designation?.data?.title ?? null,
      location: location?.data?.name ?? null,
      dateOfBirth: personal.data?.date_of_birth ?? null,
      joiningDate: emp.date_of_joining,
      uan: identity?.uan ?? null,
      pan: identity?.pan ?? null,
    },
    regime: declaration.data?.regime ?? settings.data?.default_regime ?? null,
    standardDays: input.daysInPeriod !== undefined ? Number(input.daysInPeriod) : null,
    payableDays: Number(slip.payable_days),
    lopDays: Number(slip.lop_days),
    payment: bank?.account_number ? { mode: 'BANK TRANSFER', accountNumber: bank.account_number } : undefined,
    earnings: of('earning'),
    deductions: of('deduction'),
    totals: { gross: Number(slip.gross), deductions: Number(slip.deductions), net: Number(slip.net) },
    showPaise: settings.data?.payslip_show_paise ?? true,
    logo,
    generatedAt: new Date(),
    timeZone: org.data?.timezone ?? 'Asia/Kolkata',
  });
  return { pdf, fileName: `payslip-${slip.period_month.slice(0, 7)}-${emp.employee_code.replace(/[^\w-]/g, '')}.pdf` };
}
