import Link from 'next/link';
import { SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate, humanize } from '@/lib/format';
import { getBalances, getRequests } from '@/server/leave';
import { getLedger, getRules } from '@/server/leave-ops';
import { Empty, Panel, type ProfileProps } from './shared';

const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}`;

/** Leave: requests, the rules that apply, balances and the accrual history (the ledger). */
export async function LeaveTab(p: ProfileProps) {
  const { ctx, id, sp, today, href, base, isSelf } = p;
  const view = ['requests', 'rules', 'balances', 'accrual'].includes(sp.view ?? '') ? sp.view! : 'balances';
  const tabs = [{ key: 'requests', label: 'Requests' }, { key: 'rules', label: 'My Leave Rules' }, { key: 'balances', label: 'Balances' }, { key: 'accrual', label: 'Accrual History' }];
  const nav = <SubTabs base={href('leave').split('?')[0]!} extra={{ tab: 'leave' }} tabs={tabs} current={view} label="Leave sections" />;
  const balances = await getBalances(id).catch(() => []);
  const typeName = new Map(balances.map((b) => [b.leave_type_id, b.name]));

  if (view === 'balances') {
    return (
      <>
        {nav}
        <Panel title="🏖 Leave Balances">
          <p className="px-5 pt-1 text-sm text-muted">Current available balance across every leave type — entitlement, pending and remaining for this cycle.</p>
          {balances.length === 0 ? <Empty icon="🏖" title="No leave types apply yet" /> : (
            <ul className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Leave balances">
              {balances.map((b) => (
                <li key={b.leave_type_id} className="rounded-2xl border border-line p-4">
                  <p className="text-sm font-semibold">{b.name}</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums">{days(b.available)}<span className="ml-1 text-sm font-normal text-muted">days left</span></p>
                  <p className="mt-1 text-xs text-muted">Balance {days(b.balance)} · Pending {days(b.pending)} · {b.is_paid ? 'Paid' : 'Unpaid'}</p>
                </li>
              ))}
            </ul>
          )}
          {isSelf && <p className="border-t border-line px-5 py-3 text-sm"><Link className="text-primary hover:underline" href={`${base}/leave`}>Apply for leave →</Link></p>}
        </Panel>
      </>
    );
  }

  if (view === 'requests') {
    const requests = await getRequests(ctx.org.id, { employeeId: id });
    const tone = (s: string) => (s === 'approved' ? 'success' : s === 'pending' ? 'warning' : s === 'rejected' ? 'danger' : 'neutral') as 'success';
    return (
      <>
        {nav}
        <Panel title="Leave Requests">
          {requests.length === 0 ? <Empty icon="🗓️" title="No leave requests" /> : (
            <ul className="divide-y divide-line" aria-label="Leave requests">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{typeName.get(r.leave_type_id) ?? 'Leave'}</span> · {r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`}
                    <span className="text-muted"> · {days(r.days)} day{r.days === 1 ? '' : 's'}</span>
                    {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
                  </span>
                  <Badge tone={tone(r.status)}>{humanize(r.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </>
    );
  }

  if (view === 'rules') {
    const { rules } = await getRules(ctx.org.id, today);
    const mine = rules.filter((r) => typeName.has(r.id));
    return (
      <>
        {nav}
        <Panel title="My Leave Rules">
          {mine.length === 0 ? <Empty icon="📐" title="No leave rules apply yet" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Leave rules">
                <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <tr><th className="px-5 py-2">Leave type</th><th className="px-3">Days a year</th><th className="px-3">Accrual</th><th className="px-3">Carry forward</th><th className="px-3">Half day</th><th className="px-3">Paid</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mine.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2 font-medium">{r.name}{r.description && <span className="block text-xs font-normal text-muted">{r.description}</span>}</td>
                      <td className="px-3">{r.policy ? days(r.policy.annual_days) : '—'}</td>
                      <td className="px-3">{r.policy?.accrual_period ? humanize(r.policy.accrual_period) : '—'}</td>
                      <td className="px-3">{r.policy ? (r.policy.carry_forward_max === null ? 'All' : days(r.policy.carry_forward_max)) : '—'}</td>
                      <td className="px-3">{r.allow_half_day ? 'Allowed' : 'No'}</td>
                      <td className="px-3">{r.is_paid ? 'Paid' : 'Unpaid'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </>
    );
  }

  const ledger = (await getLedger(id).catch(() => [])).slice().reverse();
  return (
    <>
      {nav}
      <Panel title="Accrual History">
        {ledger.length === 0 ? <Empty icon="📒" title="No entries yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Accrual history">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Date</th><th className="px-3">Leave type</th><th className="px-3">Entry</th><th className="px-3 text-right">Days</th><th className="px-3">Note</th></tr></thead>
              <tbody className="divide-y divide-line">
                {ledger.slice(0, 300).map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2">{formatDate(l.entry_date)}</td>
                    <td className="px-3">{typeName.get(l.leave_type_id) ?? '—'}</td>
                    <td className="px-3">{humanize(l.kind)}</td>
                    <td className={`px-3 text-right tabular-nums ${l.days < 0 ? 'text-danger' : 'text-success'}`}>{l.days > 0 ? '+' : ''}{days(l.days)}</td>
                    <td className="px-3 text-muted">{l.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
