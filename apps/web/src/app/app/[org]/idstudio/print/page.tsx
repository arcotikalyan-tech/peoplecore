import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { cardCompany, cardDesigns, cardPeople, cardQr } from '@/server/idcards';
import { IdCard } from '../card';
import { PrintButton } from '../idstudio-client';

export const metadata: Metadata = { title: 'Print cards' };

/** A print-ready sheet of ID or visiting cards: HR prints everyone or a department; anyone prints their own (RLS decides). */
export default async function PrintCardsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const designs = await cardDesigns(ctx.org.id);
  const design = designs.find((d) => d.id === sp.design) ?? designs.find((d) => d.is_default && d.card_type === 'id') ?? designs.find((d) => d.card_type === 'id') ?? designs[0];
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const hr = ctx.can('org.manage', 'org') && ctx.can('employee.read', 'org');
  const uuid = /^[0-9a-f-]{36}$/i;
  const people = !design ? [] : hr
    ? await cardPeople(ctx.org.id, sp.employee && uuid.test(sp.employee) ? { ids: [sp.employee] } : sp.department && uuid.test(sp.department) ? { departmentId: sp.department } : {})
    : me ? await cardPeople(ctx.org.id, { ids: [me.id] }) : [];
  const company = await cardCompany(ctx.org.id, ctx.org.name, design ?? null);
  const cards = design ? await Promise.all(people.map(async (p) => ({ p, qr: await cardQr(design, p, company.name) }))) : [];
  const visiting = design?.card_type === 'visiting';
  const size = visiting ? '89 × 51 mm' : design?.orientation === 'landscape' ? '86 × 54 mm' : '54 × 86 mm';
  return (
    <>
      <style>{`@media print { @page { margin: 8mm; } header, nav, aside, .print\\:hidden { display: none !important; } body { background: #fff !important; } .idcard { break-inside: avoid; } }`}</style>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div><Link href={`/app/${slug}/idstudio`} className="text-sm text-muted hover:text-fg">← ID Studio</Link>
          <h1 className="text-2xl font-semibold tracking-tight">{visiting ? 'Print visiting cards' : 'Print ID cards'}</h1>
          <p className="text-sm text-muted">{design ? `${design.name} · ${cards.length} card${cards.length === 1 ? '' : 's'} · front and back, at card size (${size}).` : 'No design yet.'}</p></div>
        {cards.length > 0 && <PrintButton />}
      </div>
      <div className="flex flex-wrap gap-6" aria-label="Cards">
        {design && cards.map(({ p, qr }) => <IdCard key={p.id} design={design} person={p} company={company.name} website={company.website} logoUrl={company.logoUrl} qrSvg={qr} />)}
      </div>
    </>
  );
}
