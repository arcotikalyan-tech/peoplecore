import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Panel } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import type { AssetCategory } from '@/server/assets';
import { acknowledgeAssetAction, cancelAssetRequestAction, requestAssetAction } from '../actions';
import { RequestAssetForm, SmallAction } from '../assets-forms';
import { DUES_LABEL, REQUEST_LABEL, REQUEST_TONE } from '../tone';
import { inr } from './admin';

type Mine = {
  id: string; assigned_at: string; due_back_on: string | null; acknowledged_at: string | null; returned_at: string | null;
  recovery_amount: number | string | null; recovery_note: string | null; recovery_status: string | null;
  asset: { name: string; tag: string; category: string; serial_number: string | null };
};
type Request = { id: string; category_id: string; reason: string; status: string; decision_note: string | null; created_at: string };

export function MyAssetsTab({ slug, mine, access, systems }: {
  slug: string; mine: Mine[];
  access: Array<{ id: string; system_id: string; account: string; access_level: string | null; granted_at: string }>;
  systems: Array<{ id: string; name: string }>;
}) {
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Panel title="Your assets" flush>
        {mine.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing issued to you. Need something? Raise a request.</p> : (
          <ul className="divide-y divide-line" aria-label="Your assets">
            {mine.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{i.asset.name} <span className="font-normal text-muted">{i.asset.tag}</span></p>
                  <p className="mt-0.5 text-xs text-muted">
                    {[i.asset.category, i.asset.serial_number && `Serial ${i.asset.serial_number}`, `Issued ${formatDate(i.assigned_at)}`,
                      i.due_back_on && !i.returned_at && `Due back ${formatDate(i.due_back_on)}`,
                      i.returned_at && `Returned ${formatDate(i.returned_at)}`].filter(Boolean).join(' · ')}
                  </p>
                  {i.recovery_status && (
                    <p className="mt-0.5 text-xs text-warning">Dues {inr.format(Number(i.recovery_amount))} · {i.recovery_note} · {DUES_LABEL[i.recovery_status]}</p>
                  )}
                </div>
                {i.returned_at ? <Badge>Returned</Badge> : i.acknowledged_at ? <Badge tone="success">Confirmed</Badge> : (
                  <ActionForm action={acknowledgeAssetAction.bind(null, slug)} label={`Confirm receipt of ${i.asset.name}`} submit="I have it"
                    hidden={{ assignmentId: i.id }} size="sm" className="flex flex-wrap items-center gap-3" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="space-y-5">
        <Panel title="Your system access" flush>
          {access.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No access recorded.</p> : (
            <ul className="divide-y divide-line" aria-label="Your system access">
              {access.map((g) => (
                <li key={g.id} className="px-5 py-3 text-sm">
                  <p className="font-medium">{systemName.get(g.system_id) ?? 'System'}</p>
                  <p className="mt-0.5 text-xs text-muted">{[g.account, g.access_level, `Since ${formatDate(g.granted_at)}`].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <p className="text-sm text-muted">
          Something broken? <Link className="text-primary hover:underline" href={`/app/${slug}/helpdesk`}>Raise a ticket</Link>.
        </p>
      </div>
    </div>
  );
}

export function MyRequestsTab({ slug, requests, categories, hasEmployee }: { slug: string; requests: Request[]; categories: AssetCategory[]; hasEmployee: boolean }) {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const requestable = categories.filter((c) => c.requestable).map((c) => ({ value: c.id, label: `${c.icon ? `${c.icon} ` : ''}${c.name}` }));
  return (
    <div className="space-y-5">
      {hasEmployee && (
        <Panel title="Request an asset">
          {requestable.length === 0 ? <p className="text-sm text-muted">Nothing can be requested yet. Ask HR.</p>
            : <RequestAssetForm action={requestAssetAction.bind(null, slug)} categories={requestable} />}
        </Panel>
      )}
      <Panel title="My Requests" flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="My requests">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="px-5 py-2">Category</th><th className="px-3">Reason</th><th className="px-3">Raised</th><th className="px-3">Status</th><th className="px-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {requests.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted">No requests yet — raise one above.</td></tr>}
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2">{cat.get(r.category_id) ?? '—'}</td>
                  <td className="px-3">{r.reason}{r.decision_note && <span className="block text-xs text-muted">{r.decision_note}</span>}</td>
                  <td className="px-3 text-muted">{formatDate(r.created_at.slice(0, 10))}</td>
                  <td className="px-3"><Badge tone={REQUEST_TONE[r.status]}>{REQUEST_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="px-3 text-right">{r.status === 'pending' && (
                    <SmallAction action={cancelAssetRequestAction.bind(null, slug)} fields={{ requestId: r.id }} label="Cancel" aria={`Cancel request for ${cat.get(r.category_id) ?? 'asset'}`} />
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
