import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { HubTabs, Panel } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Avatar } from '@/components/ui/avatar';
import { BarChart } from '@/components/ui/charts';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { employeeNames } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { decideDeletionAction } from '../preferences/privacy-actions';
import { DecideDeletionForm } from '../preferences/privacy-client';
import { SCOPE_LABELS } from '../preferences/privacy-data';
import { directory, directorySettings, genderMix, peopleRecords, profileGaps, signInStats, upcomingBirthdays, type Person } from '@/server/people';
import { viewModeFor } from '@/server/view';
import { bulkPeopleAction, saveDirectorySettingsAction } from './people-actions';
import { DirectorySettingsForm, PeopleBoard, ZoomFrame, type Card as PersonCard } from './people-client';

export const metadata: Metadata = { title: 'People' };

type Search = Record<string, string | undefined>;
const CURRENT = new Set(['active', 'on_notice']);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * People (Kredily's directory): overview, people (grid or list, filters, bulk actions), org chart, lifecycle,
 * insights and directory privacy settings. HR and managers see employee records through RLS; everyone else sees the
 * colleague directory with only the fields the organization shows.
 */
export default async function PeoplePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.read')) notFound();
  const today = todayIn(ctx.org.timezone);
  const base = `/app/${slug}/employees`;
  const view = await viewModeFor(ctx);
  const records = ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team');
  const hr = view === 'admin' && records;
  const manage = ctx.can('employee.update', 'org');

  const people: Person[] = hr ? await peopleRecords(ctx.org.id, today) : await directory(ctx.org.id);
  const current = people.filter((p) => CURRENT.has(p.status));
  const depts = new Set(current.map((p) => p.department).filter(Boolean));
  const locs = new Set(current.map((p) => p.location).filter(Boolean));
  const tabs = hr
    ? [{ key: 'overview', label: 'Overview' }, { key: 'people', label: 'People', count: current.length }, { key: 'orgchart', label: 'Org Chart' },
       { key: 'lifecycle', label: 'Lifecycle' }, { key: 'insights', label: 'Insights' }, { key: 'settings', label: 'Settings' },
       ...(ctx.can('employee.personal.update', 'org') ? [{ key: 'deletion', label: 'Deletion requests' }] : [])]
    : [{ key: 'people', label: 'People', count: current.length }, { key: 'orgchart', label: 'Org Chart' }];
  const filtering = Boolean(sp.q || sp.status || sp.department || sp.flag);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : filtering || !hr ? 'people' : 'overview';
  const stats = hr ? await signInStats(ctx.org.id, people) : null;
  const href = (extra: Record<string, string>) => `${base}?${new URLSearchParams(extra).toString()}`;
  const exportQuery = new URLSearchParams(Object.entries({ q: sp.q, status: sp.status, department: sp.department }).filter(([, v]) => v) as Array<[string, string]>).toString();

  return (
    <>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">People</h1>
          <p className="text-sm text-muted">· {current.length} employees · {depts.size} departments · {locs.size} locations</p>
        </div>
        {hr && (
          <div className="flex flex-wrap items-center gap-2">
            {stats && <span className="rounded-full border border-success/30 bg-success-soft px-3 py-1 text-xs font-medium text-success">✓ {stats.signedIn} / {stats.total} signed in</span>}
            {ctx.can('member.manage', 'org') && <Link href={`/app/${slug}/members`} className={buttonClass('secondary', 'sm')}>↻ Resend Activation</Link>}
            {ctx.can('employee.create', 'org') && <Link href={`${base}/import`} className={buttonClass('secondary', 'sm')}>Import</Link>}
            {ctx.can('employee.export', 'org') && <a href={`${base}/export${exportQuery ? `?${exportQuery}` : ''}`} className={buttonClass('secondary', 'sm')} download>Export CSV</a>}
            {ctx.can('employee.create') && <Link href={`${base}/new`} className={buttonClass('primary', 'sm')}>+ Add Person</Link>}
          </div>
        )}
      </header>
      <HubTabs base={base} label="People sections" tabs={tabs} current={tab} />

      {tab === 'overview' && <Overview slug={slug} base={base} today={today} people={people} href={href} />}
      {tab === 'deletion' && <DeletionRequests slug={slug} orgId={ctx.org.id} />}
      {tab === 'people' && <PeopleTab ctx={ctx} slug={slug} base={base} today={today} people={people} hr={hr} manage={manage} sp={sp} stats={stats} />}
      {tab === 'orgchart' && <OrgChart people={current} slug={slug} hr={hr} />}
      {tab === 'lifecycle' && <Lifecycle people={people} today={today} slug={slug} />}
      {tab === 'insights' && <Insights orgId={ctx.org.id} people={people} today={today} />}
      {tab === 'settings' && (
        <section className="lift-soft max-w-2xl rounded-2xl border border-line bg-surface p-5" aria-label="Privacy & Visibility">
          <h2 className="font-semibold">🔒 Privacy & Visibility</h2>
          <p className="mb-2 text-sm text-muted">Control which fields employees can see in the directory. HR always sees full records.</p>
          <DirectorySettingsForm action={saveDirectorySettingsAction.bind(null, slug)} s={await directorySettings(ctx.org.id)} canEdit={ctx.can('org.manage', 'org')} />
        </section>
      )}
    </>
  );
}

