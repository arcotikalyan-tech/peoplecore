import type { ReactNode } from 'react';
import type { ClaimRow } from '@/server/expenses';

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** What a claim's status means on screen: a pending claim waiting for the employee's answer is "On hold". */
export function claimState(c: Pick<ClaimRow, 'status' | 'held_at'>): string {
  if (c.status === 'pending') return c.held_at ? 'On hold' : 'Submitted';
  return { draft: 'Draft', approved: 'Approved', rejected: 'Rejected', paid: 'Reimbursed', cancelled: 'Cancelled' }[c.status] ?? c.status;
}
export const STATE_TONE: Record<string, 'neutral' | 'warning' | 'primary' | 'success' | 'danger'> = {
  Draft: 'neutral', Submitted: 'warning', 'On hold': 'warning', Approved: 'primary', Reimbursed: 'success', Rejected: 'danger', Cancelled: 'neutral',
};
export const STATE_FILTERS = [
  { key: 'submitted', label: 'Submitted' }, { key: 'on_hold', label: 'On hold' }, { key: 'approved', label: 'Approved' },
  { key: 'paid', label: 'Reimbursed' }, { key: 'rejected', label: 'Rejected' },
];

type Person = { employee_code: string; first_name: string; last_name: string | null; department_id: string | null };

/** The All Claims filters: state, category, department, receipt, search, and (optionally) the cycle month. */
export function filterClaims(rows: ClaimRow[], sp: Record<string, string | undefined>, people: Map<string, Person>) {
  const q = (sp.q ?? '').trim().toLowerCase();
  return rows.filter((c) => {
    if (sp.state) {
      const s = sp.state;
      if (s === 'submitted' && !(c.status === 'pending' && !c.held_at)) return false;
      if (s === 'on_hold' && !(c.status === 'pending' && c.held_at)) return false;
      if (['approved', 'paid', 'rejected', 'cancelled'].includes(s) && c.status !== s) return false;
    }
    if (sp.category && !c.categoryIds.includes(sp.category)) return false;
    const e = people.get(c.employee_id);
    if (sp.department && e?.department_id !== sp.department) return false;
    if (sp.receipt === 'with' && c.receipts === 0) return false;
    if (sp.receipt === 'without' && c.receipts > 0) return false;
    if (sp.cycle && !(c.submitted_at ?? c.created_at).startsWith(sp.cycle)) return false;
    if (q && !`${e?.employee_code ?? ''} ${e?.first_name ?? ''} ${e?.last_name ?? ''} ${c.title} ${c.merchant ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function Panel({ title, actions, children, label }: { title: string; actions?: ReactNode; children: ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="lift-soft rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4"><h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>{actions}</header>
      <div className="pb-2">{children}</div>
    </section>
  );
}

export function Figure({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'warning' | 'success' | 'primary' }) {
  return (
    <div className="lift-soft rounded-2xl border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : tone === 'primary' ? 'text-primary' : ''}`}>{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

export const monthLabel = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
export const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
