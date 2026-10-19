import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import { Alert, Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { aiAvailable } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { expenseSettings, getCategories, getClaim } from '@/server/expenses';
import { createClient } from '@/server/supabase';
import { ApprovalsPanel } from '../../inbox/inbox-forms';
import { decideClaimAction, finalizeClaimAction, holdClaimAction, replyClaimAction } from '../admin-actions';
import { FinalizeForm, HoldForm, ReplyForm } from '../expense-admin-client';
import { namesFor } from '@/server/leave';
import { inr } from '../../payroll/format';
import { addItemAction, readReceiptAction, removeItemAction, submitClaimAction } from '../actions';
import { AddItemForm, SmallForm } from '../expense-forms';
import { CLAIM_TONE } from '../tone';

export const metadata: Metadata = { title: 'Expense claim' };

export default async function ClaimPage({ params }: { params: Promise<{ org: string; claimId: string }> }) {
  const { org: slug, claimId } = await params;
  if (!z.uuid().safeParse(claimId).success) notFound();
  const ctx = await getOrgContext(slug);
  const [claim, categories, me, ai, settings] = await Promise.all([getClaim(ctx.org.id, claimId), getCategories(ctx.org.id), getMyEmployee(ctx.org.id, ctx.user.id), aiAvailable(ctx), expenseSettings(ctx.org.id)]);
  if (!claim) notFound();
  const supabase = await createClient();
  const [{ data: pendingForMe }, { data: steps }] = await Promise.all([
    supabase.rpc('my_pending_approvals', { p_org: ctx.org.id }),
    claim.approval_request_id
      ? supabase.from('approval_actions').select('step_no, decision, comment, acted_at, via').eq('request_id', claim.approval_request_id).order('acted_at')
      : Promise.resolve({ data: [] as Array<{ step_no: number; decision: string; comment: string | null; acted_at: string; via: string }> }),
  ]);
  const myTurn = (pendingForMe ?? []).find((a) => a.subject_id === claim.id);
  const finance = ctx.can('expense.manage', 'org');
  const mine = me?.id === claim.employee_id;
  const editable = mine && claim.status === 'draft';
  const names = await namesFor(ctx.org.id, [claim.employee_id]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const duplicates = claim.items.filter((i) => i.duplicate_note).length;
  const state = claim.status === 'pending' ? (claim.held_at ? 'on hold' : 'submitted') : claim.status === 'paid' ? 'reimbursed' : claim.status;

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/expenses`} className="hover:text-fg">← Expenses</Link>} title={claim.title}
        description={`${names.get(claim.employee_id) ?? ''} · ${inr.format(Number(claim.total))}`} actions={<Badge tone={CLAIM_TONE[claim.status]}>{state}</Badge>} />
      {claim.status === 'pending' && claim.held_at && (
        <div className="mb-6 space-y-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
          <p className="text-sm"><span className="font-semibold">⏸ On hold — more information needed:</span> {claim.hold_note}</p>
          {mine && <ReplyForm action={replyClaimAction.bind(null, slug)} claimId={claim.id} />}
        </div>
      )}
      {claim.status === 'pending' && !claim.held_at && claim.hold_reply && (
        <div className="mb-6 rounded-xl border border-line bg-subtle px-4 py-3 text-sm"><span className="font-semibold">Answer from {names.get(claim.employee_id) ?? 'the employee'}:</span> {claim.hold_reply}
          {claim.hold_note && <span className="block text-xs text-muted">Asked: {claim.hold_note}</span>}</div>
      )}
      {claim.status === 'paid' && (
        <div className="mb-6"><Alert tone="success" title={`Reimbursed${claim.paid_at ? ` on ${formatDate(claim.paid_at.slice(0, 10))}` : ''}`}>
          {claim.payout_mode === 'bank' ? `By bank transfer${claim.payout_reference ? ` (reference ${claim.payout_reference})` : ''}.` : claim.payout_mode === 'cash' ? 'In cash.' : 'With payroll.'}</Alert></div>
      )}
      {claim.status === 'approved' && <div className="mb-6"><Alert tone="info" title="Approved">{claim.recorded_by_finance ? 'Added by finance. ' : ''}It is paid with the next payroll unless finance pays it sooner.</Alert></div>}
      {myTurn && (
        <section aria-label="Your decision" className="mb-6 overflow-hidden rounded-xl border border-primary/40 bg-surface">
          <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Your decision · {myTurn.step_label}</h2>
          <ApprovalsPanel action={decideClaimAction.bind(null, slug)} items={[{ id: myTurn.id, summary: myTurn.summary, href: null, stepLabel: myTurn.step_label,
            meta: `From ${myTurn.requested_by_name}`, onBehalfOf: myTurn.via === 'delegation' ? (myTurn.on_behalf_of_name ?? 'a colleague') : null, escalated: myTurn.escalated }]} />
          {!claim.held_at && <div className="border-t border-line px-5 py-3"><HoldForm action={holdClaimAction.bind(null, slug)} claimId={claim.id} /></div>}
        </section>
      )}
      {!myTurn && finance && !mine && claim.status === 'pending' && settings.allow_skip && (
        <div className="mb-6 rounded-xl border border-line px-5 py-3"><FinalizeForm action={finalizeClaimAction.bind(null, slug)} claimId={claim.id} /></div>
      )}
      {duplicates > 0 && !editable && (
        <div className="mb-6"><Alert tone="warning" title={`${duplicates} item${duplicates === 1 ? '' : 's'} may be a duplicate`}>Check the notes below before approving.</Alert></div>
      )}
      <Card>
        <CardHeader title="Expenses" description={`${claim.items.length} item${claim.items.length === 1 ? '' : 's'}`} />
        {claim.items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No expenses yet.</p> : (
          <ul className="divide-y divide-line" aria-label="Expense items">
            {claim.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{catName.get(i.category_id) ?? 'Expense'}{i.subcategory ? ` › ${i.subcategory}` : ''} · {inr.format(Number(i.amount))}</p>
                  <p className="text-muted">{formatDate(i.expense_date)}{i.merchant ? ` · ${i.merchant}` : ''}{i.description ? ` · ${i.description}` : ''}</p>
                  {i.duplicate_note && <p className="font-medium text-warning">{i.duplicate_note}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {i.receipt_path && <a className="text-primary hover:underline" href={`/app/${slug}/expenses/${claimId}/receipts/${i.id}`}>Receipt</a>}
                  {editable && <SmallForm action={removeItemAction.bind(null, slug)} label={`Remove ${catName.get(i.category_id)} ${i.amount}`} submit="Remove" hidden={{ itemId: i.id, claimId }} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <>
            <AddItemForm action={addItemAction.bind(null, slug)} read={ai && settings.receipt_reading ? readReceiptAction.bind(null, slug) : undefined} claimId={claimId} today={todayIn(ctx.org.timezone)}
              subs={Object.fromEntries(categories.map((c) => [c.id, c.subcategories ?? []]))}
              categories={categories.map((c) => ({ value: c.id, label: `${c.name}${c.requires_receipt ? '' : ' (no receipt needed)'}${c.max_per_item ? ` · up to ₹${Number(c.max_per_item)}` : ''}` }))} />
            {claim.items.length > 0 && (
              <div className="border-t border-line px-5 py-4">
                <SmallForm action={submitClaimAction.bind(null, slug)} label="Submit claim" submit="Submit for approval" hidden={{ claimId }} variant="primary" />
              </div>
            )}
          </>
        )}
      </Card>
      {(steps ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Approval trail" />
          <ol className="divide-y divide-line text-sm" aria-label="Approval trail">
            {(steps ?? []).map((s, i) => (
              <li key={i} className="px-5 py-3"><span className="font-medium">Step {s.step_no}: {s.decision === 'approve' ? 'Approved' : s.decision === 'reject' ? 'Rejected' : 'Cancelled'}</span>
                <span className="text-muted"> · {formatDate(s.acted_at.slice(0, 10))}{s.via !== 'direct' ? ` · ${s.via}` : ''}</span>{s.comment && <span className="block text-muted">“{s.comment}”</span>}</li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
