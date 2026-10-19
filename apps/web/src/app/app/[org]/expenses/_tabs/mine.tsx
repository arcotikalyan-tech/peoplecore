import Link from 'next/link';
import { Badge } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import type { ClaimRow } from '@/server/expenses';
import { decideApprovalAction } from '../../inbox/actions';
import { ApprovalsPanel } from '../../inbox/inbox-forms';
import { createClaimAction } from '../actions';
import { holdClaimAction } from '../admin-actions';
import { NewClaimForm } from '../expense-forms';
import { HoldForm } from '../expense-admin-client';
import { claimState, Figure, inr, Panel, STATE_FILTERS, STATE_TONE } from './shared';

/** Employee: figures, recent claims and a new claim. */
export function MyHub({ slug, base, claims, cats, today }: { slug: string; base: string; claims: ClaimRow[]; cats: Map<string, string>; today: string }) {
  const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const pending = claims.filter((c) => c.status === 'pending');
  const approved = claims.filter((c) => c.status === 'approved');
  const paid = claims.filter((c) => c.status === 'paid' && (c.paid_at ?? '') >= fyStart);
  const held = pending.filter((c) => c.held_at);
  const sum = (xs: ClaimRow[]) => xs.reduce((a, c) => a + c.total, 0);
  return (
    <div className="space-y-5">
      {held.length > 0 && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          ⏸ {held.length === 1 ? 'A claim needs' : `${held.length} claims need`} more information: {held.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link className="font-medium underline" href={`${base}/${c.id}`}>{c.title}</Link></span>)}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Pending" value={pending.length} note={`${inr.format(sum(pending))} awaiting`} tone={pending.length ? 'warning' : undefined} />
        <Figure label="Approved" value={approved.length} note={`${inr.format(sum(approved))} to be paid`} tone={approved.length ? 'primary' : undefined} />
        <Figure label="Reimbursed · YTD" value={inr.format(sum(paid))} note={`across ${paid.length} claim${paid.length === 1 ? '' : 's'}`} tone="success" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Recent claims" actions={<Link className="text-sm text-primary hover:underline" href={`${base}?tab=mine`}>View all →</Link>}>
          <MyTable rows={claims.slice(0, 6)} cats={cats} base={base} caption="Recent claims" />
        </Panel>
        <Panel title="＋ New Claim"><div className="pb-2"><NewClaimForm action={createClaimAction.bind(null, slug)} /></div></Panel>
      </div>
    </div>
  );
}

function MyTable({ rows, cats, base, caption }: { rows: ClaimRow[]; cats: Map<string, string>; base: string; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={caption}>
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
          <tr><th className="px-5 py-2">Claim</th><th className="px-3">Date</th><th className="px-3">Category</th><th className="px-3">Merchant</th><th className="px-3 text-right">Amount</th><th className="px-3">Receipt</th><th className="px-3">Status</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">🧾 No claims yet. Use “＋ New Claim” to file your first expense.</td></tr>}
          {rows.map((c) => {
            const st = claimState(c);
            return (
              <tr key={c.id}>
                <td className="px-5 py-2"><Link className="font-medium text-primary hover:underline" href={`${base}/${c.id}`}>{c.title}</Link></td>
                <td className="px-3">{c.expenseDate ? formatDate(c.expenseDate) : formatDate(c.created_at.slice(0, 10))}</td>
                <td className="px-3">{c.categoryIds.length > 1 ? 'Multiple' : cats.get(c.categoryIds[0] ?? '') ?? '—'}</td>
                <td className="px-3">{c.merchant ?? '—'}</td>
                <td className="px-3 text-right tabular-nums">{inr.format(c.total)}</td>
                <td className="px-3">{c.items === 0 ? '—' : c.receipts === c.items ? '✓' : `${c.receipts}/${c.items}`}</td>
                <td className="px-3"><Badge tone={STATE_TONE[st]}>{st}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Employee: every claim, filterable, with export. */
export function MyClaims({ slug, base, claims, cats, sp }: { slug: string; base: string; claims: ClaimRow[]; cats: Map<string, string>; sp: Record<string, string | undefined> }) {
  const rows = sp.state ? claims.filter((c) => (sp.state === 'draft' ? c.status === 'draft' : claimState(c).toLowerCase().replace(' ', '_') === sp.state || c.status === sp.state)) : claims;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title={`My claims · ${rows.length}`} actions={<a className="text-sm text-primary hover:underline" href={`${base}/export?mine=1`} download>⬇ Export</a>}>
        <form method="get" action={base} className="flex flex-wrap items-end gap-2 px-5 py-3" aria-label="Filter my claims">
          <input type="hidden" name="tab" value="mine" />
          <select name="state" defaultValue={sp.state ?? ''} aria-label="Status" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
            <option value="">All</option><option value="draft">Draft</option>{STATE_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">⨁ Filter</button>
        </form>
        <MyTable rows={rows} cats={cats} base={base} caption="My claims" />
      </Panel>
      <Panel title="＋ New Claim"><NewClaimForm action={createClaimAction.bind(null, slug)} /></Panel>
    </div>
  );
}

type Pending = { id: string; subject_type: string; subject_id: string; summary: string; link: string | null; step_label: string; requested_by_name: string; created_at: string; via: string; on_behalf_of_name: string | null; escalated: boolean };

/** Approvers (managers and finance): expense claims waiting for their decision, with "put on hold". */
export function ApprovalsTab({ ctx, slug, items }: { ctx: OrgContext; slug: string; items: Pending[] }) {
  const orgBase = `/app/${slug}`;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title={`Waiting for your decision · ${items.length}`}>
        <ApprovalsPanel action={decideApprovalAction.bind(null, slug)} items={items.map((a) => ({
          id: a.id, summary: a.summary, href: a.link ? `${orgBase}${a.link}` : null, stepLabel: a.step_label,
          meta: `From ${a.requested_by_name} · ${formatDateTime(a.created_at, ctx.org.timezone)}`,
          onBehalfOf: a.via === 'delegation' ? (a.on_behalf_of_name ?? 'a colleague') : null, escalated: a.escalated,
        }))} />
      </Panel>
      {items.length > 0 && (
        <Panel title="Need more information?">
          <ul className="divide-y divide-line" aria-label="Put a claim on hold">
            {items.map((a) => (
              <li key={a.id} className="space-y-2 px-5 py-3">
                <p className="text-sm font-medium">{a.summary}</p>
                <HoldForm action={holdClaimAction.bind(null, slug)} claimId={a.subject_id} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
