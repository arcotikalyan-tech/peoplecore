import Link from 'next/link';
import { ASSIGNMENT_CHANGE_REASON_LABELS, EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { EditableSection } from '@/components/editable-section';
import { EmployeeStatusBadge } from '@/components/status-badge';
import { Ring } from '@/components/ui/charts';
import { Badge, Card, CardHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { employeeHoldings } from '@/server/assets';
import { activityForEmployee, type AuditEvent } from '@/server/audit';
import { employeeNames, getEmploymentHistory, managerOptions, namesForUsers } from '@/server/employees';
import { getPlans } from '@/server/onboarding';
import { separationFor } from '@/server/profile';
import { structureOptions } from '@/server/structure';
import { changeAssignmentAction } from '../../actions';
import { updateWorkDetailsAction } from '../actions';
import { AssignmentForm } from '../assignment-form';
import { WorkDetailsForm } from '../profile-forms';
import { daysBetween, Fields, Panel, tenure, type ProfileProps } from './shared';

const SUBJECTS: Record<string, string> = {
  employees: 'the profile',
  employment_records: 'an employment-history entry',
  employee_personal: 'personal details',
  emergency_contacts: 'an emergency contact',
  employee_identity: 'identity details',
  employee_bank_accounts: 'bank details',
  employee_documents: 'a document',
  employee_qualifications: 'a qualification',
  employee_family_members: 'a family member',
};

function describeActivity(a: AuditEvent): string {
  const subject = SUBJECTS[a.entity_type] ?? humanize(a.entity_type).toLowerCase();
  if (a.action === 'reveal') return `viewed the full ${subject}`;
  if (a.action === 'download') return `downloaded ${subject}`;
  // Documents are soft-deleted: the update that sets deleted_at is the deletion.
  if (a.entity_type === 'employee_documents' && a.action === 'update' && a.changes && typeof a.changes === 'object'
      && !Array.isArray(a.changes) && 'deleted_at' in a.changes) return `deleted ${subject}`;
  const verb = a.action === 'insert' ? (a.entity_type === 'employees' ? 'created' : 'added') : a.action === 'update' ? 'updated' : 'removed';
  return `${verb} ${subject}`;
}

/** Work: basic info, work info, resignation info, career progression and tenure; HR also changes assignments here. */
export async function WorkTab(p: ProfileProps) {
  const { ctx, slug, base, id, employee, today, structure, names } = p;
  const orgId = ctx.org.id;
  const canEditWork = ctx.can('employee.update', 'org');
  const canAudit = ctx.can('audit.read', 'org');
  const [history, managers, onboarding, holdings, separation] = await Promise.all([
    getEmploymentHistory(orgId, id),
    canEditWork ? managerOptions(orgId) : Promise.resolve([]),
    getPlans(orgId, { employeeId: id, status: 'in_progress' }),
    ctx.can('asset.manage', 'org') ? employeeHoldings(id) : Promise.resolve(null),
    separationFor(orgId, id),
  ]);
  const activity = canAudit ? await activityForEmployee(orgId, id, history.map((h) => h.id)) : [];
  const [actors, historyNames] = await Promise.all([
    namesForUsers(orgId, activity.map((a) => a.actor_user_id).filter((x): x is string => !!x)),
    employeeNames(orgId, history.map((h) => h.manager_employee_id).filter((x): x is string => !!x)),
  ]);
  const plan = onboarding[0];

  const dept = new Map(structure.departments.map((d) => [d.id, d]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const entity = new Map(structure.legalEntities.map((l) => [l.id, l.name]));
  const lookup = (m: Map<string, string>, k: string | null) => (k ? (m.get(k) ?? 'Archived') : null);
  const d = employee.department_id ? dept.get(employee.department_id) : undefined;
  const parent = d?.parent_id ? dept.get(d.parent_id) : undefined;

  const t = tenure(employee.date_of_joining, employee.date_of_exit && employee.date_of_exit < today ? employee.date_of_exit : today);
  const probationDays = employee.probation_end_date ? daysBetween(employee.date_of_joining, employee.probation_end_date) : 0;
  const onProbation = !employee.confirmed_on && !!employee.probation_end_date && employee.probation_end_date >= today;
  const probationStatus = employee.confirmed_on ? `Confirmed on ${formatDate(employee.confirmed_on)}` : onProbation ? 'On Probation'
    : employee.probation_end_date ? 'Probation ended — not confirmed' : 'No probation';
  const promotions = history.filter((h) => h.change_reason === 'promotion').length;
  const canOpen = ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team');
  const manager = employee.manager_employee_id
    ? (names.has(employee.manager_employee_id)
      ? !canOpen ? names.get(employee.manager_employee_id) : <Link className="text-primary hover:underline" href={`${base}/employees/${employee.manager_employee_id}`}>{names.get(employee.manager_employee_id)}</Link>
      : <span className="text-muted">Not visible to you</span>)
    : null;
  // A ring that fills over five years: Kredily's tenure dial.
  const tenurePct = Math.min(100, (t.total / 60) * 100);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <EditableSection key={`work:${employee.updated_at}`} title="Basic Info" canEdit={canEditWork}
          view={<Fields items={[
            { label: 'Employee ID', value: employee.employee_code },
            { label: 'Date of joining', value: formatDate(employee.date_of_joining) },
            { label: 'Probation period', value: `${probationDays} days` },
            { label: 'Employee type', value: EMPLOYMENT_TYPE_LABELS[employee.employment_type] },
            { label: 'Work location', value: lookup(loc, employee.location_id) },
            { label: 'Probation status', value: probationStatus },
            { label: 'Work experience', value: `${t.years} yr ${t.months} mo here` },
            { label: 'Before joining', value: employee.prior_experience_months === null ? null : `${Math.floor(employee.prior_experience_months / 12)} yr ${employee.prior_experience_months % 12} mo` },
            { label: 'Total experience', value: (() => { const m = t.years * 12 + t.months + (employee.prior_experience_months ?? 0); return `${Math.floor(m / 12)} yr ${m % 12} mo`; })() },
            { label: 'Billing status', value: employee.billable ? 'Billable' : 'Non-Billable' },
            { label: 'Legal entity', value: lookup(entity, employee.legal_entity_id) },
            { label: 'Work email', value: employee.work_email },
            { label: 'Work phone', value: employee.work_phone },
            { label: 'Reporting manager', value: manager },
          ]} />}>
          <WorkDetailsForm action={updateWorkDetailsAction.bind(null, slug, id)} legalEntities={structureOptions(structure).legalEntities}
            defaults={{
              firstName: employee.first_name, middleName: employee.middle_name, lastName: employee.last_name, workEmail: employee.work_email,
              workPhone: employee.work_phone, probationEndDate: employee.probation_end_date, legalEntityId: employee.legal_entity_id,
              jobTitle: employee.job_title, billable: employee.billable ? 'yes' : 'no',
              priorYears: employee.prior_experience_months === null ? null : String(Math.floor(employee.prior_experience_months / 12)),
              priorMonths: employee.prior_experience_months === null ? null : String(employee.prior_experience_months % 12),
            }} />
        </EditableSection>

        <Panel title="Work Info">
          <Fields cols={2} items={[
            { label: 'Designation', value: lookup(desig, employee.designation_id) },
            { label: 'Job title', value: employee.job_title ?? lookup(desig, employee.designation_id) },
            { label: 'Department', value: parent ? parent.name : d?.name ?? (employee.department_id ? 'Archived' : null) },
            { label: 'Sub department', value: parent ? d?.name : null },
          ]} />
        </Panel>

        <Panel title="Resignation Info">
          <Fields cols={2} items={[
            { label: 'Employee status', value: <EmployeeStatusBadge status={employee.status} /> },
            { label: 'Resignation date', value: separation?.type === 'resignation' ? formatDate(separation.submitted_on) : null },
            { label: 'Resignation status', value: separation ? humanize(separation.status) : null },
            { label: 'Notice period', value: separation ? `${separation.notice_days} days` : null },
            { label: 'Last working day', value: separation ? formatDate(separation.last_working_day) : employee.date_of_exit ? formatDate(employee.date_of_exit) : null },
          ]} />
        </Panel>

        <Card>
          <CardHeader title="Employment history" description="Career progression. Effective-dated; past entries are never overwritten." />
          <ol className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Badge tone={h.effective_to ? 'neutral' : 'primary'}>{ASSIGNMENT_CHANGE_REASON_LABELS[h.change_reason]}</Badge>
                    {h.effective_from > today && <Badge tone="warning">Scheduled</Badge>}
                  </span>
                  <span className="text-xs text-muted">
                    {h.effective_from > today ? `From ${formatDate(h.effective_from)}`
                      : `${formatDate(h.effective_from)} – ${h.effective_to ? formatDate(h.effective_to) : 'Present'}`}
                  </span>
                </div>
                <p className="mt-2 font-medium">
                  {[lookup(desig, h.designation_id), h.department_id ? (dept.get(h.department_id)?.name ?? 'Archived') : null, lookup(loc, h.location_id)].filter(Boolean).join(' · ') || (
                    <span className="font-normal text-muted">No placement recorded</span>
                  )}
                </p>
                {h.manager_employee_id && <p className="mt-1 text-muted">Reports to {historyNames.get(h.manager_employee_id) ?? 'a manager not visible to you'}</p>}
                {h.notes && <p className="mt-1 text-muted">{h.notes}</p>}
              </li>
            ))}
          </ol>
        </Card>

        {canEditWork && (
          <Card>
            <CardHeader title="Change assignment" description="Transfers, promotions and manager changes close the current history entry and open a new one." />
            <AssignmentForm action={changeAssignmentAction.bind(null, slug)} employeeId={employee.id} today={today}
              current={{ departmentId: employee.department_id, designationId: employee.designation_id, locationId: employee.location_id, managerEmployeeId: employee.manager_employee_id }}
              options={{ ...structureOptions(structure), managers }} />
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <section aria-label="Tenure" className="lift-soft rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-col items-center">
            <Ring pct={tenurePct} label="Tenure" />
            <p className="mt-2 font-semibold">{t.years} years, {t.months} months</p>
          </div>
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex gap-3"><span aria-hidden="true">🗓️</span><span><span className="block text-xs text-muted">Joined</span>{formatDate(employee.date_of_joining)}</span></li>
            <li className="flex gap-3"><span aria-hidden="true">📈</span><span><span className="block text-xs text-muted">Promotions</span>{promotions} role change{promotions === 1 ? '' : 's'}</span></li>
            <li className="flex gap-3"><span aria-hidden="true">📍</span><span><span className="block text-xs text-muted">Location</span>{lookup(loc, employee.location_id) ?? '—'}</span></li>
            <li className="flex gap-3"><span aria-hidden="true">↑</span><span><span className="block text-xs text-muted">Reports to</span>{manager ?? '—'}</span></li>
          </ul>
        </section>

        {plan && (
          <Card>
            <CardHeader title="Onboarding" description={`${plan.done} of ${plan.tasks.length} tasks done`} />
            <ul className="space-y-1 px-5 py-4 text-sm" aria-label="Onboarding tasks">
              {plan.tasks.map((task) => (
                <li key={task.id} className="flex justify-between gap-2">
                  <span className={task.status === 'open' ? '' : 'text-muted line-through'}>{task.title}</span>
                  {task.due_on && <span className="shrink-0 text-xs text-muted">{formatDate(task.due_on)}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {holdings && (
          <Card>
            <CardHeader title="Assets and access" description="What they hold now. Recovered or revoked when they leave." />
            {holdings.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing issued and no access recorded.</p> : (
              <ul className="divide-y divide-line" aria-label="Assets and access">
                {holdings.map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-2 px-5 py-3 text-sm">
                    <span><span className="font-medium">{h.item}</span><span className="block text-xs text-muted">{h.detail} · since {formatDate(h.since)}</span></span>
                    <Badge tone={h.kind === 'asset' ? 'primary' : 'neutral'}>{h.kind === 'asset' ? 'Asset' : 'Access'}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line px-5 py-3 text-sm">
              <Link className="text-primary hover:underline" href={`${base}/assets`}>Assets</Link>
              <span className="text-muted"> · </span>
              <Link className="text-primary hover:underline" href={`${base}/assets/access`}>System access</Link>
            </p>
          </Card>
        )}

        {canAudit && (
          <Card>
            <CardHeader title="Activity" description="From the append-only audit log, including who viewed restricted details." />
            {activity.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No activity recorded.</p> : (
              <ul className="divide-y divide-line">
                {activity.map((a) => (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <p>
                      <span className="font-medium">{a.actor_user_id ? (actors.get(a.actor_user_id) ?? 'A user') : 'System'}</span>{' '}
                      {describeActivity(a)}
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
  );
}
