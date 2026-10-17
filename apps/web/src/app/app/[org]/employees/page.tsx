import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS, employeeListQuerySchema, legalName, type EmployeeListQuery } from '@peoplecore/shared';
import { EmployeeStatusBadge } from '@/components/status-badge';
import { Button, ButtonLink, buttonClass } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { listEmployees } from '@/server/employees';
import { getStructure } from '@/server/structure';

export const metadata: Metadata = { title: 'Employees' };

function href(base: string, q: EmployeeListQuery, page: number) {
  const sp = new URLSearchParams();
  if (q.q) sp.set('q', q.q);
  if (q.status) sp.set('status', q.status);
  if (q.department) sp.set('department', q.department);
  if (page > 1) sp.set('page', String(page));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** The directory's filters (not the page) as export query parameters. */
function exportParams(query: { q?: string; status?: string; department?: string }) {
  const params = new URLSearchParams();
  for (const key of ['q', 'status', 'department'] as const) if (query[key]) params.set(key, query[key]);
  return params.toString();
}

export default async function EmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('employee.read')) notFound();

  const query = employeeListQuerySchema.parse(await searchParams);
  const base = `/app/${slug}/employees`;
  const [result, structure] = await Promise.all([listEmployees(ctx.org.id, query), getStructure(ctx.org.id)]);
  if (result.outOfRange) redirect(href(base, query, 1));

  const departments = new Map(structure.departments.map((d) => [d.id, d.name]));
  const designations = new Map(structure.designations.map((d) => [d.id, d.title]));
  const filtered = Boolean(query.q || query.status || query.department);
  const scopeNote = ctx.can('employee.read', 'org')
    ? undefined
    : ctx.can('employee.read', 'team')
      ? 'Showing you and the people in your reporting line.'
      : 'Showing your own record.';

  return (
    <>
      <PageHeader
        title="Employees"
        description={scopeNote}
        actions={
          <div className="flex gap-2">
            {/* A plain link to a route handler: it checks employee.export and records the export first. */}
            {ctx.can('employee.export', 'org') && (
              <a className={buttonClass('secondary')} href={`${base}/export?${exportParams(query)}`} download>
                Export CSV
              </a>
            )}
            {ctx.can('employee.create', 'org') && <ButtonLink href={`${base}/import`} variant="secondary">Import</ButtonLink>}
            {ctx.can('employee.create') && <ButtonLink href={`${base}/new`}>Add employee</ButtonLink>}
          </div>
        }
      />
      <Card>
        <form role="search" className="flex flex-wrap items-end gap-3 border-b border-line p-4" action={base}>
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-medium text-muted">Search</label>
            <input
              id="q" name="q" type="search" defaultValue={query.q} placeholder="Name, employee code or email"
              className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div>
            <label htmlFor="status" className="mb-1.5 block text-xs font-medium text-muted">Status</label>
            <select id="status" name="status" defaultValue={query.status ?? ''} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
              <option value="">All statuses</option>
              {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="department" className="mb-1.5 block text-xs font-medium text-muted">Department</label>
            <select id="department" name="department" defaultValue={query.department ?? ''} className="h-9 max-w-56 rounded-md border border-line-strong bg-surface px-2 text-sm">
              <option value="">All departments</option>
              {structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <Button type="submit" variant="secondary" size="sm" className="h-9">Apply</Button>
          {filtered && <Link href={base} className="h-9 content-center text-sm text-muted hover:text-fg">Clear</Link>}
        </form>

        {result.rows.length === 0 ? (
          filtered ? (
            <EmptyState title="No employees match these filters" action={<ButtonLink href={base} variant="secondary" size="sm">Clear filters</ButtonLink>} />
          ) : (
            <EmptyState
              title="No employees yet"
              description={ctx.can('employee.create') ? 'Add your first employee to start building your directory.' : undefined}
              action={ctx.can('employee.create') && <ButtonLink href={`${base}/new`} size="sm">Add employee</ButtonLink>}
            />
          )
        ) : (
          <>
            <Table caption="Employees">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Code</Th>
                  <Th>Department</Th>
                  <Th>Designation</Th>
                  <Th>Status</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((e) => (
                  <tr key={e.id} className="hover:bg-subtle/60">
                    <Td>
                      <Link href={`${base}/${e.id}`} className="font-medium text-fg hover:text-primary hover:underline">{legalName(e)}</Link>
                      {e.work_email && <div className="text-xs text-muted">{e.work_email}</div>}
                    </Td>
                    <Td className="tabular-nums text-muted">{e.employee_code}</Td>
                    <Td>{e.department_id ? departments.get(e.department_id) : <span className="text-muted">—</span>}</Td>
                    <Td>{e.designation_id ? designations.get(e.designation_id) : <span className="text-muted">—</span>}</Td>
                    <Td><EmployeeStatusBadge status={e.status} /></Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(e.date_of_joining)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} hrefFor={(p) => href(base, query, p)} />
          </>
        )}
      </Card>
    </>
  );
}
