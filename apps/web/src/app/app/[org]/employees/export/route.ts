import { NextResponse, type NextRequest } from 'next/server';
import { EMPLOYMENT_TYPE_LABELS, employeeListQuerySchema, legalName, todayIn, toCsv } from '@peoplecore/shared';
import { getOrgContext } from '@/server/context';
import { exportEmployees } from '@/server/employees';
import { createClient } from '@/server/supabase';

/**
 * CSV of the employee directory with the current filters. Needs employee.export (org-wide). The export is
 * recorded in the audit log (log_employee_export) before any data leaves; if that refuses, nothing does.
 * Work fields only: personal, identity and bank details are never exported.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('employee.export', 'org')) return new NextResponse('Not found', { status: 404 });

  const { page: _page, ...filters } = employeeListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const { rows, truncated } = await exportEmployees(ctx.org.id, filters);

  const supabase = await createClient();
  const [structure, audit] = await Promise.all([
    Promise.all([
      supabase.from('departments').select('id, name').eq('organization_id', ctx.org.id),
      supabase.from('designations').select('id, title').eq('organization_id', ctx.org.id),
      supabase.from('locations').select('id, name').eq('organization_id', ctx.org.id),
    ]),
    supabase.rpc('log_employee_export', {
      p_org: ctx.org.id,
      p_filters: { ...filters, ...(truncated ? { truncated: true } : {}) },
      p_row_count: rows.length,
    }),
  ]);
  if (audit.error) return new NextResponse('Not found', { status: 404 });
  const [departments, designations, locations] = structure;
  const name = <T extends { id: string }>(r: { data: T[] | null }, field: keyof T) =>
    new Map((r.data ?? []).map((x) => [x.id, String(x[field])]));
  const dept = name(departments, 'name');
  const desig = name(designations, 'title');
  const loc = name(locations, 'name');
  const code = new Map(rows.map((r) => [r.id, r.employee_code]));

  const csv = toCsv(
    ['Employee code', 'Name', 'Work email', 'Work phone', 'Status', 'Employment type', 'Date of joining', 'Probation ends',
      'Date of exit', 'Department', 'Designation', 'Location', 'Manager code'],
    rows.map((r) => [
      r.employee_code, legalName(r), r.work_email, r.work_phone, r.status, EMPLOYMENT_TYPE_LABELS[r.employment_type],
      r.date_of_joining, r.probation_end_date, r.date_of_exit,
      r.department_id ? dept.get(r.department_id) : null,
      r.designation_id ? desig.get(r.designation_id) : null,
      r.location_id ? loc.get(r.location_id) : null,
      r.manager_employee_id ? (code.get(r.manager_employee_id) ?? null) : null,
    ]),
  );
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="employees-${slug}-${todayIn(ctx.org.timezone)}.csv"`,
      'Cache-Control': 'no-store',
      ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
    },
  });
}
