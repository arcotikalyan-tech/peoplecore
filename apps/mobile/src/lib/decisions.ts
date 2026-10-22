/** Approving and rejecting on the phone: the same rules and words as the website's Inbox. */

export type Decision = 'approve' | 'reject';

/** What's wrong with a decision before it is sent, or null. */
export function decisionProblem(decision: Decision, comment: string): string | null {
  if (decision === 'reject' && !comment.trim()) return 'Give a reason when rejecting.';
  if (comment.trim().length > 1000) return 'Keep the comment under 1,000 characters.';
  return null;
}

/** The confirmation for what decide_approval returned. */
export function decisionMessage(result: string | null): string {
  return result === 'pending' ? 'Approved. It moves to the next approver.' : result === 'approved' ? 'Approved.' : 'Rejected.';
}

/** A database refusal in words (the database explains its own refusals; permission errors get a sentence). */
export function refusalMessage(error: { code?: string; message?: string }): string {
  if (error.code === '42501') return 'You can’t decide this one any more. Pull down to refresh.';
  return error.message && error.code === '22023' ? error.message : 'That didn’t work. Try again.';
}
