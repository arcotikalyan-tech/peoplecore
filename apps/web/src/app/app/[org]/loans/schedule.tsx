import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { INSTALMENT_LABEL } from '@/lib/loans';
import type { InstalmentRow } from '@/server/loans';

export const month = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const th = 'px-3 py-2 font-semibold';

export function ScheduleTable({ rows }: { rows: InstalmentRow[] }) {
  const n = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Repayment schedule">
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">#</th><th className={th}>Month</th><th className={`${th} text-right`}>Opening</th><th className={`${th} text-right`}>Principal</th><th className={`${th} text-right`}>Interest</th><th className={`${th} text-right`}>EMI</th><th className={th}>Status</th></tr></thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-5 py-2">{r.seq}</td><td className="px-3">{month(r.due_month)}</td><td className="px-3 text-right">{n.format(r.opening_balance)}</td>
              <td className="px-3 text-right">{n.format(r.principal)}</td><td className="px-3 text-right">{n.format(r.interest)}</td><td className="px-3 text-right font-medium">{n.format(r.emi)}</td>
              <td className="px-3"><Badge tone={r.status === 'paid' ? 'success' : r.status === 'queued' ? 'primary' : 'neutral'}>{INSTALMENT_LABEL[r.status] ?? r.status}</Badge>{r.paid_at && <span className="ml-1 text-xs text-muted">{formatDate(r.paid_at.slice(0, 10))}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

