'use client';

import { useActionState, useCallback, useState, type ReactNode } from 'react';
import type { StructureKind } from '@peoplecore/shared';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import type { Option } from '@/components/ui/fields';
import { Td } from '@/components/ui/table';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { DepartmentForm, DesignationForm, LocationForm } from './structure-forms';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface RowProps {
  /** Present only for people who may change the structure. */
  actions?: { update: Action; setArchived: Action };
}

/**
 * One table row with Edit / Archive (or Restore, for archived items). The editor and any message open in
 * a full-width row underneath, so the table keeps its columns.
 */
function Row({
  kind, id, name, archived, cells, actions, editor,
}: {
  kind: StructureKind;
  id: string;
  name: string;
  archived: boolean;
  cells: ReactNode;
  actions?: RowProps['actions'];
  editor: (onDone: (message?: string) => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [archiveState, archiveAction] = useActionState(actions?.setArchived ?? (async () => initialActionState), initialActionState);
  const onDone = useCallback((message?: string) => {
    setEditing(false);
    setNotice(message);
  }, []);
  const cols = 10; // wider than any table here; extra colSpan is harmless
  const error = archiveState.ok ? undefined : archiveState.message;

  return (
    <>
      <tr>
        {cells}
        {actions && (
          <Td className="text-right">
            <div className="flex justify-end gap-2">
              {!archived && (
                <Button size="sm" variant="secondary" aria-expanded={editing} aria-label={`Edit ${name}`}
                  onClick={() => { setEditing(!editing); setNotice(undefined); }}>
                  {editing ? 'Close' : 'Edit'}
                </Button>
              )}
              <form action={archiveAction}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="archive" value={archived ? 'false' : 'true'} />
                <SubmitButton size="sm" variant="ghost" pendingLabel={archived ? 'Restoring…' : 'Archiving…'}
                  aria-label={`${archived ? 'Restore' : 'Archive'} ${name}`}>
                  {archived ? 'Restore' : 'Archive'}
                </SubmitButton>
              </form>
            </div>
          </Td>
        )}
      </tr>
      {(editing || notice || error) && (
        <tr>
          <td colSpan={cols} className="border-b border-line p-0">
            {editing && editor(onDone)}
            {!editing && notice && <p role="status" className="px-5 py-2 text-sm text-success">{notice}</p>}
            {error && <p role="alert" className="px-5 py-2 text-sm font-medium text-danger">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

const usedBy = (n: number) => <Td className="tabular-nums text-muted">{n === 0 ? '—' : n}</Td>;

export function DepartmentRow({
  item, parentName, parentOptions, actions,
}: RowProps & {
  item: { id: string; code: string; name: string; parent_id: string | null; archived_at: string | null; employees: number };
  parentName?: string;
  /** Active departments this one may move under (itself and its sub-departments excluded). */
  parentOptions: Option[];
}) {
  return (
    <Row
      kind="department" id={item.id} name={item.name} archived={!!item.archived_at} actions={actions}
      cells={<>
        <Td className="font-mono text-xs">{item.code}</Td>
        <Td className="font-medium">{item.name}</Td>
        <Td className="text-muted">{parentName ?? '—'}</Td>
        {usedBy(item.employees)}
      </>}
      editor={(onDone) => actions && (
        <DepartmentForm action={actions.update} parents={parentOptions} onDone={onDone}
          initial={{ id: item.id, code: item.code, name: item.name, parentId: item.parent_id }} />
      )}
    />
  );
}

export function DesignationRow({
  item, actions,
}: RowProps & { item: { id: string; title: string; level: number | null; archived_at: string | null; employees: number } }) {
  return (
    <Row
      kind="designation" id={item.id} name={item.title} archived={!!item.archived_at} actions={actions}
      cells={<>
        <Td className="font-medium">{item.title}</Td>
        <Td className="tabular-nums text-muted">{item.level ?? '—'}</Td>
        {usedBy(item.employees)}
      </>}
      editor={(onDone) => actions && (
        <DesignationForm action={actions.update} onDone={onDone} initial={{ id: item.id, title: item.title, level: item.level }} />
      )}
    />
  );
}

export function LocationRow({
  item, actions,
}: RowProps & {
  item: { id: string; code: string; name: string; city: string | null; state_code: string | null; archived_at: string | null; employees: number };
}) {
  return (
    <Row
      kind="location" id={item.id} name={item.name} archived={!!item.archived_at} actions={actions}
      cells={<>
        <Td className="font-mono text-xs">{item.code}</Td>
        <Td className="font-medium">{item.name}</Td>
        <Td className="text-muted">{[item.city, item.state_code].filter(Boolean).join(', ') || '—'}</Td>
        {usedBy(item.employees)}
      </>}
      editor={(onDone) => actions && (
        <LocationForm action={actions.update} onDone={onDone}
          initial={{ id: item.id, code: item.code, name: item.name, city: item.city, stateCode: item.state_code }} />
      )}
    />
  );
}
