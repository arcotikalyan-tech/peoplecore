import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { listMembers, memberSignInStatus, notEmployeeMemberIds, roleCatalog, unlinkedEmployees } from '@/server/members';
import { orgControls } from '@/server/modules';
import {
  addMissingRecordsAction, inviteMemberAction, linkEmployeeAction, markNotEmployeeAction, removeMemberAction, sendPasswordLinkAction, setMemberRolesAction,
  setMemberStatusAction, unlinkEmployeeAction, unmarkNotEmployeeAction,
} from './actions';
import { InviteForm } from './invite-form';
import { LinkEmployeeForm, MemberButton, OrgButton } from './link-forms';
import { MemberActions } from './member-actions';

export const metadata: Metadata = { title: 'Users & roles' };

const statusTone = { active: 'success', invited: 'primary', suspended: 'warning' } as const;
const statusLabel = { active: 'Active', invited: 'Invited', suspended: 'Suspended' } as const;

export default async function MembersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'member.manage', 'org');
  const [members, { roles, grantableIds }, employees, signIn, notEmployees, controls] = await Promise.all([
    listMembers(ctx.org.id),
    roleCatalog(ctx.org.id),
    unlinkedEmployees(ctx.org.id),
    memberSignInStatus(ctx.org.id),
    notEmployeeMemberIds(ctx.org.id),
    orgControls(ctx.org.id),
  ]);
  const canLink = ctx.can('employee.update', 'org');
  const canCreate = ctx.can('employee.create');

  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const grantable = new Set(grantableIds);
  const ownerLevel = ctx.can('role.manage', 'org');
  const employeeRole = roles.find((r) => r.key === 'employee');
  // People who can sign in but have no employee record, so can't punch in, apply for leave or be paid.
  const missing = members.filter((m) => !m.employee_id && m.status !== 'suspended' && !notEmployees.has(m.member_id)).length;

  return (
    <>
      <PageHeader title="Users & roles" description={`Who can sign in to ${ctx.org.name} and what they can do: employees, and anyone else you give access (an accountant, an auditor). Employee records themselves are under Employees. Every change is audited.`} />
      {missing > 0 && canCreate && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <span>
            <span className="font-medium">{missing} {missing === 1 ? 'person has' : 'people have'} no employee record</span>
            <span className="block text-xs text-muted">Without one they can’t punch in, apply for leave or be paid. Mark anyone who doesn’t work for you (an accountant, an auditor) as not an employee first.</span>
          </span>
          <OrgButton action={addMissingRecordsAction.bind(null, slug)} label="Add their employee records" aria="Add employee records for everyone without one" />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <Table caption="Users">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Roles</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                // Mirrors the database rule: you can only manage someone whose every role you could grant.
                const manageable = ownerLevel || m.role_ids.every((id) => grantable.has(id));
                const isSelf = m.user_id === ctx.user.id;
                return (
                  <tr key={m.member_id} className="align-top">
                    <Td>
                      <div className="font-medium">{m.email}</div>
                      {m.employee_name ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>Employee: {m.employee_name}</span>
                          {canLink && (manageable || isSelf) && <MemberButton action={unlinkEmployeeAction.bind(null, slug)} memberId={m.member_id} label="Unlink" aria={`Unlink ${m.email} from ${m.employee_name}`} />}
                        </div>
                      ) : notEmployees.has(m.member_id) ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>Not an employee: no employee record.</span>
                          {(manageable || isSelf) && <MemberButton action={unmarkNotEmployeeAction.bind(null, slug)} memberId={m.member_id} label="Undo" aria={`${m.email} is an employee after all`} />}
                        </div>
                      ) : (
                        <>
                          {/* Without a record they can sign in but not punch in, apply for leave or be paid, and aren't under Employees. */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warning">
                            <span>No employee record: they can’t punch in, apply for leave or be paid.</span>
                            {canCreate && (manageable || isSelf) && m.email && (
                              <Link href={`/app/${slug}/employees/new?workEmail=${encodeURIComponent(m.email)}`} className="font-medium text-primary hover:underline">Add employee record</Link>
                            )}
                            {(manageable || isSelf) && <MemberButton action={markNotEmployeeAction.bind(null, slug)} memberId={m.member_id} label="Not an employee" aria={`${m.email} doesn’t work here: no employee record`} />}
                          </div>
                          {canLink && (manageable || isSelf) && employees.length > 0 && (
                            <LinkEmployeeForm action={linkEmployeeAction.bind(null, slug)} memberId={m.member_id} email={m.email ?? ''} options={employees} />
                          )}
                        </>
                      )}
                    </Td>
                    <Td>
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {m.role_ids.map((id) => (
                          <Badge key={id}>{roleName.get(id) ?? 'Unknown role'}</Badge>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={statusTone[m.status]}>{statusLabel[m.status]}</Badge>
                      {signIn.get(m.member_id) && !signIn.get(m.member_id)!.has_password && <div className="mt-1 text-xs text-warning">No password yet</div>}
                      {!isSelf && manageable && signIn.get(m.member_id) && (
                        <div className="mt-1"><MemberButton action={sendPasswordLinkAction.bind(null, slug)} memberId={m.member_id} variant="secondary"
                          label={signIn.get(m.member_id)!.has_password ? 'Send password reset link' : 'Send password setup link'} aria={`Send ${m.email} a password link`} /></div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">
                      {m.last_sign_in_at ? formatDateTime(m.last_sign_in_at, ctx.org.timezone) : 'Never'}
                    </Td>
                    <Td className="text-right">
                      {isSelf ? (
                        <span className="text-xs text-muted">You</span>
                      ) : !manageable ? (
                        <span className="text-xs text-muted">Managed by an owner</span>
                      ) : (
                        <MemberActions
                          key={`${m.member_id}:${m.status}:${m.role_ids.join(',')}`}
                          memberId={m.member_id}
                          status={m.status}
                          roleIds={m.role_ids}
                          roles={roles.map((r) => ({ id: r.id, name: r.name }))}
                          grantableIds={grantableIds}
                          orgName={ctx.org.name}
                          setRoles={setMemberRolesAction.bind(null, slug)}
                          setStatus={setMemberStatusAction.bind(null, slug)}
                          remove={removeMemberAction.bind(null, slug)}
                        />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        <Card className="self-start">
          <CardHeader title="Invite someone" description="Existing PeopleCore users are added straight away; new people get an email invitation. Adding an employee under Employees invites them too." />
          <InviteForm
            action={inviteMemberAction.bind(null, slug)}
            roles={roles.filter((r) => grantable.has(r.id)).map((r) => ({ value: r.id, label: r.name, description: r.description }))}
            defaultRoleIds={employeeRole ? [employeeRole.id] : []}
            employees={employees}
            newRecordDate={canCreate ? todayIn(ctx.org.timezone) : undefined}
            recordByDefault={controls.auto_employee_record}
            rolesHint={ownerLevel ? undefined : 'HR administrator, payroll, auditor and owner roles can only be granted by an owner.'}
          />
        </Card>
      </div>
    </>
  );
}
