import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ASSIGNMENT_CHANGE_REASON_LABELS, EMPLOYMENT_TYPE_LABELS, legalName, todayIn } from '@peoplecore/shared';
import { EmployeeStatusBadge } from '@/components/status-badge';
import { Alert, Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { auditForEntities } from '@/server/audit';
import { getOrgContext } from '@/server/context';
import { employeeNames, getEmployee, getEmploymentHistory, managerOptions, namesForUsers } from '@/server/employees';
import { getStructure, structureOptions } from '@/server/structure';
import { changeAssignmentAction } from '../actions';
import { AssignmentForm } from './assignment-form';

export const metadata: Metadata = { title: 'Employee' };

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const orgId = ctx.org.id;

  // RLS decides visibility: an employee outside the caller's scope is simply not returned.
  const employee = await getEmployee(orgId, id);
  if (!employee) notFound();

  const canEdit = ctx.can('employee.update', 'org');
  const canAudit = ctx.can('audit.read', 'org');
  const [history, structure, managers] = await Promise.all([
    getEmploymentHistory(orgId, id),
    getStructure(orgId),
    canEdit ? managerOptions(orgId) : Promise.resolve([]),
  ]);
  const activity = canAudit ? await auditForEntities(orgId, [id, ...history.map((h) => h.id)]) : [];
  const [names, actors] = await Promise.all([
    employeeNames(orgId, [employee.manager_employee_id, ...history.map((h) => h.manager_employee_id)].filter((x): x is string => !!x)),
    namesForUsers(orgId, activity.map((a) => a.actor_user_id).filter((x): x is string => !!x)),
  ]);

  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const entity = new Map(structure.legalEntities.map((l) => [l.id, l.name]));
  // Structure rows are visible to every member, so a miss means the item was archived.
  const lookup = (m: Map<string, string>, k: string | null) => (k ? (m.get(k) ?? 'Archived') : null);
  const base = `/app/${slug}`;
  const { created } = await searchParams;

  const managerId = employee.manager_employee_id;
  const manager = managerId ? (
    names.has(managerId) ? (
      <Link className="text-primary hover:underline" href={`${base}/employees/${managerId}`}>{names.get(managerId)}</Link>
    ) : (
      <span className="text-muted">Not visible to you</span>
    )
  ) : null;

  const canBrowse = ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team');

  return (
    <>
      <PageHeader
        eyebrow={canBrowse ? <Link href={`${base}/employees`} className="hover:text-fg">← Employees</Link> : undefined}
        title={legalName(employee)}
        description={[lookup(desig, employee.designation_id), lookup(dept, employee.department_id)].filter(Boolean).join(' · ') || undefined}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-muted">{employee.employee_code}</span>
            <EmployeeStatusBadge status={employee.status} />
          </div>
        }
      />

      {created && (
        <div className="mb-6">
          <Alert tone="success" title="Employee created." />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Work details" />
            <DetailList
              items={[
                { label: 'Work email', value: employee.work_email },
                { label: 'Work phone', value: employee.work_phone },
                { label: 'Employment type', value: EMPLOYMENT_TYPE_LABELS[employee.employment_type] },
                { label: 'Date of joining', value: formatDate(employee.date_of_joining) },
                { label: 'Probation ends', value: employee.probation_end_date ? formatDate(employee.probation_end_date) : null },
                { label: 'Reporting manager', value: manager },
                { label: 'Location', value: lookup(loc, employee.location_id) },
                { label: 'Legal entity', value: lookup(entity, employee.legal_entity_id) },
              ]}
            />
          </Card>

          {canEdit && (
            <Card>
              <CardHeader
                title="Change assignment"
                description="Transfers, promotions and manager changes close the current history entry and open a new one."
              />
              <AssignmentForm
                action={changeAssignmentAction.bind(null, slug)}
                employeeId={employee.id}
                today={todayIn(ctx.org.timezone)}
                current={{
                  departmentId: employee.department_id,
                  designationId: employee.designation_id,
                  locationId: employee.location_id,
                  managerEmployeeId: employee.manager_employee_id,
                }}
                options={{ ...structureOptions(structure), managers }}
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Employment history" description="Effective-dated; past entries are never overwritten." />
            <ol className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={h.effective_to ? 'neutral' : 'primary'}>{ASSIGNMENT_CHANGE_REASON_LABELS[h.change_reason]}</Badge>
                    <span className="text-xs text-muted">
                      {formatDate(h.effective_from)} – {h.effective_to ? formatDate(h.effective_to) : 'present'}
                    </span>
                  </div>
                  <p className="mt-2">
                    {[lookup(desig, h.designation_id), lookup(dept, h.department_id), lookup(loc, h.location_id)].filter(Boolean).join(' · ') || (
                      <span className="text-muted">No placement recorded</span>
                    )}
                  </p>
                  {h.manager_employee_id && (
                    <p className="mt-1 text-muted">Reports to {names.get(h.manager_employee_id) ?? 'a manager not visible to you'}</p>
                  )}
                  {h.notes && <p className="mt-1 text-muted">{h.notes}</p>}
                </li>
              ))}
            </ol>
          </Card>

          {canAudit && (
            <Card>
              <CardHeader title="Activity" description="From the append-only audit log." />
              {activity.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No activity recorded.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {activity.map((a) => (
                    <li key={a.id} className="px-5 py-3 text-sm">
                      <p>
                        <span className="font-medium">{a.actor_user_id ? (actors.get(a.actor_user_id) ?? 'A user') : 'System'}</span>{' '}
                        {a.action === 'insert' ? 'created' : a.action === 'update' ? 'updated' : 'deleted'}{' '}
                        {a.entity_type === 'employees' ? 'the profile' : 'an employment-history entry'}
                        {a.action === 'update' && a.changes && typeof a.changes === 'object' && !Array.isArray(a.changes) && (
                          <span className="text-muted"> ({Object.keys(a.changes).map(humanize).join(', ')})</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{formatDateTime(a.occurred_at, ctx.org.timezone)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
