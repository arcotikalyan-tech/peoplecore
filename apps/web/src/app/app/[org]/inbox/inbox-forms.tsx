'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Badge } from '@/components/ui/surface';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface ApprovalItem {
  id: string;
  summary: string;
  href: string | null;
  stepLabel: string;
  meta: string;
  /** "For <manager>" when deciding as their delegate. */
  onBehalfOf?: string | null;
  escalated?: boolean;
}

/**
 * The approvals queue. One action state for the whole list, so the confirmation stays visible after the
 * decided item leaves the queue.
 */
export function ApprovalsPanel({ action, items }: { action: Action; items: ApprovalItem[] }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <>
      {state.message && (
        <p role={state.ok ? 'status' : 'alert'} className={`border-b border-line px-5 py-2.5 text-sm ${state.ok ? 'text-success' : 'font-medium text-danger'}`}>
          {state.message}
        </p>
      )}
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">Nothing to approve.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Approvals">
          {items.map((a) => (
            <li key={a.id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{a.href ? <Link className="hover:underline" href={a.href}>{a.summary}</Link> : a.summary}</p>
                <span className="flex flex-wrap gap-1">
                  {a.onBehalfOf && <Badge tone="primary">For {a.onBehalfOf}</Badge>}
                  {a.escalated && <Badge tone="warning">Overdue</Badge>}
                  <Badge>{a.stepLabel}</Badge>
                </span>
              </div>
              <p className="text-xs text-muted">{a.meta}</p>
              <form action={formAction} className="space-y-2" aria-label={`Decide: ${a.summary}`}>
                <input type="hidden" name="requestId" value={a.id} />
                <label className="sr-only" htmlFor={`comment-${a.id}`}>Comment</label>
                <input id={`comment-${a.id}`} name="comment" placeholder="Comment (required to reject)"
                  className="block h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />
                <div className="flex items-center gap-2">
                  <button type="submit" name="decision" value="approve" className="h-8 rounded-md bg-success px-3 text-sm font-medium text-white hover:bg-success/90">Approve</button>
                  <button type="submit" name="decision" value="reject" className="h-8 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-subtle">Reject</button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
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
