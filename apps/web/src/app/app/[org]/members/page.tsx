import type { Metadata } from 'next';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { listMembers, memberSignInStatus, roleCatalog, unlinkedEmployees } from '@/server/members';
import {
  inviteMemberAction, linkEmployeeAction, removeMemberAction, sendPasswordLinkAction, setMemberRolesAction, setMemberStatusAction, unlinkEmployeeAction,
} from './actions';
import { InviteForm } from './invite-form';
import { LinkEmployeeForm, MemberButton } from './link-forms';
import { MemberActions } from './member-actions';

export const metadata: Metadata = { title: 'Users & roles' };

const statusTone = { active: 'success', invited: 'primary', suspended: 'warning' } as const;
const statusLabel = { active: 'Active', invited: 'Invited', suspended: 'Suspended' } as const;

export default async function MembersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'member.manage', 'org');
  const [members, { roles, grantableIds }, employees, signIn] = await Promise.all([
    listMembers(ctx.org.id),
    roleCatalog(ctx.org.id),
    unlinkedEmployees(ctx.org.id),
    memberSignInStatus(ctx.org.id),
  ]);
  const canLink = ctx.can('employee.update', 'org');

  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const grantable = new Set(grantableIds);
  const ownerLevel = ctx.can('role.manage', 'org');
  const employeeRole = roles.find((r) => r.key === 'employee');

  return (
    <>
      <PageHeader title="Users & roles" description={`Who can sign in to ${ctx.org.name} and what they can do: employees, and anyone else you give access (an accountant, an auditor). Employee records themselves are under Employees. Every change is audited.`} />
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
                      ) : canLink && (manageable || isSelf) ? (
                        <LinkEmployeeForm action={linkEmployeeAction.bind(null, slug)} memberId={m.member_id} email={m.email ?? ''} options={employees} />
                      ) : <div className="text-xs text-muted">No employee record</div>}
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
          <CardHeader title="Invite someone" description="Existing PeopleCore users are added straight away; new people get an email invitation." />
          <InviteForm
            action={inviteMemberAction.bind(null, slug)}
            roles={roles.filter((r) => grantable.has(r.id)).map((r) => ({ value: r.id, label: r.name, description: r.description }))}
            defaultRoleIds={employeeRole ? [employeeRole.id] : []}
            employees={employees}
            rolesHint={ownerLevel ? undefined : 'HR administrator, payroll, auditor and owner roles can only be granted by an owner.'}
          />
        </Card>
      </div>
    </>
  );
}
