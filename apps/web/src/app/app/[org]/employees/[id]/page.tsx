import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import {
  ASSIGNMENT_CHANGE_REASON_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  GENDER_LABELS,
  legalName,
  todayIn,
  type PermissionKey,
} from '@peoplecore/shared';
import { EditableSection } from '@/components/editable-section';
import { EmployeeStatusBadge } from '@/components/status-badge';
import { Alert, Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { employeeHoldings } from '@/server/assets';
import { activityForEmployee, type AuditEvent } from '@/server/audit';
import { getOrgContext } from '@/server/context';
import { employeeNames, getEmployee, getEmploymentHistory, managerOptions, namesForUsers } from '@/server/employees';
import { listDocuments } from '@/server/documents';
import { getPlans } from '@/server/onboarding';
import { getCompensation } from '@/server/payroll';
import { setCompensationAction, setStatutoryAction } from '../../payroll/actions';
import { inr } from '../../payroll/format';
import { CompensationForm, StatutoryForm } from '../../payroll/payroll-forms';
import { getBankSummary, getIdentitySummary, getPersonalDetails } from '@/server/sensitive';
import { getStructure, structureOptions } from '@/server/structure';
import { changeAssignmentAction } from '../actions';
import {
  addEmergencyContactAction,
  deleteDocumentAction,
  removeEmergencyContactAction,
  revealBankAction,
  revealIdentityAction,
  saveBankAccountAction,
  saveIdentityAction,
  savePersonalDetailsAction,
  updateWorkDetailsAction,
  uploadDocumentAction,
} from './actions';
import { AssignmentForm } from './assignment-form';
import { DocumentsPanel } from './documents-panel';
import { EmergencyContacts, PersonalDetailsForm, WorkDetailsForm } from './profile-forms';
import { BankPanel, IdentityPanel } from './sensitive-panels';

export const metadata: Metadata = { title: 'Employee' };

const SUBJECTS: Record<string, string> = {
  employees: 'the profile',
  employment_records: 'an employment-history entry',
  employee_personal: 'personal details',
  emergency_contacts: 'an emergency contact',
  employee_identity: 'identity details',
  employee_bank_accounts: 'bank details',
  employee_documents: 'a document',
};

const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

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

  // UI gating mirrors the database rules (which enforce them regardless): org-wide, or self for own record.
  const isSelf = employee.user_id === ctx.user.id;
  const allowed = (key: PermissionKey) => ctx.can(key, 'org') || (isSelf && ctx.can(key, 'self'));
  const canEditWork = ctx.can('employee.update', 'org');
  const canAudit = ctx.can('audit.read', 'org');

  const [history, structure, managers, personal, identity, bank, documents, onboarding, compensation, holdings] = await Promise.all([
    getEmploymentHistory(orgId, id),
    getStructure(orgId),
    canEditWork ? managerOptions(orgId) : Promise.resolve([]),
    allowed('employee.personal.read') ? getPersonalDetails(orgId, id) : Promise.resolve(null),
    allowed('employee.identity.read') ? getIdentitySummary(id) : Promise.resolve(null),
    allowed('employee.bank.read') ? getBankSummary(id) : Promise.resolve(null),
    allowed('employee.document.read') ? listDocuments(orgId, id) : Promise.resolve(null),
    getPlans(orgId, { employeeId: id, status: 'in_progress' }),
    allowed('compensation.read') || ctx.can('compensation.update', 'org') ? getCompensation(orgId, id) : Promise.resolve(null),
    ctx.can('asset.manage', 'org') ? employeeHoldings(id) : Promise.resolve(null),
  ]);
  const plan = onboarding[0];
  const activity = canAudit ? await activityForEmployee(orgId, id, history.map((h) => h.id)) : [];
  const [names, actors] = await Promise.all([
    employeeNames(orgId, [employee.manager_employee_id, ...history.map((h) => h.manager_employee_id)].filter((x): x is string => !!x)),
    namesForUsers(orgId, [...activity.map((a) => a.actor_user_id), ...(documents ?? []).map((d) => d.uploaded_by)]
      .filter((x): x is string => !!x)),
  ]);

  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const entity = new Map(structure.legalEntities.map((l) => [l.id, l.name]));
  // Structure rows are visible to every member, so a miss means the item was archived.
  const lookup = (m: Map<string, string>, k: string | null) => (k ? (m.get(k) ?? 'Archived') : null);
  const base = `/app/${slug}`;
  const today = todayIn(ctx.org.timezone);
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
  const p = personal?.personal;
  const address = p ? [p.address_line1, p.address_line2, p.city, p.state_code, p.postal_code].filter(Boolean).join(', ') : '';

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
          <EditableSection
            key={`work:${employee.updated_at}`}
            title="Work details"
            canEdit={canEditWork}
            view={
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
            }
          >
            <WorkDetailsForm
              action={updateWorkDetailsAction.bind(null, slug, id)}
              legalEntities={structureOptions(structure).legalEntities}
              defaults={{
                firstName: employee.first_name,
                middleName: employee.middle_name,
                lastName: employee.last_name,
                workEmail: employee.work_email,
                workPhone: employee.work_phone,
                probationEndDate: employee.probation_end_date,
                legalEntityId: employee.legal_entity_id,
              }}
            />
          </EditableSection>

          {personal && (
            <EditableSection
              key={`personal:${p?.updated_at ?? 'none'}`}
              title="Personal details"
              description={isSelf ? 'Visible to you and HR.' : 'Visible to HR and the employee.'}
              canEdit={allowed('employee.personal.update')}
              view={
                <>
                  {p ? (
                    <DetailList
                      items={[
                        { label: 'Date of birth', value: p.date_of_birth ? formatDate(p.date_of_birth) : null },
                        { label: 'Gender', value: p.gender ? GENDER_LABELS[p.gender] : null },
                        { label: 'Personal email', value: p.personal_email },
                        { label: 'Personal phone', value: p.personal_phone },
                        { label: 'Address', value: address || null },
                      ]}
                    />
                  ) : (
                    <p className="px-5 py-4 text-sm text-muted">No personal details recorded.</p>
                  )}
                  <EmergencyContacts
                    contacts={personal.contacts}
                    canEdit={allowed('employee.personal.update')}
                    add={addEmergencyContactAction.bind(null, slug, id)}
                    remove={removeEmergencyContactAction.bind(null, slug, id)}
                  />
                </>
              }
            >
              <PersonalDetailsForm
                action={savePersonalDetailsAction.bind(null, slug, id)}
                defaults={{
                  dateOfBirth: p?.date_of_birth,
                  gender: p?.gender,
                  personalEmail: p?.personal_email,
                  personalPhone: p?.personal_phone,
                  addressLine1: p?.address_line1,
                  addressLine2: p?.address_line2,
                  city: p?.city,
                  stateCode: p?.state_code,
                  postalCode: p?.postal_code,
                }}
              />
            </EditableSection>
          )}

          {identity && (
            <Card>
              <CardHeader title="Identity numbers" description="PAN, PF, ESIC and passport. Restricted access." />
              <IdentityPanel
                key={`identity:${identity.updated_at ?? 'none'}`}
                summary={identity}
                reveal={revealIdentityAction.bind(null, slug, id)}
                save={saveIdentityAction.bind(null, slug, id)}
              />
            </Card>
          )}

          {bank && (
            <Card>
              <CardHeader title="Bank account" description="Used for salary payments. Restricted access." />
              <BankPanel
                key={`bank:${bank.since ?? 'none'}`}
                summary={bank}
                reveal={revealBankAction.bind(null, slug, id)}
                save={saveBankAccountAction.bind(null, slug, id)}
              />
            </Card>
          )}

          {documents && (
            <Card>
              <CardHeader title="Documents" description="Stored privately. Every download is recorded." />
              <DocumentsPanel
                documents={documents.map((d) => ({
                  id: d.id,
                  category: d.category,
                  title: d.title,
                  fileName: d.file_name,
                  size: formatBytes(d.size_bytes),
                  uploaded: formatDateTime(d.created_at, ctx.org.timezone),
                  uploadedBy: d.uploaded_by ? (actors.get(d.uploaded_by) ?? null) : null,
                }))}
                downloadHref={`${base}/employees/${id}/documents`}
                upload={allowed('employee.document.upload') ? uploadDocumentAction.bind(null, slug, id) : undefined}
                remove={allowed('employee.document.delete') ? deleteDocumentAction.bind(null, slug, id) : undefined}
              />
            </Card>
          )}

          {compensation && (
            <Card>
              <CardHeader title="Compensation" description={compensation.current
                ? `${inr.format(Number(compensation.current.annual_ctc))} a year since ${formatDate(compensation.current.effective_from)}`
                : 'No compensation on record.'} />
              {compensation.lines.length > 0 && (
                <ul className="divide-y divide-line text-sm" aria-label="Salary components">
                  {compensation.lines.map((l) => (
                    <li key={l.component_id} className="flex justify-between px-5 py-2">
                      <span>{compensation.components.find((c) => c.id === l.component_id)?.name ?? 'Component'}</span>
                      <span className="tabular-nums">{inr.format(Number(l.monthly_amount))} / month</span>
                    </li>
                  ))}
                </ul>
              )}
              {ctx.can('compensation.update', 'org') && (
                <CompensationForm action={setCompensationAction.bind(null, slug)} employeeId={id} today={today}
                  components={compensation.components.filter((c) => c.kind === 'earning').map((c) => ({ id: c.id, name: c.name }))}
                  current={Object.fromEntries(compensation.lines.map((l) => [l.component_id, Number(l.monthly_amount)]))} />
              )}
              {ctx.can('payroll.prepare', 'org') && (
                <StatutoryForm action={setStatutoryAction.bind(null, slug)} employeeId={id}
                  profile={{ pf: compensation.profile?.pf_applicable ?? true, esi: compensation.profile?.esi_applicable ?? null, ptState: compensation.profile?.pt_state ?? null }} />
              )}
            </Card>
          )}

          {canEditWork && (
            <Card>
              <CardHeader
                title="Change assignment"
                description="Transfers, promotions and manager changes close the current history entry and open a new one."
              />
              <AssignmentForm
                action={changeAssignmentAction.bind(null, slug)}
                employeeId={employee.id}
                today={today}
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
          {plan && (
            <Card>
              <CardHeader title="Onboarding" description={`${plan.done} of ${plan.tasks.length} tasks done`} />
              <ul className="space-y-1 px-5 py-4 text-sm" aria-label="Onboarding tasks">
                {plan.tasks.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className={t.status === 'open' ? '' : 'text-muted line-through'}>{t.title}</span>
                    {t.due_on && <span className="shrink-0 text-xs text-muted">{formatDate(t.due_on)}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {holdings && (
            <Card>
              <CardHeader title="Assets and access" description="What they hold now. Everything here is recovered or revoked when they leave." />
              {holdings.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing issued and no access recorded.</p> : (
                <ul className="divide-y divide-line" aria-label="Assets and access">
                  {holdings.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-2 px-5 py-3 text-sm">
                      <span>
                        <span className="font-medium">{h.item}</span>
                        <span className="block text-xs text-muted">{h.detail} · since {formatDate(h.since)}</span>
                      </span>
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
          <Card>
            <CardHeader title="Employment history" description="Effective-dated; past entries are never overwritten." />
            <ol className="divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={h.effective_to ? 'neutral' : 'primary'}>{ASSIGNMENT_CHANGE_REASON_LABELS[h.change_reason]}</Badge>
                      {h.effective_from > today && <Badge tone="warning">Scheduled</Badge>}
                    </span>
                    <span className="text-xs text-muted">
                      {h.effective_from > today
                        ? `From ${formatDate(h.effective_from)}`
                        : `${formatDate(h.effective_from)} – ${h.effective_to ? formatDate(h.effective_to) : 'present'}`}
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
              <CardHeader title="Activity" description="From the append-only audit log, including who viewed restricted details." />
              {activity.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No activity recorded.</p>
              ) : (
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
    </>
  );
}
