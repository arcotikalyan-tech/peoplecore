import type { Metadata } from 'next';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { requirePermission } from '@/server/context';
import { getStructure } from '@/server/structure';
import { createDepartmentAction, createDesignationAction, createLocationAction } from './actions';
import { DepartmentForm, DesignationForm, LocationForm } from './structure-forms';

export const metadata: Metadata = { title: 'Organization structure' };

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-sm text-muted">{text}</td>
    </tr>
  );
}

export default async function StructurePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'org.read');
  const s = await getStructure(ctx.org.id);
  const canManage = ctx.can('org.manage');
  const deptName = new Map(s.departments.map((d) => [d.id, d.name]));

  return (
    <>
      <PageHeader
        title="Organization structure"
        description={canManage ? 'Departments, designations and locations used across PeopleCore. Every change is audited.' : 'Read-only view of your organization’s structure.'}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Departments" description={`${s.departments.length} active`} />
          <Table caption="Departments">
            <thead>
              <tr><Th>Code</Th><Th>Name</Th><Th>Parent</Th></tr>
            </thead>
            <tbody>
              {s.departments.length === 0 && <EmptyRow cols={3} text="No departments yet." />}
              {s.departments.map((d) => (
                <tr key={d.id}>
                  <Td className="font-mono text-xs">{d.code}</Td>
                  <Td className="font-medium">{d.name}</Td>
                  <Td className="text-muted">{d.parent_id ? deptName.get(d.parent_id) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {canManage && (
            <DepartmentForm
              action={createDepartmentAction.bind(null, slug)}
              parents={s.departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          )}
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Designations" description={`${s.designations.length} active`} />
            <Table caption="Designations">
              <thead>
                <tr><Th>Title</Th><Th>Level</Th></tr>
              </thead>
              <tbody>
                {s.designations.length === 0 && <EmptyRow cols={2} text="No designations yet." />}
                {s.designations.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-medium">{d.title}</Td>
                    <Td className="tabular-nums text-muted">{d.level ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {canManage && <DesignationForm action={createDesignationAction.bind(null, slug)} />}
          </Card>

          <Card>
            <CardHeader title="Locations" description={`${s.locations.length} active`} />
            <Table caption="Locations">
              <thead>
                <tr><Th>Code</Th><Th>Name</Th><Th>City / state</Th></tr>
              </thead>
              <tbody>
                {s.locations.length === 0 && <EmptyRow cols={3} text="No locations yet." />}
                {s.locations.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-mono text-xs">{l.code}</Td>
                    <Td className="font-medium">{l.name}</Td>
                    <Td className="text-muted">{[l.city, l.state_code].filter(Boolean).join(', ') || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {canManage && <LocationForm action={createLocationAction.bind(null, slug)} />}
          </Card>
        </div>
      </div>
    </>
  );
}
