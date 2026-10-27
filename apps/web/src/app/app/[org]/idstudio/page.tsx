import type { Metadata } from 'next';
import Link from 'next/link';
import { HubTabs, Panel } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { CARD_TYPE_LABELS, type CardDesign, type CardType } from '@/lib/id-cards';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { cardCompany, cardDesigns, cardPeople, cardQr } from '@/server/idcards';
import { getStructure } from '@/server/structure';
import { viewModeFor } from '@/server/view';
import { createDesignAction, deleteDesignAction, rollOutDesignAction, saveAdvancedAction, saveFieldsAction, setDefaultDesignAction, setTemplateAction } from './actions';
import { IdCard } from './card';
import { AdvancedForm, FieldsForm, SmallAction, TemplatePicker } from './idstudio-client';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'ID Studio' };

type Search = Record<string, string | undefined>;
const KINDS: CardType[] = ['id', 'visiting'];
/** The design used for a kind of card: its default, else the first one made. */
const designFor = (designs: CardDesign[], kind: CardType) => designs.find((d) => d.card_type === kind && d.is_default) ?? designs.find((d) => d.card_type === kind) ?? null;

/**
 * ID Studio (Kredily's ID cards): ID and visiting card designs built in three steps — template, fields and layout,
 * advanced (colours, logo, QR, back) — with a live preview, a default per kind, roll-out to everyone, print-ready
 * sheets and an SVG export. Employees see their own cards.
 */
