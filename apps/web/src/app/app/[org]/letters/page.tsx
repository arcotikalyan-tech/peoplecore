import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { BarChart } from '@/components/ui/charts';
import { HubHeader, HubTabs, StatCard, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { letterhead, letterPeople, letterRequests, lettersList, letterTemplates, mergeValues, signatories } from '@/server/letters';
import { viewModeFor } from '@/server/view';
import {
  archiveTemplateAction, closeRequestAction, generateLettersAction, letterStatusAction, releaseLettersAction, removeSignatoryAction,
  requestLetterAction, saveLetterheadAction, saveSignatoryAction, saveTemplateAction,
} from './actions';
import {
  CloseRequestForm, GenerateForm, LetterheadForm, LetterStatusForm, PickForm, ReleaseForm, RemoveSignatoryForm, RequestForm, SignatoryForm, TemplateEditor,
} from './letters-client';

export const metadata: Metadata = { title: 'Letters' };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(',') : []).filter((x) => /^[0-9a-f-]{36}$/.test(x));
const days = (from: string, to = new Date().toISOString()) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 864e5));
const STATUS_TONE = { pending: 'warning', released: 'success', rejected: 'danger', withdrawn: 'neutral', draft: 'primary', cancelled: 'neutral' } as const;

function Panel({ title, actions, children, label }: { title: string; actions?: React.ReactNode; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="lift-soft rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 px-5 pt-4"><h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>{actions}</header>
      <div className="pb-2">{children}</div>
    </section>
  );
}

/**
 * Letters (Kredily's Letter Studio). HR: hub, generate (pick → edit and preview → drafts → release), requests,
 * settings (signatories, letterhead, letter setup with the template editor) and insights. Everyone else: their
 * released letters and self-serve requests. Letters print (or save as PDF) from their own page.
 */
