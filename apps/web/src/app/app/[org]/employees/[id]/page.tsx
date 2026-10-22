import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { legalName, todayIn, type PermissionKey } from '@peoplecore/shared';
import { EmployeeStatusBadge } from '@/components/status-badge';
import { Avatar } from '@/components/ui/avatar';
import { buttonClass } from '@/components/ui/button';
import { HubTabs } from '@/components/ui/hub';
import { Alert } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { signImageUrls } from '@/server/document-storage';
import { removePhotoAction, setPhotoAction } from '../photo-actions';
import { PictureForm } from '../photo-form';
import { employeeNames, getEmployee } from '@/server/employees';
import { directoryName, familyMembers, noticeDaysFor, profileDocuments, qualifications } from '@/server/profile';
import { getBankSummary, getIdentitySummary, getPersonalDetails } from '@/server/sensitive';
import { getStructure } from '@/server/structure';
import { AttendanceTab } from './_tabs/attendance';
import { DocumentsTab } from './_tabs/documents';
import { EducationTab } from './_tabs/education';
import { ExitTab } from './_tabs/exit';
import { ExpenseTab } from './_tabs/expense';
import { FamilyTab } from './_tabs/family';
import { FilesTab } from './_tabs/files';
import { LeaveTab } from './_tabs/leave';
import { PayrollTab } from './_tabs/payroll';
import { PersonalTab } from './_tabs/personal';
import { PmsTab } from './_tabs/pms';
import { tenure, type ProfileProps } from './_tabs/shared';
import { StationeryTab } from './_tabs/stationery';
import { TeamTab } from './_tabs/team';
import { WorkTab } from './_tabs/work';
import { WorkWeekTab } from './_tabs/workweek';

export const metadata: Metadata = { title: 'Profile' };

type Search = Record<string, string | undefined>;

/**
 * An employee's profile, Kredily's My Profile: a header card (status, tenure, manager, profile completeness) and
 * tabs for stationery, personal, work, team, education, family, documents, work week, attendance, leave, payroll,
 * expense, PMS, file manager and e-exit. RLS decides visibility; tabs the viewer can't use aren't shown.
 */