export default async function IdStudioPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'idstudio');
  const base = `/app/${slug}/idstudio`;
  const admin = ctx.can('org.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const designs = await cardDesigns(ctx.org.id);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);

  if (!admin) {
    const person = me ? (await cardPeople(ctx.org.id, { ids: [me.id] }))[0] : undefined;
    const mine = KINDS.map((k) => designFor(designs, k)).filter((d): d is CardDesign => !!d);
    return (
      <>
        <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">My ID Card</h1><p className="mt-1 text-sm text-muted">Your company cards. Print them or keep them on your phone.</p></header>
        {!mine.length || !person ? <Panel title="ID card"><p className="text-sm text-muted">{!person ? 'ID cards are for employees with a profile here.' : 'HR hasn’t designed the ID card yet.'}</p></Panel> : (
          <div className="space-y-5">
            {await Promise.all(mine.map(async (design) => {
              const company = await cardCompany(ctx.org.id, ctx.org.name, design);
              const label = design.card_type === 'visiting' ? 'visiting card' : 'card';
              return (
                <Panel key={design.id} title={design.card_type === 'visiting' ? `My visiting card · ${design.name}` : design.name} action={
                  <span className="flex flex-wrap gap-2">
                    <a className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-subtle" href={`${base}/export?design=${design.id}`}>⤓ Download my {label} (SVG)</a>
                    <Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}/print?design=${design.id}`}>🖨 Print my {label}</Link>
                  </span>
                }>
                  <IdCard design={design} person={person} company={company.name} website={company.website} logoUrl={company.logoUrl} qrSvg={await cardQr(design, person, company.name)} />
                </Panel>
              );
            }))}
          </div>
        )}
      </>
    );
  }

  const design = designs.find((d) => d.id === sp.design) ?? null;
  const tabs = [{ key: 'hub', label: '✦ Hub' }, { key: 'templates', label: '1 · Templates' }, { key: 'fields', label: '2 · Fields & Layout' }, { key: 'advanced', label: '3 · Advanced' }];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const extra = design ? { design: design.id } : undefined;
  const sample = me ? (await cardPeople(ctx.org.id, { ids: [me.id] }))[0] : (await cardPeople(ctx.org.id))[0];
  const preview = async (d: CardDesign) => {
    if (!sample) return <p className="text-sm text-muted">Add an employee to preview cards.</p>;
    const company = await cardCompany(ctx.org.id, ctx.org.name, d);
    return <IdCard design={d} person={sample} company={company.name} website={company.website} logoUrl={company.logoUrl} qrSvg={await cardQr(d, sample, company.name)} />;
  };
  const structure = await getStructure(ctx.org.id);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ID Studio</h1>
          <p className="mt-1 text-sm text-muted">Design ID and visiting cards in three steps, roll them out and print them for everyone.{design ? ` Editing “${design.name}”.` : ''}</p>
        </div>
        {designs.length > 0 && (
          <form method="get" action={`${base}/print`} className="flex flex-wrap items-end gap-2" aria-label="Print cards">
            <select name="design" defaultValue={designFor(designs, 'id')?.id ?? designs[0]!.id} aria-label="Design" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              {designs.map((d) => <option key={d.id} value={d.id}>{d.name} · {CARD_TYPE_LABELS[d.card_type as CardType] ?? 'ID card'}</option>)}
            </select>
            <select name="department" aria-label="Who" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              <option value="">Everyone</option>{structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">🖨 Print cards</button>
            <button formAction={`${base}/export`} data-download className="h-9 rounded-lg border border-line px-3 text-sm font-medium hover:bg-subtle">⤓ Export all (SVG)</button>
          </form>
        )}
      </header>
      <HubTabs base={base} label="ID Studio steps" tabs={tabs} current={tab} extra={extra} />

      {tab === 'hub' && (
        <div className="space-y-5">
          {await Promise.all(KINDS.map(async (kind) => {
            const list = designs.filter((d) => d.card_type === kind);
            const title = kind === 'id' ? 'ID cards' : 'Visiting cards';
            return (
              <Panel key={kind} title={title} meta={`${list.length}`}>
                {list.length === 0 ? (
                  <p className="text-sm text-muted">{kind === 'id' ? 'No ID card designs yet. Start from a template below.' : 'No visiting cards yet. Start one below and choose “Visiting card”: name, title and contact details on the front, your website and a QR on the back.'}</p>
                ) : (
                  <ul className="grid gap-5 lg:grid-cols-2" aria-label={`${CARD_TYPE_LABELS[kind]} designs`}>
                    {await Promise.all(list.map(async (d) => (
                      <li key={d.id} className="space-y-3 rounded-xl border border-line p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{d.name} {d.is_default && <Badge tone="success">Default</Badge>}
                            {d.rolled_out_at && <span className="ml-2 text-xs font-normal text-muted">Rolled out {formatDate(d.rolled_out_at)}</span>}</p>
                          <span className="flex flex-wrap items-center gap-2">
                            <Link className="text-sm text-primary hover:underline" href={`${base}?tab=fields&design=${d.id}`}>Edit</Link>
                            {!d.is_default && <SmallAction action={setDefaultDesignAction.bind(null, slug)} fields={{ designId: d.id }} label="Make default" aria={`Make ${d.name} the default`} variant="secondary" />}
                            <SmallAction action={rollOutDesignAction.bind(null, slug, d.id)} fields={{}} label="👥 Roll out to everyone" aria={`Roll out ${d.name}`} variant="secondary" />
                            <a className="text-sm text-primary hover:underline" href={`${base}/export?design=${d.id}`}>⤓ SVGs</a>
                            <SmallAction action={deleteDesignAction.bind(null, slug)} fields={{ designId: d.id }} label="Delete" aria={`Delete ${d.name}`} />
                          </span>
                        </div>
                        {await preview(d)}
                      </li>
                    )))}
                  </ul>
                )}
              </Panel>
            );
          }))}
          <Panel title="Start a new design"><TemplatePicker action={createDesignAction.bind(null, slug)} design={null} mode="create" /></Panel>
        </div>
      )}
      {tab !== 'hub' && !design && (
        <Panel title="Choose a design">
          {designs.length === 0 ? <TemplatePicker action={createDesignAction.bind(null, slug)} design={null} mode="create" /> : (
            <ul className="flex flex-wrap gap-2" aria-label="Pick a design to edit">{designs.map((d) => <li key={d.id}><Link className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-subtle" href={`${base}?tab=${tab}&design=${d.id}`}>{d.name}</Link></li>)}</ul>
          )}
        </Panel>
      )}
      {tab !== 'hub' && design && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
          <Panel title={tab === 'templates' ? 'Templates' : tab === 'fields' ? 'Fields & Layout' : 'Advanced'}>
            {tab === 'templates' && <TemplatePicker action={setTemplateAction.bind(null, slug)} design={design} mode="apply" />}
            {tab === 'fields' && <FieldsForm action={saveFieldsAction.bind(null, slug)} design={design} />}
            {tab === 'advanced' && <AdvancedForm action={saveAdvancedAction.bind(null, slug)} design={design} />}
          </Panel>
          <Panel title="Preview">{await preview(design)}</Panel>
        </div>
      )}
    </>
  );
}
