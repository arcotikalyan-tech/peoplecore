import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { z } from 'zod';
import { Alert, Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getCategories, getClaim } from '@/server/expenses';
import { namesFor } from '@/server/leave';
import { inr } from '../../payroll/format';
import { addItemAction, removeItemAction, submitClaimAction } from '../actions';
import { AddItemForm, SmallForm } from '../expense-forms';
import { CLAIM_TONE } from '../tone';

export const metadata: Metadata = { title: 'Expense claim' };

export default async function ClaimPage({ params }: { params: Promise<{ org: string; claimId: string }> }) {
  const { org: slug, claimId } = await params;
  if (!z.uuid().safeParse(claimId).success) notFound();
  const ctx = await getOrgContext(slug);
  const [claim, categories, me] = await Promise.all([getClaim(ctx.org.id, claimId), getCategories(ctx.org.id), getMyEmployee(ctx.org.id, ctx.user.id)]);
  if (!claim) notFound();
  const mine = me?.id === claim.employee_id;
  const editable = mine && claim.status === 'draft';
  const names = await namesFor(ctx.org.id, [claim.employee_id]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const duplicates = claim.items.filter((i) => i.duplicate_note).length;

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/expenses`} className="hover:text-fg">← Expenses</Link>} title={claim.title}
        description={`${names.get(claim.employee_id) ?? ''} · ${inr.format(Number(claim.total))}`} actions={<Badge tone={CLAIM_TONE[claim.status]}>{claim.status}</Badge>} />
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
                  <p className="font-medium">{catName.get(i.category_id) ?? 'Expense'} · {inr.format(Number(i.amount))}</p>
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
            <AddItemForm action={addItemAction.bind(null, slug)} claimId={claimId} today={todayIn(ctx.org.timezone)}
              categories={categories.map((c) => ({ value: c.id, label: `${c.name}${c.requires_receipt ? '' : ' (no receipt needed)'}${c.max_per_item ? ` · up to ₹${Number(c.max_per_item)}` : ''}` }))} />
            {claim.items.length > 0 && (
              <div className="border-t border-line px-5 py-4">
                <SmallForm action={submitClaimAction.bind(null, slug)} label="Submit claim" submit="Submit for approval" hidden={{ claimId }} variant="primary" />
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
