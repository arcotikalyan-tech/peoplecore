import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';
import { hours, money, tsWorkspace } from '@/server/timesheet';

export const metadata: Metadata = { title: 'Invoice' };

/** A printable invoice: lines by project and task at the rates fixed on each log. timesheet.manage only (RLS). */
export default async function InvoicePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: inv } = await supabase.from('ts_invoices').select('*').eq('organization_id', ctx.org.id).eq('id', id).maybeSingle();
  if (!inv) notFound();
  const [ws, { data: entries }, { data: company }] = await Promise.all([
    tsWorkspace(ctx.org.id),
    supabase.from('ts_entries').select('project_id, task_id, minutes, rate').eq('invoice_id', id),
    supabase.from('company_profiles').select('legal_name, gstin, email').eq('organization_id', ctx.org.id).maybeSingle(),
  ]);
  const client = ws.clients.find((c) => c.id === inv.client_id);
  const lines = new Map<string, { label: string; minutes: number; rate: number; amount: number }>();
  for (const e of entries ?? []) {
    const rate = Number(e.rate ?? 0);
    const key = `${e.project_id}|${e.task_id ?? ''}|${rate}`;
    const label = `${ws.projects.find((p) => p.id === e.project_id)?.name ?? 'Project'}${e.task_id ? ` · ${ws.tasks.find((t) => t.id === e.task_id)?.name ?? ''}` : ''}`;
    const l = lines.get(key) ?? { label, minutes: 0, rate, amount: 0 };
    l.minutes += e.minutes; l.amount += (e.minutes / 60) * rate;
    lines.set(key, l);
  }
  const cur = inv.currency;
  return (
    <div className="mx-auto max-w-3xl space-y-6 rounded-xl border border-line bg-surface p-8 print:border-0 print:p-0">
      <div className="flex justify-between gap-4 print:hidden">
        <Link href={`/app/${slug}/timesheet?tab=finance`} className="text-sm text-primary">← Finance</Link>
        <span className="text-xs text-muted">Use your browser’s Print to save as PDF.</span>
      </div>
      <header className="flex flex-wrap justify-between gap-4">
        <div><p className="text-xl font-semibold">{company?.legal_name ?? ctx.org.name}</p>{company?.gstin && <p className="text-xs text-muted">GSTIN {company.gstin}</p>}{company?.email && <p className="text-xs text-muted">{company.email}</p>}</div>
        <div className="text-right"><p className="text-2xl font-semibold">Invoice</p><p className="font-mono">{inv.number}</p><p className="text-xs text-muted">Issued {inv.created_at.slice(0, 10)} · {inv.status}</p></div>
      </header>
      <section className="text-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Bill to</p>
        <p className="font-medium">{client?.organisation ?? client?.name}</p>
        {client?.gstin && <p className="text-xs text-muted">GSTIN {client.gstin}</p>}{client?.email && <p className="text-xs text-muted">{client.email}</p>}
        <p className="mt-2 text-xs text-muted">Period {inv.period_from} to {inv.period_to}</p>
      </section>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase text-muted"><th className="py-2">Description</th><th className="py-2 text-right">Hours</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr></thead>
        <tbody>{[...lines.values()].map((l) => (
          <tr key={`${l.label}${l.rate}`} className="border-b border-line"><td className="py-2">{l.label}</td><td className="py-2 text-right tabular-nums">{hours(l.minutes)}</td><td className="py-2 text-right tabular-nums">{money(l.rate, cur)}</td><td className="py-2 text-right tabular-nums">{money(l.amount, cur)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td className="py-3 font-semibold">Total</td><td className="py-3 text-right tabular-nums">{hours(inv.minutes)}</td><td /><td className="py-3 text-right text-lg font-semibold tabular-nums">{money(Number(inv.total), cur)}</td></tr></tfoot>
      </table>
      <p className="text-xs text-muted">Taxes, if any, are not included. Rates are those in force on each log’s date.</p>
    </div>
  );
}
