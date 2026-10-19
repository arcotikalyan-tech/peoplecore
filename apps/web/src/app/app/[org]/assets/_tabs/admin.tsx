import Link from 'next/link';
import { Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import type { AssetCategory, AssetRow, AssetStatus } from '@/server/assets';
import {
  completeRepairAction, decideAssetRequestAction, deleteAssetCategoryAction, importAssetsAction, saveAssetCategoryAction, settleRecoveryAction,
} from '../actions';
import { CategoryForm, CompleteRepairForm, DecideRequestForm, ImportAssetsForm, SettleForm, SmallAction } from '../assets-forms';
import { ASSET_STATUS_LABEL, ASSET_TONE, bookValue, CONDITION_LABEL, CONDITIONS, DUES_LABEL, REQUEST_LABEL, REQUEST_TONE } from '../tone';
import { filterAssets } from './filter';

type Request = { id: string; employee_id: string; category_id: string; reason: string; status: string; asset_id: string | null; decided_at: string | null; decision_note: string | null; created_at: string };
type Repair = { id: string; asset_id: string; vendor: string | null; issue: string; sent_on: string; expected_back_on: string | null; completed_on: string | null; cost: number | null; outcome: string | null; created_at: string };
type Issue = {
  id: string; asset_id: string; employee_id: string; assigned_at: string; returned_at: string | null; acknowledged_at: string | null;
  recovery_amount: number | null; recovery_note: string | null; recovery_status: string | null; recovery_settled_at: string | null;
};

export interface AdminProps {
  slug: string;
  base: string;
  today: string;
  sp: Record<string, string | undefined>;
  assets: AssetRow[];
  categories: AssetCategory[];
  requests: Request[];
  repairs: Repair[];
  issues: Issue[];
  people: Map<string, { code: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
}

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const sel = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm';
const th = 'px-3 py-2 font-semibold';
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function Empty({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <tr><td colSpan={cols} className="px-5 py-8 text-center text-sm text-muted">{children}</td></tr>;
}

export function HubTab({ base, today, assets, categories, requests, repairs, issues, people }: AdminProps) {
  const life = new Map(categories.map((c) => [c.id, c.useful_life_months]));
  const count = (s: AssetStatus) => assets.filter((a) => a.status === s).length;
  const live = assets.filter((a) => a.status !== 'retired' && a.status !== 'lost');
  const book = live.reduce((sum, a) => sum + bookValue(a.purchase_cost, a.purchased_on, life.get(a.category_id), today), 0);
  const open = requests.filter((r) => r.status === 'pending' || r.status === 'approved').length;
  const inRepair = repairs.filter((r) => !r.completed_on).length;
  const expiring = live.filter((a) => a.warranty_until && a.warranty_until >= today && a.warranty_until <= addDays(today, 30)).length;
  const assetName = new Map(assets.map((a) => [a.id, `${a.name} (${a.tag})`]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const who = (id: string) => people.get(id)?.name ?? 'Employee';
  const events = [
    ...issues.flatMap((x) => [
      { at: x.assigned_at, asset: assetName.get(x.asset_id), action: 'Assigned', who: who(x.employee_id) },
      ...(x.returned_at ? [{ at: x.returned_at, asset: assetName.get(x.asset_id), action: 'Returned', who: who(x.employee_id) }] : []),
    ]),
    ...repairs.flatMap((r) => [
      { at: r.created_at, asset: assetName.get(r.asset_id), action: 'Sent for repair', who: r.vendor ?? '—' },
      ...(r.completed_on ? [{ at: `${r.completed_on}T23:59:59Z`, asset: assetName.get(r.asset_id), action: 'Repaired', who: r.vendor ?? '—' }] : []),
    ]),
    ...requests.map((r) => ({ at: r.created_at, asset: catName.get(r.category_id), action: 'Requested', who: who(r.employee_id) })),
  ].filter((e) => e.asset).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const fleet = categories.map((c) => ({ c, n: live.filter((a) => a.category_id === c.id).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const top = Math.max(1, ...fleet.map((x) => x.n));
  const summary = [open && `${open} open request${open === 1 ? '' : 's'}`, inRepair && `${inRepair} in repair`, expiring && `${expiring} warrant${expiring === 1 ? 'y' : 'ies'} expiring in 30 days`].filter(Boolean);
  const quick = [
    { icon: '💻', title: 'Add asset', note: 'Register new hardware', href: `${base}/new` },
    { icon: '🤝', title: 'Assign asset', note: 'Hand out to an employee', href: `${base}?tab=register&status=in_stock` },
    { icon: '🧾', title: 'Settle dues', note: 'FnF & recoveries', href: `${base}?tab=dues` },
    { icon: '⬆', title: 'Bulk import', note: 'CSV upload', href: `${base}?tab=register#import` },
  ];

  return (
    <div className="space-y-5">
      <section aria-label="Summary" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Asset summary</p>
          <p className="mt-1 text-sm">{summary.length ? `${summary.join(' · ')}.` : 'Everything looks in order — no open requests, repairs, or expiring warranties.'}</p>
        </div>
        <Link className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-subtle" href={`${base}?tab=requests`}>Review requests</Link>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total assets" value={live.length} note={`${inr.format(book)} book value`} />
        <StatCard label="Assigned" value={count('assigned')} note={live.length ? `${Math.round((count('assigned') / live.length) * 100)}% of the fleet` : '—'} tone="primary" href={`${base}?tab=register&status=assigned`} />
        <StatCard label="Available" value={count('in_stock')} note="ready to issue" tone="success" href={`${base}?tab=register&status=in_stock`} />
        <StatCard label="In repair" value={count('in_repair')} note="under maintenance" tone="warning" href={`${base}?tab=repairs`} />
      </div>
      <Panel title="Quick actions">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quick.map((q) => (
            <li key={q.title}><Link href={q.href} className="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-subtle">
              <span aria-hidden className="text-xl">{q.icon}</span><span><span className="block text-sm font-medium">{q.title}</span><span className="block text-xs text-muted">{q.note}</span></span>
            </Link></li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Recent activity" flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Recent activity">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Asset</th><th className={th}>Action</th><th className={th}>Who</th><th className={th}>When</th></tr></thead>
              <tbody className="divide-y divide-line">
                {events.length === 0 && <Empty cols={4}>No activity</Empty>}
                {events.map((e, i) => (
                  <tr key={i}><td className="px-5 py-2">{e.asset}</td><td className="px-3">{e.action}</td><td className="px-3">{e.who}</td><td className="px-3 text-muted">{formatDate(e.at.slice(0, 10))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Fleet by category">
          {fleet.length === 0 ? <p className="text-sm text-muted">No assets yet</p> : (
            <ul className="space-y-2" aria-label="Fleet by category">
              {fleet.map(({ c, n }) => (
                <li key={c.id} className="text-sm">
                  <div className="flex justify-between"><span>{c.icon ? `${c.icon} ` : ''}{c.name}</span><span className="tabular-nums text-muted">{n}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(n / top) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function RegisterTab({ slug, base, today, sp, assets, categories, people, locations }: AdminProps) {
  const who = (id: string) => people.get(id)?.name ?? '';
  const rows = filterAssets(assets, sp, who);
  const loc = new Map(locations.map((l) => [l.id, l.name]));
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== 'tab')).toString();
  return (
    <Panel title="Asset Register" meta={`${rows.length} asset${rows.length === 1 ? '' : 's'}`} flush
      action={<a className="text-sm text-primary hover:underline" href={`${base}/export?${qs}`} download>⬇ Export</a>}>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2 px-5 py-3" aria-label="Filter assets">
        <input type="hidden" name="tab" value="register" />
        <input name="q" type="search" defaultValue={sp.q} placeholder="Search tag, device, serial, person…" aria-label="Search assets" className={`${sel} w-60`} />
        <select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className={sel}>
          <option value="">All statuses</option>
          {(['assigned', 'in_stock', 'in_repair', 'retired', 'lost'] as const).map((s) => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
        </select>
        <select name="category" defaultValue={sp.category ?? ''} aria-label="Category" className={sel}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="condition" defaultValue={sp.condition ?? ''} aria-label="Condition" className={sel}><option value="">Any condition</option>{CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        {locations.length > 0 && <select name="location" defaultValue={sp.location ?? ''} aria-label="Location" className={sel}><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">⨁ Filter</button>
        {qs && <Link href={`${base}?tab=register`} className="text-sm text-muted hover:text-fg">Clear</Link>}
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Asset register">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-2">Category</th><th className={th}>Device name</th><th className={th}>Serial number</th><th className={th}>Assigned to</th><th className={th}>Status</th><th className={th}>Condition</th><th className={th}>Location</th><th className={th}>Action</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <Empty cols={8}>{assets.length ? 'No assets match.' : 'No assets'}</Empty>}
            {rows.slice(0, 500).map((a) => (
              <tr key={a.id}>
                <td className="px-5 py-2">{a.category}</td>
                <td className="px-3"><span className="font-medium">{a.name}</span><span className="block text-xs text-muted tabular-nums">{a.tag}</span></td>
                <td className="px-3 tabular-nums text-muted">{a.serial_number ?? '—'}</td>
                <td className="px-3">{a.issue ? (
                  <span className="flex flex-wrap items-center gap-1">{who(a.issue.employee_id) || '—'}
                    {!a.issue.acknowledged_at && <Badge tone="warning">Not confirmed</Badge>}
                    {a.issue.due_back_on && a.issue.due_back_on < today && <Badge tone="danger">Overdue</Badge>}</span>
                ) : <span className="text-muted">—</span>}</td>
                <td className="px-3"><Badge tone={ASSET_TONE[a.status as AssetStatus]}>{ASSET_STATUS_LABEL[a.status as AssetStatus]}</Badge></td>
                <td className="px-3">{CONDITION_LABEL[a.condition] ?? a.condition}</td>
                <td className="px-3 text-muted">{a.location_id ? loc.get(a.location_id) ?? '—' : '—'}</td>
                <td className="px-3"><Link className="text-primary hover:underline" href={`${base}/${a.id}`} aria-label={`View ${a.name}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && <p className="px-5 pt-3 text-xs text-muted">Showing the first 500. Filter, or export for the full list.</p>}
      <div id="import" className="px-5 pt-4"><ImportAssetsForm action={importAssetsAction.bind(null, slug)} templateHref={`${base}/template`} /></div>
    </Panel>
  );
}

export function RequestsTab({ slug, base, sp, assets, categories, requests, people }: AdminProps) {
  const view = ['open', 'all'].includes(sp.view ?? '') ? sp.view! : 'open';
  const rows = view === 'open' ? requests.filter((r) => r.status === 'pending' || r.status === 'approved') : requests;
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const stock = (categoryId: string) => assets.filter((a) => a.status === 'in_stock' && a.category_id === categoryId).map((a) => ({ value: a.id, label: `${a.name} (${a.tag})` }));
  return (
    <Panel title="Asset Requests" meta={`${rows.length} request${rows.length === 1 ? '' : 's'}`} flush>
      <div className="px-5"><SubTabs base={base} label="Request views" current={view} extra={{ tab: 'requests' }}
        tabs={[{ key: 'open', label: 'Open', count: requests.filter((r) => r.status === 'pending' || r.status === 'approved').length }, { key: 'all', label: 'All' }]} /></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Asset requests">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-2">Requester</th><th className={th}>Category</th><th className={th}>Reason</th><th className={th}>Raised</th><th className={th}>Status</th><th className={th}>Action</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <Empty cols={6}>No requests</Empty>}
            {rows.map((r) => {
              const person = people.get(r.employee_id)?.name ?? 'Employee';
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-5 py-2 font-medium">{person}</td>
                  <td className="px-3 py-2">{cat.get(r.category_id) ?? '—'}</td>
                  <td className="max-w-xs px-3 py-2">{r.reason}{r.decision_note && <span className="block text-xs text-muted">Note: {r.decision_note}</span>}</td>
                  <td className="px-3 py-2 text-muted">{formatDate(r.created_at.slice(0, 10))}</td>
                  <td className="px-3 py-2"><Badge tone={REQUEST_TONE[r.status]}>{REQUEST_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="px-3 py-2">
                    {r.status === 'pending' || r.status === 'approved'
                      ? <DecideRequestForm action={decideAssetRequestAction.bind(null, slug)} requestId={r.id} label={`${person}: ${cat.get(r.category_id) ?? ''}`}
                          stock={stock(r.category_id)} approved={r.status === 'approved'} />
                      : r.asset_id ? <Link className="text-primary hover:underline" href={`${base}/${r.asset_id}`}>View asset</Link> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function CategoriesTab({ slug, assets, categories }: AdminProps) {
  const used = (id: string) => assets.filter((a) => a.category_id === id).length;
  return (
    <div className="space-y-5">
      <Panel title="Add category">
        <CategoryForm action={saveAssetCategoryAction.bind(null, slug)} />
      </Panel>
      <Panel title="Asset Categories" meta={`${categories.length}`}>
        {categories.length === 0 ? <p className="text-sm text-muted">No categories yet — add your first category.</p> : (
          <ul className="divide-y divide-line" aria-label="Asset categories">
            {categories.map((c) => (
              <li key={c.id} className="py-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{c.icon ? `${c.icon} ` : ''}{c.name} <span className="text-sm font-normal text-muted">· {used(c.id)} asset{used(c.id) === 1 ? '' : 's'}{c.useful_life_months ? ` · ${c.useful_life_months} months life` : ''}{c.requestable ? '' : ' · not requestable'}</span></p>
                  {used(c.id) === 0 && <SmallAction action={deleteAssetCategoryAction.bind(null, slug)} fields={{ categoryId: c.id }} label="Delete" aria={`Delete ${c.name}`} />}
                </div>
                <details><summary className="cursor-pointer text-sm text-primary">Edit</summary>
                  <div className="pt-3"><CategoryForm action={saveAssetCategoryAction.bind(null, slug)} category={c} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function RepairsTab({ slug, base, today, assets, repairs }: AdminProps) {
  const asset = new Map(assets.map((a) => [a.id, a]));
  const open = repairs.filter((r) => !r.completed_on);
  const done = repairs.filter((r) => r.completed_on);
  const spent = done.reduce((s, r) => s + (r.cost ?? 0), 0);
  return (
    <div className="space-y-5">
      <Panel title="Out for repair" meta={`${open.length}`} flush>
        <p className="px-5 pb-2 text-xs text-muted">Send an asset for repair from its page. When it comes back, record the cost and where it goes.</p>
        <ul className="divide-y divide-line" aria-label="Open repairs">
          {open.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing is out for repair.</li>}
          {open.map((r) => {
            const a = asset.get(r.asset_id);
            return (
              <li key={r.id} className="space-y-2 px-5 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium text-primary hover:underline" href={`${base}/${r.asset_id}`}>{a ? `${a.name} (${a.tag})` : 'Asset'}</Link>
                  {r.expected_back_on && r.expected_back_on < today && <Badge tone="danger">Overdue</Badge>}
                </p>
                <p className="text-xs text-muted">{[r.issue, r.vendor, `sent ${formatDate(r.sent_on)}`, r.expected_back_on && `expected ${formatDate(r.expected_back_on)}`].filter(Boolean).join(' · ')}</p>
                <CompleteRepairForm action={completeRepairAction.bind(null, slug)} repairId={r.id} label={a?.name ?? 'asset'} />
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Repair history" meta={`${done.length} · ${inr.format(spent)} spent`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Repair history">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Asset</th><th className={th}>Problem</th><th className={th}>Vendor</th><th className={th}>Sent</th><th className={th}>Back</th><th className={`${th} text-right`}>Cost</th><th className={th}>Outcome</th></tr></thead>
            <tbody className="divide-y divide-line">
              {done.length === 0 && <Empty cols={7}>No repairs yet.</Empty>}
              {done.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2">{asset.get(r.asset_id)?.name ?? '—'}</td><td className="px-3">{r.issue}</td><td className="px-3">{r.vendor ?? '—'}</td>
                  <td className="px-3 text-muted">{formatDate(r.sent_on)}</td><td className="px-3 text-muted">{r.completed_on ? formatDate(r.completed_on) : '—'}</td>
                  <td className="px-3 text-right tabular-nums">{r.cost === null ? '—' : inr.format(r.cost)}</td><td className="px-3">{r.outcome === 'retired' ? 'Retired' : 'Available'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function DuesTab({ slug, base, assets, issues, people }: AdminProps) {
  const asset = new Map(assets.map((a) => [a.id, a]));
  const dues = issues.filter((x) => x.recovery_status);
  const pending = dues.filter((x) => x.recovery_status === 'pending');
  const settled = dues.filter((x) => x.recovery_status !== 'pending');
  const total = pending.reduce((s, x) => s + (x.recovery_amount ?? 0), 0);
  const row = (x: Issue) => {
    const a = asset.get(x.asset_id);
    const p = people.get(x.employee_id);
    return { a, p, label: `${p?.name ?? 'Employee'} · ${a?.name ?? 'asset'}` };
  };
  return (
    <div className="space-y-5">
      <Panel title="Pending dues" meta={`${pending.length} · ${inr.format(total)}`} flush>
        <p className="px-5 pb-2 text-xs text-muted">Record dues for a lost, damaged or unreturned asset on the asset’s page (issue history). Deductions go to the next payroll run; for someone leaving, they’re part of the full and final settlement.</p>
        <ul className="divide-y divide-line" aria-label="Pending dues">
          {pending.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">No dues to settle.</li>}
          {pending.map((x) => {
            const { a, p, label } = row(x);
            return (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{p?.name ?? 'Employee'} <span className="font-normal text-muted">{p?.code}</span> · {inr.format(x.recovery_amount ?? 0)}</p>
                  <p className="text-xs text-muted"><Link className="text-primary hover:underline" href={`${base}/${x.asset_id}`}>{a ? `${a.name} (${a.tag})` : 'Asset'}</Link> · {x.recovery_note}{x.returned_at ? '' : ' · not returned'}</p>
                </div>
                <SettleForm action={settleRecoveryAction.bind(null, slug)} assignmentId={x.id} label={label} />
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Settled" meta={`${settled.length}`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Settled dues">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Employee</th><th className={th}>Asset</th><th className={th}>For</th><th className={`${th} text-right`}>Amount</th><th className={th}>Settled</th><th className={th}>How</th></tr></thead>
            <tbody className="divide-y divide-line">
              {settled.length === 0 && <Empty cols={6}>Nothing settled yet.</Empty>}
              {settled.map((x) => {
                const { a, p } = row(x);
                return (
                  <tr key={x.id}>
                    <td className="px-5 py-2">{p?.name ?? '—'}</td><td className="px-3">{a?.name ?? '—'}</td><td className="px-3">{x.recovery_note}</td>
                    <td className="px-3 text-right tabular-nums">{inr.format(x.recovery_amount ?? 0)}</td>
                    <td className="px-3 text-muted">{x.recovery_settled_at ? formatDate(x.recovery_settled_at.slice(0, 10)) : '—'}</td>
                    <td className="px-3">{DUES_LABEL[x.recovery_status ?? ''] ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
