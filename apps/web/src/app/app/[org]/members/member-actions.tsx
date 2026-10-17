'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { CheckboxGroup } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface Props {
  memberId: string;
  status: 'active' | 'invited' | 'suspended';
  roleIds: string[];
  roles: Array<{ id: string; name: string }>;
  grantableIds: string[];
  orgName: string;
  setRoles: Action;
  setStatus: Action;
  remove: Action;
}

/** Row actions. The parent re-keys this component when the member changes, which closes open panels. */
export function MemberActions({ memberId, status, roleIds, roles, grantableIds, orgName, setRoles, setStatus, remove }: Props) {
  const [panel, setPanel] = useState<'none' | 'roles' | 'remove'>('none');
  const [rolesState, rolesAction] = useActionState(setRoles, initialActionState);
  const [statusState, statusAction] = useActionState(setStatus, initialActionState);
  const [removeState, removeAction] = useActionState(remove, initialActionState);
  const error = [rolesState, statusState, removeState].find((s) => s.message && !s.ok)?.message;
  const nextStatus = status === 'suspended' ? 'active' : 'suspended';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'roles' ? 'none' : 'roles')} aria-expanded={panel === 'roles'}>
          Edit roles
        </Button>
        <form action={statusAction}>
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="status" value={nextStatus} />
          <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
            {nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'}
          </SubmitButton>
        </form>
        <Button size="sm" variant="ghost" onClick={() => setPanel('remove')}>
          Remove
        </Button>
      </div>

      {panel === 'roles' && (
        <form action={rolesAction} className="rounded-md border border-line bg-subtle/40 p-3 text-left">
          <input type="hidden" name="memberId" value={memberId} />
          <CheckboxGroup
            idPrefix={`m-${memberId}`}
            name="roleIds"
            legend="Roles"
            options={roles.map((r) => ({ value: r.id, label: r.name, disabled: !grantableIds.includes(r.id) }))}
            defaultValues={roleIds}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPanel('none')}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Saving…">Save roles</SubmitButton>
          </div>
        </form>
      )}

      {panel === 'remove' && (
        <form action={removeAction} className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-danger/30 bg-danger-soft p-3">
          <input type="hidden" name="memberId" value={memberId} />
          <span className="text-xs text-fg">Remove this member? They lose access to {orgName} immediately.</span>
          <Button size="sm" variant="ghost" onClick={() => setPanel('none')}>
            Cancel
          </Button>
          <SubmitButton size="sm" variant="danger" pendingLabel="Removing…">Confirm removal</SubmitButton>
        </form>
      )}

      {error && (
        <p role="alert" className="text-right text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
