import type { Metadata } from 'next';
import Link from 'next/link';
import { REQUISITION_STATUS_LABELS } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { employeeNames, managerOptions } from '@/server/employees';
import { listRequisitions } from '@/server/recruitment';
import { getStructure, structureOptions } from '@/server/structure';
import { createRequisitionAction } from './actions';
import { RequisitionForm } from './recruitment-forms';

export const metadata: Metadata = { title: 'Recruitment' };

export default async function RecruitmentPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'recruitment.read');
  const canManage = ctx.can('recruitment.manage', 'org');
  const [requisitions, structure, managers] = await Promise.all([
    listRequisitions(ctx.org.id),
    getStructure(ctx.org.id),
    canManage && ctx.can('employee.read', 'org') ? managerOptions(ctx.org.id) : Promise.resolve([]),
  ]);
  const names = await employeeNames(ctx.org.id, requisitions.map((r) => r.hiring_manager_employee_id).filter((x): x is string => !!x));
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const base = `/app/${slug}/recruitment`;

  return (
    <>
      <PageHeader
        title="Recruitment"
        description={ctx.can('recruitment.read', 'org') ? 'Requisitions and their candidate pipelines.' : 'Requisitions where you or someone in your reporting line is the hiring manager.'}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Requisitions" description={`${requisitions.filter((r) => r.status === 'open').length} open`} />
          <Table caption="Requisitions">
            <thead>
              <tr><Th>Code</Th><Th>Title</Th><Th>Department</Th><Th>Hiring manager</Th><Th>Openings</Th><Th>In pipeline</Th><Th>Status</Th><Th>Opened</Th></tr>
            </thead>
            <tbody>
              {requisitions.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-muted">No requisitions yet.</td></tr>
              )}
              {requisitions.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="font-medium"><Link className="text-primary hover:underline" href={`${base}/${r.id}`}>{r.title}</Link></Td>
                  <Td className="text-muted">{r.department_id ? (dept.get(r.department_id) ?? 'Archived') : '—'}</Td>
                  <Td className="text-muted">{r.hiring_manager_employee_id ? (names.get(r.hiring_manager_employee_id) ?? '—') : '—'}</Td>
                  <Td className="tabular-nums">{r.hired}/{r.openings} filled</Td>
                  <Td className="tabular-nums">{r.active}</Td>
                  <Td><Badge tone={r.status === 'open' ? 'success' : 'neutral'}>{REQUISITION_STATUS_LABELS[r.status]}</Badge></Td>
                  <Td className="text-muted">{formatDate(r.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {canManage && (
          <Card>
            <CardHeader title="New requisition" />
            <RequisitionForm action={createRequisitionAction.bind(null, slug)} options={{ ...structureOptions(structure), managers }} />
          </Card>
        )}
      </div>
    </>
  );
}
