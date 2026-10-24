'use server';

import type { ActionState } from '@/lib/action-state';
import { formatDate } from '@/lib/format';
import { verifyAuditArchive } from '@/server/audit';
import { getOrgContext } from '@/server/context';

/** Checks the last 30 archived days of the audit log (audit.read): files, hash chain and entry counts. */
export async function verifyAuditArchiveAction(orgSlug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('audit.read', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const r = await verifyAuditArchive(ctx.org.id, 30);
  if (r.checked === 0) return { ok: true, message: 'Nothing archived yet. The first day is archived the morning after it ends (UTC).' };
  const span = `${formatDate(r.from)} to ${formatDate(r.to)}`;
  return r.problems.length === 0
    ? { ok: true, message: `All ${r.checked} days from ${span} match their files and the log.` }
    : { ok: false, message: `${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} in ${span}: ${r.problems.slice(0, 5).join(' ')}${r.problems.length > 5 ? ' …' : ''}` };
}
