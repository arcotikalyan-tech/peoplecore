import Link from 'next/link';
import { Badge } from '@/components/ui/surface';
import { formatDate, humanize } from '@/lib/format';
import { listClaims } from '@/server/expenses';
import { Empty, inr, Panel, type ProfileProps } from './shared';

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'primary'> = {
  pending: 'warning', approved: 'primary', paid: 'success', rejected: 'danger', draft: 'neutral', cancelled: 'neutral',
};

/** Expense: claim figures and recent claims. */
export async function ExpenseTab({ ctx, id, base, isSelf, today }: ProfileProps) {
  const claims = await listClaims(ctx.org.id, { employeeId: id }).catch(() => []);
  const sum = (s: string) => claims.filter((c) => c.status === s).reduce((a, c) => a + Number(c.total), 0);
  const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const paidYtd = claims.filter((c) => c.status === 'paid' && (c.decided_at ?? c.created_at).slice(0, 10) >= fyStart);
  const figures = [
    { label: 'Pending', value: claims.filter((c) => c.status === 'pending').length, note: `${inr.format(sum('pending'))} awaiting` },
    { label: 'Approved', value: claims.filter((c) => c.status === 'approved').length, note: `${inr.format(sum('approved'))} to be paid` },
    { label: 'Reimbursed · YTD', value: inr.format(paidYtd.reduce((a, c) => a + Number(c.total), 0)), note: `across ${paidYtd.length} claim${paidYtd.length === 1 ? '' : 's'}` },
  ];
  return (
    <div className="space-y-5">
      <ul className="grid gap-3 sm:grid-cols-3" aria-label="Claim figures">
        {figures.map((f) => (
          <li key={f.label} className="lift-soft rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{f.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{f.value}</p>
            <p className="text-xs text-muted">{f.note}</p>
          </li>
        ))}
      </ul>
      <Panel title="Recent claims" actions={<Link className="text-sm text-primary hover:underline" href={`${base}/expenses`}>{isSelf ? '+ New Claim' : 'View all →'}</Link>}>
        {claims.length === 0 ? <Empty icon="🧾" title="No claims yet">{isSelf && <p className="text-xs text-muted">Use “+ New Claim” to add your first expense.</p>}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Claims">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Claim</th><th className="px-3">Submitted</th><th className="px-3 text-right">Amount</th><th className="px-3">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {claims.slice(0, 20).map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-2"><Link className="font-medium hover:underline" href={`${base}/expenses/${c.id}`}>{c.title}</Link></td>
                    <td className="px-3">{c.submitted_at ? formatDate(c.submitted_at.slice(0, 10)) : '—'}</td>
                    <td className="px-3 text-right tabular-nums">{inr.format(Number(c.total))}</td>
                    <td className="px-3"><Badge tone={TONE[c.status] ?? 'neutral'}>{humanize(c.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