export default async function EmployeePage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<Search> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const orgId = ctx.org.id;

  // RLS decides visibility: an employee outside the caller's scope is simply not returned.
  const employee = await getEmployee(orgId, id);
  if (!employee) notFound();

  // UI gating mirrors the database rules (which enforce them regardless): org-wide, team, or self for own record.
  const isSelf = employee.user_id === ctx.user.id;
  const allowed = (key: PermissionKey) => ctx.can(key, 'org') || (isSelf && ctx.can(key, 'self'));
  const teamOrOrg = (key: PermissionKey) => allowed(key) || ctx.can(key, 'team');
  const today = todayIn(ctx.org.timezone);
  const base = `/app/${slug}`;
  const path = `${base}/employees/${id}`;
  const href = (tab: string, extra: Record<string, string> = {}) => `${path}?${new URLSearchParams({ tab, ...extra }).toString()}`;

  const readPersonal = allowed('employee.personal.read');
  const [structure, names, personal, identity, bank, quals, family, docs] = await Promise.all([
    getStructure(orgId),
    employeeNames(orgId, employee.manager_employee_id ? [employee.manager_employee_id] : []),
    readPersonal ? getPersonalDetails(orgId, id) : Promise.resolve(null),
    allowed('employee.identity.read') ? getIdentitySummary(id) : Promise.resolve(null),
    allowed('employee.bank.read') ? getBankSummary(id) : Promise.resolve(null),
    readPersonal ? qualifications(orgId, id) : Promise.resolve(null),
    readPersonal ? familyMembers(orgId, id) : Promise.resolve(null),
    allowed('employee.document.read') ? profileDocuments(orgId, id) : Promise.resolve(null),
  ]);

  const mid = employee.manager_employee_id;
  if (mid && !names.has(mid)) {
    const n = await directoryName(orgId, mid);
    if (n) names.set(mid, n);
  }

  const tabs = [
    { key: 'stationery', label: 'Stationery', show: isSelf || allowed('employee.document.read') },
    { key: 'personal', label: 'Personal', show: true },
    { key: 'work', label: 'Work', show: true },
    { key: 'team', label: 'Team', show: true },
    { key: 'education', label: 'Education', show: readPersonal },
    { key: 'family', label: 'Family', show: readPersonal },
    { key: 'documents', label: 'Documents', show: allowed('employee.document.read') || !!identity },
    { key: 'workweek', label: 'Work Week', show: teamOrOrg('attendance.read') },
    { key: 'attendance', label: 'Attendance', show: teamOrOrg('attendance.read') },
    { key: 'leave', label: 'Leave', show: teamOrOrg('leave.read') },
    { key: 'payroll', label: 'Payroll', show: isSelf || allowed('compensation.read') || ctx.can('compensation.update', 'org') || !!bank },
    { key: 'expense', label: 'Expense', show: isSelf || ctx.can('expense.manage', 'org') },
    { key: 'pms', label: 'PMS', show: teamOrOrg('performance.read') },
    { key: 'files', label: 'File Manager', show: isSelf },
    { key: 'exit', label: 'E-Exit', show: isSelf || ctx.can('separation.manage', 'org') },
  ].filter((t) => t.show);
  const defaultTab = readPersonal ? 'personal' : 'work';
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : defaultTab;

  // Profile completeness (Kredily's ring): what an employee can fill in about themselves.
  const p = personal?.personal;
  const checks = personal ? [
    !!p?.date_of_birth, !!p?.gender, !!p?.blood_group, !!p?.marital_status, !!p?.personal_email, !!p?.personal_phone,
    !!p?.address_line1, !!(p?.perm_same_as_current || p?.perm_address_line1), personal.contacts.length > 0,
    (quals?.length ?? 0) > 0, (family?.length ?? 0) > 0,
    ...(docs ? [docs.some((d) => d.category === 'identity')] : []),
    ...(identity ? [!!identity.pan] : []),
    ...(bank ? [!!bank.account_number] : []),
  ] : null;
  const complete = checks ? Math.round((checks.filter(Boolean).length / checks.length) * 100) : null;

  const desig = structure.designations.find((d) => d.id === employee.designation_id)?.title ?? null;
  const dept = structure.departments.find((d) => d.id === employee.department_id)?.name ?? null;
  const t = tenure(employee.date_of_joining, today);
  const onProbation = !employee.confirmed_on && !!employee.probation_end_date && employee.probation_end_date >= today;
  const managerName = employee.manager_employee_id ? (names.get(employee.manager_employee_id) ?? '—') : '—';
  const canBrowse = ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team');
  const chip = 'rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary';

  const photo = employee.photo_path ? (await signImageUrls([employee.photo_path])).get(employee.photo_path) ?? null : null;
  const canPhoto = isSelf || ctx.can('employee.update');
  const props: ProfileProps = { ctx, slug, base, id, employee, isSelf, allowed, today, sp, href, structure, names };
  const needNotice = tab === 'pms' || tab === 'exit';
  const noticeDays = needNotice ? await noticeDaysFor(orgId, employee.employment_type) : 0;

  return (
    <>
      {canBrowse && !isSelf && <p className="mb-3 text-sm"><Link href={`${base}/employees`} className="text-muted hover:text-fg">← People</Link></p>}
      {sp.created && <div className="mb-5"><Alert tone="success" title="Employee created." /></div>}

      <header className="lift-soft mb-5 flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-surface p-5">
        <Avatar name={legalName(employee)} src={photo} className="size-20! text-2xl!" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight">{legalName(employee)}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {[desig, dept].map((x) => x ?? '—').join(' · ')}
            {employee.work_email && <> · <a className="hover:text-fg" href={`mailto:${employee.work_email}`}>✉ {employee.work_email}</a></>}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={chip}>{employee.employee_code}</span>
            {onProbation ? <span className={chip}>Probation</span> : employee.confirmed_on ? <span className={chip}>Confirmed</span> : null}
            <EmployeeStatusBadge status={employee.status} />
            <span className={chip}>⏱ {t.years} yr {t.months} mo</span>
            <span className={chip}>↑ Reports to {managerName}</span>
          </p>
          {canPhoto && (
            <div className="mt-3"><PictureForm field="photo" label={isSelf ? 'Your profile photo' : `Profile photo for ${legalName(employee)}`} has={!!employee.photo_path}
              action={setPhotoAction.bind(null, slug, id)} remove={removePhotoAction.bind(null, slug, id)} /></div>
          )}
        </div>
        {readPersonal && allowed('employee.personal.update') && (
          <Link href={href('personal')} className={buttonClass('primary', 'sm')}>✎ Update info</Link>
        )}
        {complete !== null && (
          <figure className="flex flex-col items-center gap-1" aria-label={`Profile ${complete}% complete`}>
            <span className="grid size-[76px] place-items-center rounded-full" style={{ background: `conic-gradient(var(--primary) ${complete}%, var(--subtle) 0)` }} aria-hidden="true">
              <span className="grid size-[62px] place-items-center rounded-full bg-surface text-lg font-bold tabular-nums">{complete}%</span>
            </span>
            <figcaption className="text-xs text-muted">Profile complete</figcaption>
          </figure>
        )}
      </header>

      <HubTabs base={path} label="Profile sections" tabs={tabs} current={tab} />

      {tab === 'stationery' && <StationeryTab {...props} />}
      {tab === 'personal' && <PersonalTab {...props} personal={(p ?? null) as Record<string, unknown> | null} />}
      {tab === 'work' && <WorkTab {...props} />}
      {tab === 'team' && <TeamTab {...props} />}
      {tab === 'education' && <EducationTab {...props} />}
      {tab === 'family' && <FamilyTab {...props} contacts={personal?.contacts ?? []} />}
      {tab === 'documents' && <DocumentsTab {...props} identity={identity} />}
      {tab === 'workweek' && <WorkWeekTab {...props} />}
      {tab === 'attendance' && <AttendanceTab {...props} />}
      {tab === 'leave' && <LeaveTab {...props} />}
      {tab === 'payroll' && <PayrollTab {...props} bank={bank} />}
      {tab === 'expense' && <ExpenseTab {...props} />}
      {tab === 'pms' && <PmsTab {...props} noticeDays={noticeDays} />}
      {tab === 'files' && <FilesTab {...props} />}
      {tab === 'exit' && <ExitTab {...props} noticeDays={noticeDays} />}
    </>
  );
}