export default async function LettersPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const base = `/app/${slug}/letters`;
  const today = todayIn(ctx.org.timezone);
  const view = await viewModeFor(ctx);
  const manage = ctx.can('letter.manage', 'org') && view === 'admin';
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);

  if (!manage) return <MyLetters slug={slug} base={base} orgId={ctx.org.id} employeeId={me?.id ?? null} />;

  const [templates, requests, letters, people] = await Promise.all([
    letterTemplates(ctx.org.id), letterRequests(ctx.org.id), lettersList(ctx.org.id), letterPeople(ctx.org.id),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const pending = requests.filter((r) => r.status === 'pending');
  const tabs = [
    { key: 'hub', label: 'Hub' }, { key: 'generate', label: 'Generate' }, { key: 'requests', label: 'Letter Requests', count: pending.length },
    { key: 'settings', label: 'Settings' }, { key: 'insights', label: 'Insights' },
  ];
  const tab = tabs.some((t) => t.key === one(sp.tab)) ? one(sp.tab)! : 'hub';
  const released = letters.filter((l) => l.status === 'released');
  const qStart = `${today.slice(0, 5)}${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

  return (
    <>
      <HubHeader title="Letters" badge="Letter Studio" subtitle="Generate, personalize and release every employee letter — one at a time or in bulk, with a live preview as you type." />
      <HubTabs base={base} label="Letters sections" tabs={tabs} current={tab} />

      {tab === 'hub' && (() => {
        const oldest = pending.reduce((m, r) => Math.max(m, days(r.created_at)), 0);
        const quarter = released.filter((l) => (l.released_at ?? '') >= qStart);
        const byType = new Map<string, number>();
        for (const l of quarter) byType.set(l.letter_type, (byType.get(l.letter_type) ?? 0) + 1);
        return (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Pending requests" value={pending.length} note={`${pending.filter((r) => days(r.created_at) > 7).length} over 7 days`} tone={pending.length ? 'warning' : 'muted'} href={`${base}?tab=requests`} />
              <StatCard label="Oldest pending" value={`${oldest}d`} note="target ≤ 3 days" tone={oldest > 3 ? 'danger' : 'muted'} />
              <StatCard label="Released" value={quarter.length} note="this quarter" tone="success" />
              <StatCard label="Templates" value={templates.length} note="across letter types" />
              <StatCard label="Self-serve types" value={templates.filter((t) => t.self_serve).length} note="employees can request" />
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <Panel title="Needs your attention" actions={<Link className="text-sm text-primary hover:underline" href={`${base}?tab=requests`}>All Requests →</Link>}>
                  {pending.length === 0 ? <p className="px-5 py-6 text-sm text-muted">🎉 No pending requests — all caught up.</p> : (
                    <ul className="divide-y divide-line" aria-label="Pending requests">
                      {pending.slice(0, 6).map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                          <span><span className="font-medium">{name.get(r.employee_id) ?? 'Employee'}</span> · {r.letter_type}<span className="block text-xs text-muted">{r.reason ?? 'No reason given'} · {days(r.created_at)}d ago</span></span>
                          <Link className="text-primary hover:underline" href={`${base}?tab=generate&template=${r.template_id}&employees=${r.employee_id}&request=${r.id}`}>Generate →</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="Recent letters">
                  {letters.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No letters yet. Generate one to get started.</p> : (
                    <ul className="divide-y divide-line" aria-label="Recent letters">
                      {letters.slice(0, 8).map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                          <Link className="hover:underline" href={`${base}/${l.id}`}><span className="font-medium">{l.letter_type}</span> · {name.get(l.employee_id) ?? 'Employee'}</Link>
                          <span className="flex items-center gap-2 text-xs text-muted">{formatDate((l.released_at ?? l.created_at).slice(0, 10))}<Badge tone={STATUS_TONE[l.status as keyof typeof STATUS_TONE]}>{l.status}</Badge></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
              <div className="space-y-5">
                <Panel title="Quick actions">
                  <ul className="grid grid-cols-2 gap-2 p-4 text-sm">
                    {[['✍️', 'Generate a Letter', 'generate'], ['📥', `Review Requests (${pending.length})`, 'requests'], ['🧩', 'Templates & Settings', 'settings'], ['📊', 'Insights', 'insights']].map(([i, l, t]) => (
                      <li key={t}><Link href={`${base}?tab=${t}`} className="flex h-full flex-col gap-1 rounded-xl border border-line p-3 hover:bg-subtle"><span className="text-xl" aria-hidden="true">{i}</span>{l}</Link></li>
                    ))}
                  </ul>
                </Panel>
                <Panel title="Top letter types" actions={<Link className="text-sm text-primary hover:underline" href={`${base}?tab=insights`}>Insights →</Link>}>
                  <p className="px-5 text-xs text-muted">This quarter, across requests and direct generation.</p>
                  {byType.size === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing released this quarter.</p> : (
                    <ul className="space-y-2 px-5 py-4 text-sm">
                      {[...byType].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => (
                        <li key={t}><span className="flex justify-between"><span>{t}</span><span className="tabular-nums">{n}</span></span>
                          <span className="mt-1 block h-1.5 rounded-full bg-subtle"><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${(n / quarter.length) * 100}%` }} /></span></li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>
          </div>
        );
      })()}

      {tab === 'generate' && await (async () => {
        const drafts = many(sp.drafts);
        if (drafts.length) {
          const rows = await lettersList(ctx.org.id, { ids: drafts });
          const open = rows.filter((r) => r.status === 'draft');
          return (
            <Panel title="Review and release" actions={open.length > 0 ? <ReleaseForm action={releaseLettersAction.bind(null, slug)} ids={open.map((r) => r.id)} label={`Release ${open.length} letter${open.length === 1 ? '' : 's'}`} /> : undefined}>
              <p className="px-5 text-sm text-muted">Drafts are visible only to HR. Open each to check it; releasing makes it final and notifies the employee.</p>
              <ul className="divide-y divide-line" aria-label="Drafts">
                {rows.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span><span className="font-medium">{name.get(l.employee_id) ?? 'Employee'}</span> · {l.letter_type}</span>
                    <span className="flex items-center gap-2"><Badge tone={STATUS_TONE[l.status as keyof typeof STATUS_TONE]}>{l.status}</Badge>
                      <Link className="text-primary hover:underline" href={`${base}/${l.id}`} aria-label={`Open letter for ${name.get(l.employee_id) ?? 'employee'}`}>Open</Link>
                      {l.status === 'draft' && <LetterStatusForm action={letterStatusAction.bind(null, slug)} id={l.id} op="delete" label="Discard" />}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          );
        }
        const templateId = one(sp.template);
        const employees = many(sp.employees);
        const tpl = templates.find((t) => t.id === templateId);
        if (tpl && employees.length && !one(sp.back)) {
          const [head, sigs, sample] = await Promise.all([letterhead(ctx.org.id, ctx.org.name), signatories(ctx.org.id), mergeValues(ctx.org.id, employees[0]!, today)]);
          const sig = sigs.find((s) => s.id === tpl.signatory_id);
          return (
            <>
              <p className="mb-3 text-sm"><Link className="text-muted hover:text-fg" href={`${base}?tab=generate&template=${tpl.id}&${employees.map((e) => `employees=${e}`).join('&')}&type=${encodeURIComponent(tpl.letter_type)}&back=1`}>← Change letter or people</Link></p>
              <h2 className="mb-3 text-lg font-semibold">{tpl.letter_type} · {tpl.name} <span className="text-sm font-normal text-muted">for {employees.length} {employees.length === 1 ? 'person' : 'people'}</span></h2>
              {!sig && <p className="mb-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2 text-sm">No authorized signatory is assigned to this template. <Link className="underline" href={`${base}?tab=settings&view=setup&template=${tpl.id}`}>Assign one</Link> or fill the name in below.</p>}
              <GenerateForm action={generateLettersAction.bind(null, slug)} templateId={tpl.id} requestId={one(sp.request)} employees={employees} body={tpl.body}
                sample={{ ...sample, ...(sig ? { 'authorized signatory name': sig.name, 'authorized signatory designation': sig.designation, 'authorized signatory address': sig.address ?? '' } : {}) }}
                sampleName={name.get(employees[0]!) ?? 'Employee'} head={head} />
            </>
          );
        }
        return (
          <Panel title="Generate a letter">
            <p className="px-5 text-sm text-muted">Pick the letter, choose employees — one letter per person. You edit and preview it in the next step.</p>
            <div className="px-5 py-4"><PickForm base={base} templates={templates} people={people} current={{ template: templateId, employees }} /></div>
          </Panel>
        );
      })()}

      {tab === 'requests' && (() => {
        const sub = one(sp.view) === 'released' ? 'released' : 'pending';
        return (
          <>
            <SubTabs base={base} extra={{ tab: 'requests' }} tabs={[{ key: 'pending', label: 'Pending Letters', count: pending.length }, { key: 'released', label: 'Released Letters' }]} current={sub} label="Request sections" />
            {sub === 'pending' ? (
              <Panel title={`Letter requests · ${pending.length}`}>
                {pending.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No letter requests here.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" aria-label="Letter requests">
                      <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Employee</th><th className="px-3">Letter type</th><th className="px-3">Reason</th><th className="px-3">Request date</th><th className="px-3">Aging</th><th className="px-3">Action</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {pending.map((r) => (
                          <tr key={r.id}>
                            <td className="px-5 py-2 font-medium">{name.get(r.employee_id) ?? 'Employee'}</td>
                            <td className="px-3">{r.letter_type}</td>
                            <td className="px-3 text-muted">{r.reason ?? '—'}</td>
                            <td className="px-3">{formatDate(r.created_at.slice(0, 10))}</td>
                            <td className={`px-3 tabular-nums ${days(r.created_at) > 3 ? 'text-danger' : ''}`}>{days(r.created_at)}d</td>
                            <td className="px-3"><span className="flex flex-wrap items-center gap-1">
                              <Link className="rounded-md px-2 py-1 text-primary hover:bg-subtle" href={`${base}?tab=generate&template=${r.template_id}&employees=${r.employee_id}&request=${r.id}`} aria-label={`Generate ${r.letter_type} for ${name.get(r.employee_id) ?? 'employee'}`}>Generate</Link>
                              <CloseRequestForm action={closeRequestAction.bind(null, slug)} id={r.id} status="rejected" label="Decline" />
                            </span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ) : (
              <Panel title={`Released letters · ${released.length}`}>
                {released.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Nothing released yet.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" aria-label="Released letters">
                      <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Employee</th><th className="px-3">Letter type</th><th className="px-3">Source</th><th className="px-3">Release date</th><th className="px-3">Action</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {released.map((l) => (
                          <tr key={l.id}>
                            <td className="px-5 py-2 font-medium">{name.get(l.employee_id) ?? 'Employee'}</td>
                            <td className="px-3">{l.letter_type}</td>
                            <td className="px-3 text-muted">{l.request_id ? 'Request' : 'Direct'}</td>
                            <td className="px-3">{formatDate(l.released_at!.slice(0, 10))}</td>
                            <td className="px-3"><Link className="text-primary hover:underline" href={`${base}/${l.id}`}>View</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}
          </>
        );
      })()}

      {tab === 'settings' && await (async () => {
        const sub = ['signatories', 'letterhead', 'setup'].includes(one(sp.view) ?? '') ? one(sp.view)! : 'setup';
        const [head, sigs] = await Promise.all([letterhead(ctx.org.id, ctx.org.name), signatories(ctx.org.id)]);
        const nav = <SubTabs base={base} extra={{ tab: 'settings' }} tabs={[{ key: 'signatories', label: 'Author Signatories' }, { key: 'letterhead', label: 'Letter Head' }, { key: 'setup', label: 'Letter Setup' }]} current={sub} label="Letter settings" />;
        if (sub === 'signatories') return (
          <>
            {nav}
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Add Signatory"><div className="px-5 py-4"><SignatoryForm action={saveSignatoryAction.bind(null, slug)} /></div></Panel>
              <Panel title={`Signatories · ${sigs.length}`}>
                {sigs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No signatories yet. Letters without one print without a signature.</p> : (
                  <ul className="divide-y divide-line" aria-label="Signatories">
                    {sigs.map((s) => (
                      <li key={s.id} className="px-5 py-3">
                        <details>
                          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                            <span><span className="font-medium">{s.name}</span> · {s.designation}<span className="ml-2 text-xs text-muted">{s.signature_path ? '✓ signature' : 'no signature image'}</span></span>
                            <RemoveSignatoryForm action={removeSignatoryAction.bind(null, slug)} id={s.id} name={s.name} />
                          </summary>
                          <div className="mt-3"><SignatoryForm action={saveSignatoryAction.bind(null, slug)} signatory={s} /></div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        );
        if (sub === 'letterhead') return (<>{nav}<Panel title="Letter Head"><div className="px-5 py-4"><LetterheadForm action={saveLetterheadAction.bind(null, slug)} head={head} /></div></Panel></>);
        const editing = one(sp.template);
        if (editing) {
          const all = await letterTemplates(ctx.org.id);
          const t = editing === 'new'
            ? { letter_type: '', name: 'Template 1', body: 'Date: {{ date }}\n\nDear {{ first name }},\n\n\n\nFor {{ company name }}\n\n{{ authorized signatory signature }}\n{{ authorized signatory name }}\n{{ authorized signatory designation }}', signatory_id: null, self_serve: false }
            : all.find((x) => x.id === editing);
          const sample = me ? await mergeValues(ctx.org.id, me.id, today) : {};
          return (
            <>
              {nav}
              <p className="mb-3 text-sm"><Link className="text-muted hover:text-fg" href={`${base}?tab=settings&view=setup`}>← Back to Letter Setup</Link></p>
              {t ? <TemplateEditor action={saveTemplateAction.bind(null, slug)} template={t} signatories={sigs} sample={sample} head={head}
                archive={editing === 'new' ? undefined : archiveTemplateAction.bind(null, slug)} /> : <p className="text-sm text-muted">This template no longer exists.</p>}
            </>
          );
        }
        const sigName = new Map(sigs.map((s) => [s.id, s.name]));
        return (
          <>
            {nav}
            <div className="mb-3 flex justify-end"><Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=settings&view=setup&template=new`}>＋ Create New Letter</Link></div>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Letter setup">
              {templates.map((t) => (
                <li key={t.id} className="lift-soft rounded-2xl border border-line bg-surface p-4">
                  <dl className="space-y-2 text-sm">
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Letter type</dt><dd className="font-medium">{t.letter_type}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Template</dt><dd>{t.name}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Authorized signatory</dt><dd className={t.signatory_id ? '' : 'text-muted'}>{t.signatory_id ? sigName.get(t.signatory_id) : '— Signature not assigned'}</dd></div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between">
                    {t.self_serve ? <Badge tone="success">Self-serve</Badge> : <span />}
                    <Link className="text-sm text-primary hover:underline" href={`${base}?tab=settings&view=setup&template=${t.id}`} aria-label={`Edit ${t.letter_type}`}>✎ Edit</Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        );
      })()}

      {tab === 'insights' && (() => {
        const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
        const fy = released.filter((l) => (l.released_at ?? '') >= fyStart);
        const closed = requests.filter((r) => r.status === 'released' && r.decided_at);
        const tat = closed.length ? closed.reduce((a, r) => a + days(r.created_at, r.decided_at!), 0) / closed.length : null;
        const byType = new Map<string, number>();
        for (const l of fy) byType.set(l.letter_type, (byType.get(l.letter_type) ?? 0) + 1);
        const top = [...byType].sort((a, b) => b[1] - a[1])[0];
        const monthsBack = Array.from({ length: 12 }, (_, i) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 11 + i); return d.toISOString().slice(0, 7); });
        const tatByType = new Map<string, number[]>();
        for (const r of closed) tatByType.set(r.letter_type, [...(tatByType.get(r.letter_type) ?? []), days(r.created_at, r.decided_at!)]);
        return (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Released · FY" value={fy.length} note="this financial year" tone="success" />
              <StatCard label="Avg request → release" value={tat === null ? '—' : `${tat.toFixed(1)}d`} note="target ≤ 3 days" />
              <StatCard label="Pending now" value={pending.length} note="in the queue" tone={pending.length ? 'warning' : 'muted'} />
              <StatCard label="Oldest pending" value={`${pending.reduce((m, r) => Math.max(m, days(r.created_at)), 0)}d`} note="chase it in Requests" />
              <StatCard label="Top letter type" value={top ? top[0] : '—'} note="most generated" />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Monthly volume"><div className="px-5 py-4"><BarChart label="Letters released per month" data={monthsBack.map((m) => ({ label: m.slice(2), value: released.filter((l) => l.released_at!.startsWith(m)).length }))} /></div></Panel>
              <Panel title={`Letters by type · ${fy.length}`}>
                {byType.size === 0 ? <p className="px-5 py-6 text-sm text-muted">No letters released this year.</p> : (
                  <ul className="space-y-2 px-5 py-4 text-sm">{[...byType].sort((a, b) => b[1] - a[1]).map(([t, n]) => <li key={t} className="flex justify-between"><span>{t}</span><span className="tabular-nums">{n}</span></li>)}</ul>
                )}
              </Panel>
            </div>
            <Panel title="Request → release TAT by type">
              {tatByType.size === 0 ? <p className="px-5 py-6 text-sm text-muted">No requests released yet.</p> : (
                <table className="w-full text-sm" aria-label="Turnaround by type"><thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Letter type</th><th className="px-3">Avg TAT</th><th className="px-3">Requests</th></tr></thead>
                  <tbody className="divide-y divide-line">{[...tatByType].map(([t, xs]) => <tr key={t}><td className="px-5 py-2">{t}</td><td className="px-3 tabular-nums">{(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}d</td><td className="px-3 tabular-nums">{xs.length}</td></tr>)}</tbody></table>
              )}
            </Panel>
          </div>
        );
      })()}
    </>
  );
}

/** Employees: their released letters and self-serve requests. */
async function MyLetters({ slug, base, orgId, employeeId }: { slug: string; base: string; orgId: string; employeeId: string | null }) {
  const [templates, mine, requests] = await Promise.all([
    letterTemplates(orgId),
    employeeId ? lettersList(orgId, { employeeId, status: 'released' }) : Promise.resolve([]),
    employeeId ? letterRequests(orgId, { employeeId }) : Promise.resolve([]),
  ]);
  const selfServe = templates.filter((t) => t.self_serve);
  return (
    <>
      <HubHeader title="Letters" subtitle="Your letters from HR, ready to print or save as PDF. Ask HR for the letters you can request yourself." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="My letters">
          {mine.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No letters yet.</p> : (
            <ul className="divide-y divide-line" aria-label="My letters">
              {mine.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><span className="font-medium">✉️ {l.letter_type}</span><span className="block text-xs text-muted">Released {formatDate(l.released_at!.slice(0, 10))}</span></span>
                  <Link className="text-primary hover:underline" href={`${base}/${l.id}`} aria-label={`Open ${l.letter_type}`}>Open</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-5">
          {employeeId && selfServe.length > 0 && (
            <Panel title="Request a letter"><RequestForm action={requestLetterAction.bind(null, slug)} templates={selfServe} /></Panel>
          )}
          <Panel title="My requests">
            {requests.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No requests yet.</p> : (
              <ul className="divide-y divide-line" aria-label="My letter requests">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span><span className="font-medium">{r.letter_type}</span><span className="block text-xs text-muted">{formatDate(r.created_at.slice(0, 10))}{r.reason ? ` · ${r.reason}` : ''}{r.decision_note ? ` · HR: ${r.decision_note}` : ''}</span></span>
                    <span className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{r.status}</Badge>
                      {r.status === 'pending' && <CloseRequestForm action={closeRequestAction.bind(null, slug)} id={r.id} status="withdrawn" label="Withdraw" />}
                      {r.letter_id && <Link className="text-primary hover:underline" href={`${base}/${r.letter_id}`}>Open</Link>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
