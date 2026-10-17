'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { initialActionState } from '@/lib/action-state';
import { setOrganizationStatusAction } from './actions';

/** Suspend / reactivate with an explicit confirmation step (suspension cuts off every member at once). */
export function OrgStatusControl({ orgId, name, status }: { orgId: string; name: string; status: 'active' | 'suspended' | 'archived' }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(setOrganizationStatusAction, initialActionState);
  if (status === 'archived') return null;
  const target = status === 'active' ? 'suspended' : 'active';

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          {target === 'suspended' ? 'Suspend' : 'Reactivate'}
        </Button>
        {state.message && !state.ok && <p role="alert" className="text-xs text-danger">{state.message}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="status" value={target} />
      <span className="text-xs text-muted">
        {target === 'suspended' ? `Suspend ${name}? Every member loses access immediately.` : `Reactivate ${name}?`}
      </span>
      <SubmitButton variant={target === 'suspended' ? 'danger' : 'primary'} pendingLabel="Saving…">
        {target === 'suspended' ? 'Confirm suspension' : 'Confirm reactivation'}
      </SubmitButton>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </form>
  );
}
