import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Th } from '@/components/ui/table';
import { requirePermission } from '@/server/context';
import { getStructureOverview } from '@/server/structure';
import {
  createDepartmentAction,
  createDesignationAction,
  createLocationAction,
  setStructureArchivedAction,
  updateDepartmentAction,
  updateDesignationAction,
  updateLocationAction,
} from './actions';
import { DepartmentForm, DesignationForm, LocationForm } from './structure-forms';
import { DepartmentRow, DesignationRow, LocationRow } from './structure-rows';

export const metadata: Metadata = { title: 'Organization structure' };

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-sm text-muted">{text}</td>
    </tr>
  );
}

/** Archived items, collapsed by default. Rendered only when there are some. */
function Archived({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="border-t border-line">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-muted hover:text-fg">Archived ({count})</summary>
      {children}
    </details>
  );
}

/** Ids of a department and everything under it, so the editor doesn't offer them as its parent. */
function subtree(rootId: string, departments: ReadonlyArray<{ id: string; parent_id: string | null }>) {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const d of departments) {
      if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) {
        ids.add(d.id);
        grew = true;
      }
    }
  }
  return ids;
}

export default async function StructurePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'org.read');
  const s = await getStructureOverview(ctx.org.id);
  const canManage = ctx.can('org.manage');
  const setArchived = setStructureArchivedAction.bind(null, slug);
  const actions = <T,>(update: T) => (canManage ? { update, setArchived } : undefined);
  const deptActions = actions(updateDepartmentAction.bind(null, slug));
  const desigActions = actions(updateDesignationAction.bind(null, slug));
  const locActions = actions(updateLocationAction.bind(null, slug));

  const active = <T extends { archived_at: string | null }>(xs: T[]) => xs.filter((x) => !x.archived_at);
  const archived = <T extends { archived_at: string | null }>(xs: T[]) => xs.filter((x) => x.archived_at);
  const depts = active(s.departments);
  const desigs = active(s.designations);
  const locs = active(s.locations);
  const deptName = new Map(s.departments.map((d) => [d.id, d.name]));
  const parentOptions = (id: string) => {
    const excluded = subtree(id, s.departments);
    return depts.filter((d) => !excluded.has(d.id)).map((d) => ({ value: d.id, label: d.name }));
  };
  const actionsTh = canManage ? <Th><span className="sr-only">Actions</span></Th> : null;

  return (
    <>
      <PageHeader
        title="Organization structure"
        description={canManage
          ? 'Departments, designations and locations used across PeopleCore. Items in use can’t be archived. Every change is audited.'
          : 'Read-only view of your organization’s structure.'}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Departments" description={`${depts.length} active`} />
          <Table caption="Departments">
            <thead>
              <tr><Th>Code</Th><Th>Name</Th><Th>Parent</Th><Th>People</Th>{actionsTh}</tr>
            </thead>
            <tbody>
              {depts.length === 0 && <EmptyRow cols={5} text="No departments yet." />}
              {depts.map((d) => (
                <DepartmentRow key={d.id} item={d}
                  parentName={d.parent_id ? deptName.get(d.parent_id) : undefined}
                  parentOptions={parentOptions(d.id)} actions={deptActions} />
              ))}
            </tbody>
          </Table>
          <Archived count={s.departments.length - depts.length}>
            <Table caption="Archived departments">
              <tbody>
                {archived(s.departments).map((d) => (
                  <DepartmentRow key={d.id} item={d} parentName={d.parent_id ? deptName.get(d.parent_id) : undefined}
                    parentOptions={[]} actions={deptActions} />
                ))}
              </tbody>
            </Table>
          </Archived>
          {canManage && (
            <DepartmentForm
              action={createDepartmentAction.bind(null, slug)}
              parents={depts.map((d) => ({ value: d.id, label: d.name }))}
            />
          )}
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Designations" description={`${desigs.length} active`} />
            <Table caption="Designations">
              <thead>
                <tr><Th>Title</Th><Th>Level</Th><Th>People</Th>{actionsTh}</tr>
              </thead>
              <tbody>
                {desigs.length === 0 && <EmptyRow cols={4} text="No designations yet." />}
                {desigs.map((d) => (
                  <DesignationRow key={d.id} item={d} actions={desigActions} />
                ))}
              </tbody>
            </Table>
            <Archived count={s.designations.length - desigs.length}>
              <Table caption="Archived designations">
                <tbody>
                  {archived(s.designations).map((d) => <DesignationRow key={d.id} item={d} actions={desigActions} />)}
                </tbody>
              </Table>
            </Archived>
            {canManage && <DesignationForm action={createDesignationAction.bind(null, slug)} />}
          </Card>

          <Card>
            <CardHeader title="Locations" description={`${locs.length} active`} />
            <Table caption="Locations">
              <thead>
                <tr><Th>Code</Th><Th>Name</Th><Th>City / state</Th><Th>People</Th>{actionsTh}</tr>
              </thead>
              <tbody>
                {locs.length === 0 && <EmptyRow cols={5} text="No locations yet." />}
                {locs.map((l) => (
                  <LocationRow key={l.id} item={l} actions={locActions} />
                ))}
              </tbody>
            </Table>
            <Archived count={s.locations.length - locs.length}>
              <Table caption="Archived locations">
                <tbody>
                  {archived(s.locations).map((l) => <LocationRow key={l.id} item={l} actions={locActions} />)}
                </tbody>
              </Table>
            </Archived>
            {canManage && <LocationForm action={createLocationAction.bind(null, slug)} />}
          </Card>
        </div>
      </div>
    </>
  );
}
