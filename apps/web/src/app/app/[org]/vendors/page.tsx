import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { HubHeader, HubTabs, Panel, StatCard } from '@/components/ui/hub';
import { getOrgContext } from '@/server/context';
import { requireModule } from '@/server/modules';
import { createClient } from '@/server/supabase';
import { ButtonAction } from '../settings/settings-client';
import { archiveVendorAction, paymentsAction, recordPaymentAction, saveVendorAction } from './actions';
import { PaymentBoard, PaymentForm, VendorForm, type PaymentRow, type VendorRow } from './vendors-client';

export const metadata: Metadata = { title: 'Vendor payouts' };

type Search = Record<string, string | undefined>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * Vendor payouts (Kredily's Vendor Payout): vendors and contractors with their TDS section and bank account, invoices
 * to pay with TDS worked out, approval by a second person, the bank file, and paid with the UTR. vendor.manage only.
 */
export default async function VendorsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('vendor.manage', 'org')) notFound();
  await requireModule(ctx.org.id, 'vendors');
  const base = `/app/${slug}/vendors`;
  const today = todayIn(ctx.org.timezone);
  const supabase = await createClient();
  const [{ data: vendors }, { data: payments }] = await Promise.all([
    supabase.from('vendors').select('*').eq('organization_id', ctx.org.id).order('name'),
    supabase.from('vendor_payments').select('*').eq('organization_id', ctx.org.id).order('created_at', { ascending: false }).limit(1000),
  ]);
  const all = (vendors ?? []) as VendorRow[];
  const byId = new Map(all.map((v) => [v.id, v.name]));
  const rows: PaymentRow[] = (payments ?? []).map((p) => ({
    id: p.id, vendor: byId.get(p.vendor_id) ?? '—', invoice: p.invoice_number, invoiceDate: p.invoice_date, gross: Number(p.gross_amount), tds: Number(p.tds_amount),
    net: Number(p.net_amount), section: p.tds_section, due: p.due_date, status: p.status, reference: p.reference, paidOn: p.paid_on, note: p.decision_note,
    mine: p.created_by === ctx.user.id,
  }));
  const sum = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + r.net, 0);
  const n = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
  const month = today.slice(0, 7);
  const tdsThisMonth = rows.filter((r) => r.status === 'paid' && r.paidOn?.startsWith(month)).reduce((s, r) => s + r.tds, 0);

  const tabs = [
    { key: 'payments', label: 'Payments', count: n(['submitted']) || null },
    { key: 'vendors', label: 'Vendors', count: null },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'payments';
  const view = ['open', 'paid', 'all'].includes(sp.view ?? '') ? sp.view! : 'open';
  const shown = rows.filter((r) => view === 'all' || (view === 'paid' ? r.status === 'paid' : ['submitted', 'approved', 'failed'].includes(r.status)));
  const active = all.filter((v) => !v.archived_at);
  const tdsLabel = (v: VendorRow) => (v.tds_section === 'none' ? 'no TDS' : `${v.tds_section} ${Number(v.tds_rate)}%`);

  return (
    <>
      <HubHeader title="Vendor payouts" subtitle="Pay contractors, consultants and suppliers: TDS, a second approver, the bank file and the UTR." />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="To approve" value={inr.format(sum(['submitted']))} note={`${n(['submitted'])} invoices`} tone="warning" href={`${base}?tab=payments&view=open`} />
        <StatCard label="Approved, to pay" value={inr.format(sum(['approved', 'failed']))} note={`${n(['approved', 'failed'])} invoices`} />
        <StatCard label="Paid this month" value={inr.format(rows.filter((r) => r.status === 'paid' && r.paidOn?.startsWith(month)).reduce((s, r) => s + r.net, 0))} tone="success" />
        <StatCard label="TDS deducted this month" value={inr.format(tdsThisMonth)} note="Deposit by the 7th of next month (Challan 281)" />
      </div>
      <HubTabs base={base} label="Vendor payout sections" tabs={tabs} current={tab} />

      {tab === 'payments' && (
        <div className="space-y-5">
          <Panel title="Record an invoice" meta={active.length ? undefined : 'Add a vendor first.'}>
            {active.length ? <PaymentForm action={recordPaymentAction.bind(null, slug)} today={today} vendors={active.map((v) => ({ id: v.id, name: v.name, tds: tdsLabel(v) }))} />
              : <a href={`${base}?tab=vendors`} className={buttonClass('secondary', 'sm')}>＋ Add a vendor</a>}
          </Panel>
          <Panel title="Payments" action={
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label="Which payments" className="flex gap-1 text-sm">
                {[['open', 'Open'], ['paid', 'Paid'], ['all', 'All']].map(([k, l]) => (
                  <a key={k} href={`${base}?tab=payments&view=${k}`} aria-current={view === k ? 'page' : undefined}
                    className={`rounded-md px-2 py-1 ${view === k ? 'bg-subtle font-medium' : 'text-muted hover:text-fg'}`}>{l}</a>
                ))}
              </nav>
              {n(['approved', 'failed']) > 0 && <a href={`${base}/bank-advice`} className={buttonClass('primary', 'sm')} download>⬇ Bank file ({n(['approved', 'failed'])})</a>}
            </div>
          }>
            <p className="mb-3 text-xs text-muted">Whoever records an invoice can’t approve it. The bank file has approved and failed payments; upload it to your bank, then mark them paid with the UTR.</p>
            <PaymentBoard action={paymentsAction.bind(null, slug)} rows={shown} today={today} />
          </Panel>
        </div>
      )}

      {tab === 'vendors' && (
        <div className="space-y-5">
          <Panel title="Add a vendor"><VendorForm action={saveVendorAction.bind(null, slug)} /></Panel>
          <Panel title="Vendors" meta={`${active.length} active`}>
            {all.length === 0 ? <p className="text-sm text-muted">No vendors yet.</p> : (
              <ul className="divide-y divide-line">
                {all.map((v) => (
                  <li key={v.id} className="py-3">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                        <span><span className="font-medium">{v.name}</span>{v.archived_at && <span className="ml-2 text-xs text-muted">Archived</span>}
                          <span className="block text-xs text-muted">{[v.kind, v.pan, tdsLabel(v), v.account_number ? `${v.bank_name ?? 'Bank'} ••${v.account_number.slice(-4)}` : 'No bank account'].filter(Boolean).join(' · ')}</span></span>
                        <span className="text-xs text-primary">Edit</span>
                      </summary>
                      <div className="mt-3 space-y-3 rounded-xl border border-line p-4">
                        <VendorForm action={saveVendorAction.bind(null, slug)} vendor={v} />
                        <ButtonAction action={archiveVendorAction.bind(null, slug, v.id, !v.archived_at)} aria={`${v.archived_at ? 'Restore' : 'Archive'} ${v.name}`} label={v.archived_at ? 'Restore' : 'Archive'} variant="ghost" />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
