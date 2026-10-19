import type { Metadata } from 'next';
import Link from 'next/link';
import { HubTabs, Panel } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import type { CardDesign } from '@/lib/id-cards';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { cardCompany, cardDesigns, cardPeople, cardQr } from '@/server/idcards';
import { getStructure } from '@/server/structure';
import { viewModeFor } from '@/server/view';
import { createDesignAction, deleteDesignAction, saveAdvancedAction, saveFieldsAction, setDefaultDesignAction, setTemplateAction } from './actions';
import { IdCard } from './card';
import { AdvancedForm, FieldsForm, SmallAction, TemplatePicker } from './idstudio-client';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'ID Studio' };

type Search = Record<string, string | undefined>;

/**
 * ID Studio (Kredily's ID cards): designs built in three steps — template, fields and layout, advanced (colours,
 * logo, QR, back) — with a live preview, a default design, and print-ready sheets. Employees see their own card.
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
    const design = designs.find((d) => d.is_default) ?? designs[0] ?? null;
    const person = me ? (await cardPeople(ctx.org.id, { ids: [me.id] }))[0] : undefined;
    const company = await cardCompany(ctx.org.id, ctx.org.name, design);
    return (
      <>
        <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">My ID Card</h1><p className="mt-1 text-sm text-muted">Your company ID card. Print it or keep it on your phone.</p></header>
        {!design || !person ? <Panel title="ID card"><p className="text-sm text-muted">{!person ? 'ID cards are for employees with a profile here.' : 'HR hasn’t designed the ID card yet.'}</p></Panel> : (
          <Panel title={design.name} action={<Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}/print?employee=${person.id}`}>🖨 Print my card</Link>}>
            <IdCard design={design} person={person} company={company.name} logoUrl={company.logoUrl} qrSvg={await cardQr(design, person, company.name)} />
          </Panel>
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
    return <IdCard design={d} person={sample} company={company.name} logoUrl={company.logoUrl} qrSvg={await cardQr(d, sample, company.name)} />;
  };
  const structure = await getStructure(ctx.org.id);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ID Studio</h1>
          <p className="mt-1 text-sm text-muted">Design ID cards in three steps and print them for everyone.{design ? ` Editing “${design.name}”.` : ''}</p>
        </div>
        {designs.length > 0 && (
          <form method="get" action={`${base}/print`} className="flex flex-wrap items-end gap-2" aria-label="Print cards">
            <select name="design" defaultValue={designs.find((d) => d.is_default)?.id} aria-label="Design" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              {designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select name="department" aria-label="Who" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
              <option value="">Everyone</option>{structure.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">🖨 Print cards</button>
          </form>
        )}
      </header>
      <HubTabs base={base} label="ID Studio steps" tabs={tabs} current={tab} extra={extra} />

      {tab === 'hub' && (
        <div className="space-y-5">
          <Panel title="Designs" meta={`${designs.length}`}>
            {designs.length === 0 ? <p className="text-sm text-muted">No designs yet. Start from a template.</p> : (
              <ul className="grid gap-5 lg:grid-cols-2" aria-label="Designs">
                {await Promise.all(designs.map(async (d) => (
                  <li key={d.id} className="space-y-3 rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{d.name} {d.is_default && <Badge tone="success">Default</Badge>}</p>
                      <span className="flex flex-wrap items-center gap-2">
                        <Link className="text-sm text-primary hover:underline" href={`${base}?tab=fields&design=${d.id}`}>Edit</Link>
                        {!d.is_default && <SmallAction action={setDefaultDesignAction.bind(null, slug)} fields={{ designId: d.id }} label="Make default" aria={`Make ${d.name} the default`} variant="secondary" />}
                        <SmallAction action={deleteDesignAction.bind(null, slug)} fields={{ designId: d.id }} label="Delete" aria={`Delete ${d.name}`} />
                      </span>
                    </div>
                    {await preview(d)}
                  </li>
                )))}
              </ul>
            )}
          </Panel>
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