function Figure({ icon, label, value, note, tone = 'text-primary' }: { icon: string; label: string; value: React.ReactNode; note: string; tone?: string }) {
  return (
    <div className="lift rounded-2xl border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted"><span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-primary-soft">{icon}</span>{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

async function Overview({ slug, base, today, people, href }: { slug: string; base: string; today: string; people: Person[]; href: (e: Record<string, string>) => string }) {
  const orgId = (await getOrgContext(slug)).org.id;
  const current = people.filter((p) => CURRENT.has(p.status));
  const [gaps, gender, birthdays] = await Promise.all([profileGaps(orgId), genderMix(orgId, current.map((p) => p.id)), upcomingBirthdays(orgId, 7)]);
  const joiners = current.filter((p) => p.joined && p.joined >= addDays(today, -30) && p.joined <= today);
  const gapCount = gaps ? current.filter((p) => !gaps.get(p.id)?.pan).length : current.filter((p) => !p.departmentId || !p.designationId).length;
  const avgTenure = current.length ? current.reduce((s, p) => s + p.tenureYears, 0) / current.length : 0;
  const knownGender = gender ? gender.female + gender.male + gender.transgender + gender.non_binary : 0;
  const lifecycle = {
    pre: people.filter((p) => p.status === 'pre_joining').length,
    onboarding: joiners.length,
    active: current.filter((p) => p.status === 'active').length,
    notice: people.filter((p) => p.status === 'on_notice').length,
    exited: people.filter((p) => p.status === 'exited' && p.exited && p.exited >= addDays(today, -90)).length,
  };
  const byDept = new Map<string, number>();
  for (const p of current) byDept.set(p.department ?? 'Unassigned', (byDept.get(p.department ?? 'Unassigned') ?? 0) + 1);
  const max = Math.max(1, ...byDept.values());
  const anniversaries = current.filter((p) => {
    if (!p.joined || p.joined.slice(0, 4) === today.slice(0, 4)) return false;
    const thisYear = `${today.slice(0, 4)}${p.joined.slice(4)}`;
    return thisYear >= today && thisYear <= addDays(today, 7);
  });
  return (
    <div className="space-y-5">
      <form action={base} role="search" className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2">
        <input type="hidden" name="tab" value="people" />
        <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-primary text-primary-fg">✦</span>
        <input name="q" aria-label="Search people" placeholder="Search by name, department or role…" className="h-9 min-w-56 flex-1 bg-transparent px-2 text-sm outline-none" />
        <Link href={href({ tab: 'people', flag: 'new' })} className="rounded-full border border-line px-3 py-1 text-xs text-primary">⭐ New joiners</Link>
        <Link href={href({ tab: 'people', flag: 'incomplete' })} className="rounded-full border border-line px-3 py-1 text-xs text-primary">⚠ Incomplete</Link>
        <Link href={href({ tab: 'people', status: 'on_notice' })} className="rounded-full border border-line px-3 py-1 text-xs text-primary">⏳ Exiting</Link>
      </form>
      <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary-soft/60 px-5 py-4">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-primary-fg">✦</span>
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-primary">People insight</p>
          <p className="text-sm font-medium">{gapCount} profile{gapCount === 1 ? '' : 's'} need attention{gaps ? ' (PAN not on file)' : ''} · {birthdays.length + anniversaries.length} celebration{birthdays.length + anniversaries.length === 1 ? '' : 's'} this week · {joiners.length} joined in the last 30 days.</p></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Figure icon="👥" label="Headcount" value={current.length} note="active staff" />
        <Figure icon="🌱" label="New joiners" value={joiners.length} note="last 30 days" tone="text-success" />
        <Figure icon="⏱" label="Avg tenure" value={<>{avgTenure.toFixed(1)}<span className="text-sm text-muted"> y</span></>} note="across org" />
        <Figure icon="⚖" label="Gender mix" value={knownGender ? <>{Math.round((gender!.female / knownGender) * 100)}<span className="text-sm text-muted"> % W</span></> : '—'} note={knownGender ? 'of those who shared it' : 'not recorded'} tone="text-danger" />
        <Figure icon="⚠" label="Profile gaps" value={gapCount} note="need attention" tone="text-warning" />
      </div>
      <section className="lift-soft rounded-2xl border border-line bg-surface p-5" aria-label="Workforce lifecycle">
        <header className="mb-3 flex justify-between"><h2 className="font-semibold">👤 Workforce Lifecycle</h2><Link href={href({ tab: 'lifecycle' })} className="text-sm text-primary">Open pipeline →</Link></header>
        <div className="grid gap-3 sm:grid-cols-5">
          {([['Prejoiners', lifecycle.pre, 'offer accepted · joining soon', 'border-l-info'], ['Onboarding', lifecycle.onboarding, 'in first 30 days', 'border-l-primary'], ['Active', lifecycle.active, 'confirmed staff', 'border-l-success'],
            ['Notice', lifecycle.notice, 'serving notice', 'border-l-warning'], ['Exited 90d', lifecycle.exited, 'offboarded recently', 'border-l-danger']] as const).map(([l, n, s, c]) => (
            <div key={l} className={`rounded-xl border border-line border-l-4 ${c} p-3`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{l}</p><p className="text-2xl font-semibold tabular-nums">{n}</p><p className="text-xs text-muted">{s}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="lift-soft rounded-2xl border border-line bg-surface p-5" aria-label="Insights">
          <header className="mb-3 flex justify-between"><h2 className="font-semibold">📊 Headcount by department</h2><Link href={href({ tab: 'insights' })} className="text-sm text-primary">Full analytics →</Link></header>
          <ul className="space-y-2.5">
            {[...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => (
              <li key={d} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 text-sm">
                <Link href={href({ tab: 'people', q: d === 'Unassigned' ? '' : d })} className="truncate font-medium hover:text-primary">{d}</Link>
                <span className="h-2.5 rounded-full bg-subtle"><span className="block h-2.5 rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className="space-y-5">
          <section className="lift-soft rounded-2xl border border-line bg-surface p-5" aria-label="New joiners">
            <header className="mb-3 flex justify-between"><h2 className="font-semibold">🌱 New Joiners</h2><Link href={href({ tab: 'people', flag: 'new' })} className="text-sm text-primary">See all →</Link></header>
            {joiners.length === 0 ? <p className="text-sm text-muted">No new joiners in the last 30 days.</p> : (
              <ul className="space-y-2">{joiners.slice(0, 5).map((p) => <li key={p.id} className="flex items-center gap-2.5 text-sm"><Avatar name={p.name} size="sm" /><Link href={`${base}/${p.id}`} className="font-medium hover:text-primary">{p.name}</Link><span className="ml-auto text-xs text-muted">{p.joined ? formatDate(p.joined) : ''}</span></li>)}</ul>
            )}
          </section>
          <section className="lift-soft rounded-2xl border border-line bg-surface p-5" aria-label="This week">
            <header className="mb-3 flex justify-between"><h2 className="font-semibold">🎉 This Week</h2><Link href={`/app/${slug}/engagement`} className="text-sm text-primary">Send kudos →</Link></header>
            {birthdays.length + anniversaries.length === 0 ? <p className="text-sm text-muted">No celebrations this week.</p> : (
              <ul className="space-y-2 text-sm">
                {birthdays.map((b) => <li key={b.employee_id} className="flex items-center gap-2.5"><Avatar name={b.name} size="sm" />{b.name}<span className="ml-auto text-xs text-muted">🎂 {formatDate(b.next_birthday)}</span></li>)}
                {anniversaries.map((p) => <li key={p.id} className="flex items-center gap-2.5"><Avatar name={p.name} size="sm" />{p.name}<span className="ml-auto text-xs text-muted">🏅 {Number(today.slice(0, 4)) - Number(p.joined!.slice(0, 4))} years</span></li>)}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

async function PeopleTab({ ctx, slug, base, today, people, hr, manage, sp, stats }: {
  ctx: Awaited<ReturnType<typeof getOrgContext>>; slug: string; base: string; today: string; people: Person[]; hr: boolean; manage: boolean; sp: Search;
  stats: Awaited<ReturnType<typeof signInStats>>;
}) {
  const inactive = sp.set === 'inactive' || sp.status === 'exited' || sp.status === 'pre_joining';
  const gaps = hr && sp.flag === 'incomplete' ? await profileGaps(ctx.org.id) : null;
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = people.filter((p) => {
    if (sp.status) { if (p.status !== sp.status) return false; } else if (inactive ? CURRENT.has(p.status) : !CURRENT.has(p.status)) return false;
    if (q && !`${p.name} ${p.code ?? ''} ${p.email ?? ''} ${p.department ?? ''} ${p.designation ?? ''}`.toLowerCase().includes(q)) return false;
    if (sp.department && p.departmentId !== sp.department) return false;
    if (sp.flag === 'new' && !(p.joined && p.joined >= addDays(today, -30))) return false;
    if (sp.flag === 'probation' && !(p.probationEnd && p.probationEnd <= today && !p.confirmedOn)) return false;
    if (sp.flag === 'incomplete' && !(gaps ? !gaps.get(p.id)?.pan : !p.departmentId || !p.designationId)) return false;
    return true;
  });
  const size = 25;
  const page = Math.max(1, Math.min(Math.ceil(rows.length / size) || 1, Number(sp.page) || 1));
  const shown = rows.slice((page - 1) * size, page * size);
  const view = sp.view === 'list' ? 'list' : 'grid';
  const probationDue = people.filter((p) => CURRENT.has(p.status) && p.probationEnd && p.probationEnd <= today && !p.confirmedOn).length;
  const keep = (extra: Record<string, string | undefined>) => {
    const merged = { tab: 'people', q: sp.q, status: sp.status, department: sp.department, flag: sp.flag, set: sp.set, view: sp.view, ...extra };
    return `${base}?${new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as Array<[string, string]>).toString()}`;
  };
  const cards: PersonCard[] = shown.map((p) => ({
    id: p.id, name: p.name, code: p.code, designation: p.designation, department: p.department, location: p.location, email: p.email, phone: p.phone,
    tenureYears: p.tenureYears, status: p.status, href: hr ? `${base}/${p.id}` : null, birthday: p.birthday, maritalStatus: p.maritalStatus, social: p.social,
    badge: p.status === 'on_notice' ? 'Notice' : p.probationEnd && !p.confirmedOn && CURRENT.has(p.status) ? (p.probationEnd <= today ? 'Confirm' : 'Probation') : null,
  }));
  const opt = (pairs: Array<[string | null, string | null]>) => [...new Map(pairs.filter(([id, n]) => id && n) as Array<[string, string]>).entries()].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const counts = { active: people.filter((p) => CURRENT.has(p.status)).length, inactive: people.filter((p) => !CURRENT.has(p.status)).length };
  return (
    <div className="space-y-4">
      {stats && (
        <div className="flex flex-wrap justify-end gap-2 text-xs">
          <span className="rounded-full border border-line bg-surface px-3 py-1">✓ Signed in <b>{stats.signedIn}</b></span>
          <span className="rounded-full border border-line bg-surface px-3 py-1">🌙 Not signed in <b>{stats.notSignedIn}</b></span>
          {stats.invited > 0 && <span className="rounded-full border border-line bg-surface px-3 py-1">✉ Invited <b>{stats.invited}</b></span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2">
        {hr && (
          <div className="inline-flex rounded-xl border border-line p-0.5 text-sm">
            <Link href={keep({ set: undefined, status: undefined, page: undefined })} aria-current={!inactive ? 'true' : undefined} className={`rounded-lg px-3 py-1 ${!inactive ? 'bg-subtle font-semibold' : 'text-muted'}`}>Active <span className="text-primary">{counts.active}</span></Link>
            <Link href={keep({ set: 'inactive', status: undefined, page: undefined })} aria-current={inactive ? 'true' : undefined} className={`rounded-lg px-3 py-1 ${inactive ? 'bg-subtle font-semibold' : 'text-muted'}`}>Inactive <span className="text-muted">{counts.inactive}</span></Link>
          </div>
        )}
        <form action={base} role="search" className="flex min-w-60 flex-1 items-center gap-2">
          <input type="hidden" name="tab" value="people" />
          {sp.set && <input type="hidden" name="set" value={sp.set} />}{sp.view && <input type="hidden" name="view" value={sp.view} />}
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Search by name, code, email or role" className="h-9 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm" />
          {hr && (
            <>
              <label htmlFor="status" className="sr-only">Status</label>
              <select id="status" name="status" defaultValue={sp.status ?? ''} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
                <option value="">Any status</option><option value="active">Active</option><option value="on_notice">On notice</option><option value="pre_joining">Pre-joining</option><option value="exited">Exited</option>
              </select>
              <label htmlFor="department" className="sr-only">Department</label>
              <select id="department" name="department" defaultValue={sp.department ?? ''} className="h-9 max-w-48 rounded-md border border-line-strong bg-surface px-2 text-sm">
                <option value="">All departments</option>{opt(people.map((p) => [p.departmentId, p.department])).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>
          )}
          <button className={buttonClass('secondary', 'sm')}>⊕ Filter</button>
        </form>
        {hr && rows.some((p) => p.email) && <a href={`mailto:?bcc=${rows.filter((p) => p.email).slice(0, 100).map((p) => p.email).join(',')}`} className={buttonClass('secondary', 'sm')}>✉ Mail</a>}
        {hr && probationDue > 0 && <Link href={keep({ flag: 'probation', page: undefined })} className={buttonClass('secondary', 'sm')}>✓ Confirm Probation ({probationDue})</Link>}
        <div className="inline-flex rounded-xl border border-line p-0.5 text-sm">
          <Link href={keep({ view: undefined })} aria-current={view === 'grid' ? 'true' : undefined} className={`rounded-lg px-3 py-1 ${view === 'grid' ? 'bg-primary text-primary-fg' : 'text-muted'}`}>▦ Grid</Link>
          <Link href={keep({ view: 'list' })} aria-current={view === 'list' ? 'true' : undefined} className={`rounded-lg px-3 py-1 ${view === 'list' ? 'bg-primary text-primary-fg' : 'text-muted'}`}>☰ List</Link>
        </div>
      </div>
      {sp.flag && <p className="text-sm text-muted">Showing {sp.flag === 'new' ? 'joiners from the last 30 days' : sp.flag === 'probation' ? 'people whose probation has ended and who aren’t confirmed yet' : 'profiles with missing details'} · <Link href={keep({ flag: undefined })} className="text-primary">Show everyone</Link></p>}
      <PeopleBoard cards={cards} view={view} today={today} bulk={hr && manage ? bulkPeopleAction.bind(null, slug) : null}
        options={{
          department: opt(people.map((p) => [p.departmentId, p.department])), location: opt(people.map((p) => [p.locationId, p.location])),
          designation: opt(people.map((p) => [p.designationId, p.designation])), manager: people.filter((p) => CURRENT.has(p.status)).map((p) => ({ value: p.id, label: p.name })),
        }} />
      <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm">
        <span>{rows.length ? `${(page - 1) * size + 1}–${Math.min(page * size, rows.length)}` : 0} of {rows.length}</span>
        <span className="flex gap-1">
          {page > 1 && <Link href={keep({ page: String(page - 1) })} className="rounded-md border border-line px-2.5 py-1">‹</Link>}
          <span className="rounded-md bg-primary px-2.5 py-1 text-primary-fg">{page}</span>
          {page * size < rows.length && <Link href={keep({ page: String(page + 1) })} className="rounded-md border border-line px-2.5 py-1">›</Link>}
        </span>
        <span className="text-muted">25 / page</span>
      </nav>
    </div>
  );
}

function OrgChart({ people, slug, hr }: { people: Person[]; slug: string; hr: boolean }) {
  const ids = new Set(people.map((p) => p.id));
  const kids = new Map<string, Person[]>();
  for (const p of people) if (p.managerId && ids.has(p.managerId)) kids.set(p.managerId, [...(kids.get(p.managerId) ?? []), p]);
  const roots = people.filter((p) => !p.managerId || !ids.has(p.managerId));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-fg">Top-down</span>
        {hr && <a href={`/app/${slug}/employees/export`} className="text-xs font-medium text-primary" download>⬇ Export (with manager codes)</a>}
      </div>
      <ZoomFrame>
        {people.length === 0 ? <p className="text-center text-sm text-muted">No one to show.</p> : (
          <ul className="mx-auto flex w-max justify-center gap-6" aria-label="Organization chart">{roots.map((p) => <OrgNode key={p.id} p={p} depth={0} kids={kids} slug={slug} linkable={hr} />)}</ul>
        )}
      </ZoomFrame>
    </div>
  );
}

function Lifecycle({ people, today, slug }: { people: Person[]; today: string; slug: string }) {
  const onboarding = (p: Person) => p.status === 'active' && p.joined && p.joined >= addDays(today, -30);
  const cols: Array<[string, string, string, Person[]]> = [
    ['Prejoiners', 'Offer accepted', 'text-info', people.filter((p) => p.status === 'pre_joining')],
    ['Onboarding', 'First 30 days', 'text-primary', people.filter((p) => onboarding(p))],
    ['Active', 'Confirmed', 'text-success', people.filter((p) => p.status === 'active' && !onboarding(p))],
    ['Notice', 'Serving notice', 'text-warning', people.filter((p) => p.status === 'on_notice')],
    ['Exited', 'Last 90 days', 'text-danger', people.filter((p) => p.status === 'exited' && p.exited && p.exited >= addDays(today, -90))],
  ];
  const n = (i: number) => cols[i]?.[3].length ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary-soft/60 px-5 py-4">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-primary-fg">✦</span>
        <div><p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Lifecycle</p>
          <p className="text-sm font-medium">{n(1)} onboarding · {n(3)} serving notice · {n(0)} prejoiners · {n(4)} exited in the last 90 days.</p></div>
        <Link href={`/app/${slug}/onboarding`} className="ml-auto rounded-full border border-line bg-surface px-3 py-1 text-xs text-primary">Onboarding →</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        {cols.map(([title, sub, tone, list]) => (
          <section key={title} className="lift-soft rounded-2xl border border-line bg-surface p-4" aria-label={title}>
            <header className="flex justify-between"><h2 className={`font-semibold ${tone}`}>{title}</h2><span className={`font-semibold tabular-nums ${tone}`}>{list.length}</span></header>
            <p className="mb-3 text-xs text-muted">{sub}</p>
            {list.length === 0 ? <p className="text-sm text-muted">None</p> : (
              <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
                {list.map((p) => (
                  <li key={p.id}><Link href={`/app/${slug}/employees/${p.id}`} className="flex items-center gap-2.5 rounded-xl border border-line p-2.5 hover:border-line-strong">
                    <Avatar name={p.name} size="sm" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name.split(' ')[0]}</span><span className="block truncate text-xs text-muted">{p.designation ?? '—'}</span></span>
                  </Link></li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

async function Insights({ orgId, people, today }: { orgId: string; people: Person[]; today: string }) {
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 11 + i); return d.toISOString().slice(0, 10); });
  const endOf = (m: string) => { const d = new Date(`${m}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const trend = months.map((m) => ({ label: new Date(`${m}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
    value: people.filter((p) => p.status !== 'pre_joining' && p.joined && p.joined <= endOf(m) && (!p.exited || p.exited > endOf(m))).length }));
  const current = people.filter((p) => CURRENT.has(p.status));
  const group = (key: (p: Person) => string) => { const m = new Map<string, number>(); for (const p of current) m.set(key(p), (m.get(key(p)) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const tenure = [['0–1y', 0, 1], ['1–3y', 1, 3], ['3–5y', 3, 5], ['5y+', 5, 99]] as const;
  const gender = await genderMix(orgId, current.map((p) => p.id));
  const panel = (title: string, body: React.ReactNode) => <section className="lift-soft rounded-2xl border border-line bg-surface p-5" aria-label={title}><h2 className="mb-4 font-semibold">{title}</h2>{body}</section>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {panel('📈 Headcount Trend · 12 months', <BarChart label="Headcount by month" data={trend} />)}
      {panel('🥧 Department Mix', <Bars rows={group((p) => p.department ?? 'Unassigned')} />)}
      {panel('📊 Tenure Distribution', <Bars rows={tenure.map(([l, a, b]) => [l, current.filter((p) => p.tenureYears >= a && p.tenureYears < b).length])} />)}
      {panel('📍 Locations', <Bars rows={group((p) => p.location ?? 'No location')} />)}
      {panel('💼 Employment type', <Bars rows={group((p) => (p.employmentType ?? 'unknown').replace(/_/g, ' '))} />)}
      {panel('⚖ Gender', gender ? <Bars rows={[['Women', gender.female], ['Men', gender.male], ['Transgender', gender.transgender], ['Non-binary', gender.non_binary], ['Not shared', gender.undisclosed + gender.unknown]]} /> : <p className="text-sm text-muted">Not recorded, or you don’t have access to personal details.</p>)}
    </div>
  );
}

function Bars({ rows }: { rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return <ul className="space-y-2">{rows.map(([l, n]) => <li key={l} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 text-sm"><span className="truncate">{l}</span><span className="h-2.5 rounded-full bg-subtle"><span className="block h-2.5 rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} /></span><span className="text-right tabular-nums">{n}</span></li>)}</ul>;
}

function OrgNode({ p, depth, kids, slug, linkable }: { p: Person; depth: number; kids: Map<string, Person[]>; slug: string; linkable: boolean }): React.ReactElement {
  const children = kids.get(p.id) ?? [];
  const box = (
    <span className={`flex w-56 items-center gap-2.5 rounded-xl border p-3 text-left shadow-sm ${depth === 0 ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface'}`}>
      <Avatar name={p.name} size="md" />
      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span>
        <span className={`block truncate text-xs ${depth === 0 ? 'text-primary-fg/80' : 'text-muted'}`}>{p.designation ?? '—'}</span>
        {p.department && <span className={`block truncate text-[11px] ${depth === 0 ? 'text-primary-fg/70' : 'text-muted'}`}>{p.department}</span>}</span>
    </span>
  );
  return (
    <li className="flex flex-col items-center">
      {linkable ? <Link href={`/app/${slug}/employees/${p.id}`} className="lift block rounded-xl">{box}</Link> : <span className="block">{box}</span>}
      {children.length > 0 && (
        <details open={depth < 2} className="group flex flex-col items-center">
          <summary className="mx-auto -mt-1 grid size-5 cursor-pointer list-none place-items-center rounded-full border border-line bg-surface text-[10px]" aria-label={`Show ${p.name}’s team`}>{children.length}</summary>
          <span aria-hidden="true" className="mx-auto block h-4 w-px bg-line-strong" />
          <ul className="flex justify-center gap-4 border-t border-line-strong pt-4">{children.map((c) => <OrgNode key={c.id} p={c} depth={depth + 1} kids={kids} slug={slug} linkable={linkable} />)}</ul>
        </details>
      )}
    </li>
  );
}

/** Personal-data deletion requests (HR with employee.personal.update). */
async function DeletionRequests({ slug, orgId }: { slug: string; orgId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from('data_deletion_requests').select('id, employee_id, scope, reason, status, decision_note, created_at, decided_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200);
  const rows = data ?? [];
  const names = await employeeNames(orgId, rows.map((r) => r.employee_id));
  return (
    <Panel title="Deletion requests" meta={`${rows.filter((r) => r.status === 'pending').length} pending`}>
      <p className="mb-3 text-sm text-muted">Employees can ask for optional personal details to be erased. Erasing is immediate and audited; records the law requires are never included.</p>
      {rows.length === 0 ? <p className="text-sm text-muted">No requests.</p> : (
        <ul className="divide-y divide-line text-sm" aria-label="Deletion requests">{rows.map((r) => {
          const name = names.get(r.employee_id) ?? 'Employee';
          return (
            <li key={r.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium">{name}</span> <span className="text-muted">· {formatDate(r.created_at)}</span></span>
                <Badge tone={r.status === 'completed' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'}>{r.status === 'completed' ? 'Erased' : r.status === 'rejected' ? 'Declined' : 'Pending'}</Badge></div>
              <p className="text-muted">{r.scope.map((x) => SCOPE_LABELS[x] ?? x).join(' · ')}{r.reason ? ` — “${r.reason}”` : ''}</p>
              {r.status === 'pending' ? <DecideDeletionForm action={decideDeletionAction.bind(null, slug)} requestId={r.id} name={name} /> : r.decision_note && <p className="text-xs text-muted">Note: {r.decision_note}</p>}
            </li>
          );
        })}</ul>
      )}
    </Panel>
  );
}
