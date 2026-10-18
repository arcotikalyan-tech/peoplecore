'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ApprovalDecision({ action, requestId, summary }: { action: Action; requestId: string; summary: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="space-y-2" aria-label={`Decide: ${summary}`}>
      <input type="hidden" name="requestId" value={requestId} />
      <label className="sr-only" htmlFor={`comment-${requestId}`}>Comment</label>
      <input id={`comment-${requestId}`} name="comment" placeholder="Comment (required to reject)"
        className="block h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />
      <div className="flex items-center gap-2">
        <button type="submit" name="decision" value="approve" className="h-8 rounded-md bg-success px-3 text-sm font-medium text-white hover:bg-success/90">Approve</button>
        <button type="submit" name="decision" value="reject" className="h-8 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-subtle">Reject</button>
        {state.message && <span role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-success' : 'text-sm font-medium text-danger'}>{state.message}</span>}
      </div>
    </form>
  );
}

export function CompleteTask({ action, taskId, title }: { action: Action; taskId: string; title: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…" aria-label={`Mark “${title}” done`}>Mark done</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}
