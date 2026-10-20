import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubHeader, HubTabs, Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Alert, Badge } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { colleagueDirectory } from '@/server/engagement';
import { getMyEmployee } from '@/server/employees';
import { requireModule } from '@/server/modules';
import { allRedemptions, feed, MOODS, myPulseToday, myWallet, nominations, okrs, pulseSummary, pxpBasics, recognitions, type Recognition } from '@/server/peoplexp';
import { viewModeFor } from '@/server/view';
import {
  adjustPointsAction, checkinAction, commentAction, decideRecognitionAction, deleteOkrAction, deletePostAction, fulfilAction, nominateAction, nominationStatusAction,
  postAction, reactAction, recognizeAction, redeemAction, saveBadgeAction, saveOkrAction, saveRewardAction, saveRulesAction, saveValueAction,
} from './actions';
import {
  AdjustForm, BadgeForm, Buttons, CommentForm, NominateForm, OkrForm, PostComposer, PulseWidget, Reactions, RecognizeForm, RewardForm, RulesForm, ValueForm,
} from './peoplexp-client';

export const metadata: Metadata = { title: 'PeopleXP' };

type Search = Record<string, string | undefined>;
const DAY = 86_400_000;
const KIND_LABEL: Record<string, string> = { general: '💬 General', classified: '🏷️ Classified', announcement: '📢 Announcement', celebration: '🎉 Celebration', recognition: '🏆 Recognition' };

/**
 * PeopleXP (Kredily's PeopleXP): feed with posts, reactions and comments; recognition with badges and points; culture
 * values, nominations and OKRs; rewards redeemed with points; pulse; analytics (admins); my insights; my wallet and badges;
 * settings (admins). Kredily's paid gift vouchers and AI coaching are not built; rewards are defined by the organization.
 */
export default async function PeopleXpPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'peoplexp');
  const base = `/app/${slug}/peoplexp`;
  const today = todayIn(ctx.org.timezone);
  const isAdmin = ctx.can('peoplexp.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const [me, basics, directory] = await Promise.all([getMyEmployee(ctx.org.id, ctx.user.id), pxpBasics(ctx.org.id), colleagueDirectory(ctx.org.id)]);
  const people = new Map(directory.map((c) => [c.id, c]));
  const tabs = [
    { key: 'feed', label: '✦ Feed' }, { key: 'recognition', label: 'Recognition' }, { key: 'culture', label: 'Culture OS' }, { key: 'okrs', label: 'Culture OKRs' },
    { key: 'rewards', label: 'Rewards' }, ...(isAdmin ? [{ key: 'analytics', label: 'Analytics' }] : []), { key: 'insights', label: 'My Insights' }, { key: 'me', label: 'Me' },
    ...(isAdmin ? [{ key: 'settings', label: 'Settings' }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'feed';
  const p: Props = { slug, base, today, sp, isAdmin, orgId: ctx.org.id, meId: me?.id ?? null, basics, people, directory };
  return (
    <>
      <HubHeader title="People Experience" badge="PeopleXP" subtitle="Culture · Recognition · Rewards · Feedback"
        actions={<Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=feed#recognize`}>＋ Recognize</Link>} />
      <HubTabs base={base} label="PeopleXP sections" tabs={tabs} current={tab} />
      {!me && <div className="mb-4"><Alert tone="info" title="View only">You don’t have an employee record here, so you can read PeopleXP but not post, recognise or redeem.</Alert></div>}
      {tab === 'feed' && <Feed {...p} />}
      {tab === 'recognition' && <RecognitionTab {...p} />}
      {tab === 'culture' && <Culture {...p} />}
      {tab === 'okrs' && <Okrs {...p} />}
      {tab === 'rewards' && <Rewards {...p} />}
      {tab === 'analytics' && <Analytics {...p} />}
      {tab === 'insights' && <Insights {...p} />}
      {tab === 'me' && <Me {...p} />}
      {tab === 'settings' && <Settings {...p} />}
    </>
  );
}

interface Props {
  slug: string; base: string; today: string; sp: Search; isAdmin: boolean; orgId: string; meId: string | null;
  basics: Awaited<ReturnType<typeof pxpBasics>>; people: Map<string, { id: string; name: string; department: string | null; designation: string | null }>;
  directory: Awaited<ReturnType<typeof colleagueDirectory>>;
}
const nameOf = (p: Props, id: string) => p.people.get(id)?.name ?? 'Former colleague';
const since = (days: number) => new Date(new Date().getTime() - days * DAY).toISOString();
const ago = (iso: string) => {
  const m = Math.floor((new Date().getTime() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : formatDate(iso);
};
function leaders(list: Recognition[], by: 'received' | 'given') {
  const m = new Map<string, number>();
  for (const r of list.filter((x) => x.status === 'approved')) {
    if (by === 'given') m.set(r.from_employee_id, (m.get(r.from_employee_id) ?? 0) + 1);
    else for (const id of r.recipients) m.set(id, (m.get(id) ?? 0) + Math.max(r.points, 1));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

// ─── Feed ────────────────────────────────────────────────────────────────────

async function Feed(p: Props) {
  const [posts, mood] = await Promise.all([feed(p.orgId, 40), p.meId ? myPulseToday(p.orgId, p.meId, p.today) : Promise.resolve(null)]);
  const kind = ['general', 'classified', 'announcement', 'celebration', 'recognition'].includes(p.sp.kind ?? '') ? p.sp.kind! : null;
  const shown = posts.filter((x) => !kind || x.kind === kind);
  const badges = p.basics.badges.filter((b) => b.active).map((b) => ({ id: b.id, label: `${b.emoji} ${b.name}`, points: b.points }));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {p.meId && <Panel title="Share"><PostComposer action={postAction.bind(null, p.slug)} canAnnounce={p.isAdmin} /></Panel>}
        <nav aria-label="Filter posts" className="flex flex-wrap gap-2 text-xs">
          {[['', 'All'], ...Object.entries(KIND_LABEL)].map(([k, l]) => (
            <Link key={k} href={`${p.base}?tab=feed${k ? `&kind=${k}` : ''}`} aria-current={(kind ?? '') === k ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${(kind ?? '') === k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg'}`}>{l} {posts.filter((x) => !k || x.kind === k).length}</Link>
          ))}
        </nav>
        {shown.length === 0 && <Panel title="Nothing yet"><p className="text-sm text-muted">No posts yet — share a win or recognise a colleague.</p></Panel>}
        {shown.map((post) => {
          const counts: Record<string, number> = {};
          for (const r of post.reactions) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
          const mine = post.reactions.filter((r) => r.employee_id === p.meId).map((r) => r.emoji);
          return (
            <article key={post.id} className="lift-soft rounded-xl border border-line bg-surface p-4" aria-label={`Post by ${nameOf(p, post.author_employee_id)}`}>
              <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><span className="font-medium">{nameOf(p, post.author_employee_id)}</span> <span className="text-muted">· {ago(post.created_at)} · {post.audience === 'org' ? 'Everyone' : post.audience}</span></span>
                <span className="flex items-center gap-2"><Badge tone={post.kind === 'recognition' ? 'success' : 'neutral'}>{KIND_LABEL[post.kind]}</Badge>{!post.visible && <Badge tone="warning">Awaiting approval</Badge>}</span>
              </header>
              <p className="mt-2 whitespace-pre-wrap text-sm">{post.body}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {p.meId && <Reactions action={reactAction.bind(null, p.slug)} postId={post.id} counts={counts} mine={mine} />}
                {(post.author_employee_id === p.meId && post.kind !== 'recognition') || p.isAdmin ? <Buttons action={deletePostAction.bind(null, p.slug)} hidden={{ postId: post.id }} label="Delete post" buttons={[{ text: 'Delete' }]} confirm="Delete this post?" /> : null}
              </div>
              {post.comments.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-line pt-2 text-sm">{post.comments.map((c) => <li key={c.id}><span className="font-medium">{nameOf(p, c.employee_id)}</span> <span className="text-muted">{c.body}</span></li>)}</ul>
              )}
              {p.meId && <div className="mt-2"><CommentForm action={commentAction.bind(null, p.slug)} postId={post.id} /></div>}
            </article>
          );
        })}
      </div>
      <div className="space-y-4">
        {p.meId && <Panel title="Pulse"><PulseWidget action={checkinAction.bind(null, p.slug)} current={mood} moods={MOODS} /></Panel>}
        {p.meId && (
          <div id="recognize"><Panel title="🏅 Recognize">
            <RecognizeForm action={recognizeAction.bind(null, p.slug)} badges={badges} pointsOn={p.basics.settings.points_enabled}
              people={p.directory.filter((c) => c.id !== p.meId).map((c) => ({ value: c.id, label: c.name }))} />
            <p className="mt-2 text-xs text-muted">Up to {p.basics.settings.daily_recognition_limit} a day{p.basics.settings.points_enabled ? ` and ${p.basics.settings.daily_points_limit} points` : ''}.{p.basics.settings.require_approval && p.basics.settings.points_enabled ? ` Badges worth ${p.basics.settings.high_value_threshold}+ points are approved by an admin first.` : ''}</p>
          </Panel></div>
        )}
      </div>
    </div>
  );
}

// ─── Recognition ─────────────────────────────────────────────────────────────

async function RecognitionTab(p: Props) {
  const list = await recognitions(p.orgId, since(90));
  const recent = list.filter((r) => Date.parse(r.created_at) >= Date.parse(since(30)));
  const pending = list.filter((r) => r.status === 'pending');
  const badge = new Map(p.basics.badges.map((b) => [b.id, b]));
  const board = (rows: Array<[string, number]>, unit: string) => rows.length === 0 ? <p className="text-sm text-muted">No data yet.</p> : (
    <ol className="space-y-1.5 text-sm">{rows.map(([id, n], i) => <li key={id} className="flex justify-between"><span>{i + 1}. {nameOf(p, id)}</span><span className="tabular-nums text-muted">{n} {unit}</span></li>)}</ol>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="🏆 Recognitions" value={recent.filter((r) => r.status === 'approved').length} note="last 30 days" tone="primary" />
        <StatCard label="🏅 Badges" value={p.basics.badges.filter((b) => b.active).length} note="active" />
        <StatCard label="★ Points given" value={recent.filter((r) => r.status === 'approved').reduce((s, r) => s + r.points * r.recipients.length, 0)} note="last 30 days" tone="accent" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="🏆 Most recognised" meta="90 days">{board(leaders(list, 'received'), p.basics.settings.points_enabled ? 'pts' : '')}</Panel>
        <Panel title="🎖️ Top recognisers" meta="90 days">{board(leaders(list, 'given'), 'given')}</Panel>
        <Panel title="🏅 Badge store">
          <ul className="space-y-1.5 text-sm">{p.basics.badges.filter((b) => b.active).map((b) => <li key={b.id} className="flex justify-between"><span>{b.emoji} {b.name}</span><span className="text-muted">{b.points} pts</span></li>)}</ul>
        </Panel>
      </div>
      {p.isAdmin && (
        <Panel title="✅ Approvals" meta={`${pending.length} pending`} flush>
          {pending.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No approval requests right now.</p> : (
            <Table caption="Recognitions awaiting approval">
              <thead><tr><Th>From</Th><Th>To</Th><Th>Badge</Th><Th>Message</Th><Th>When</Th><Th><span className="sr-only">Decide</span></Th></tr></thead>
              <tbody>{pending.map((r) => (
                <tr key={r.id}><Td>{nameOf(p, r.from_employee_id)}</Td><Td>{r.recipients.map((id) => nameOf(p, id)).join(', ')}</Td><Td>{badge.get(r.badge_id)?.emoji} {badge.get(r.badge_id)?.name} · {r.points}</Td>
                  <Td className="max-w-xs text-muted">{r.message}</Td><Td className="text-muted">{ago(r.created_at)}</Td>
                  <Td className="text-right"><Buttons action={decideRecognitionAction.bind(null, p.slug)} hidden={{ recognitionId: r.id }} label={`Decide recognition from ${nameOf(p, r.from_employee_id)}`}
                    buttons={[{ text: 'Approve', name: 'decision', value: 'approve', variant: 'primary' }, { text: 'Reject', name: 'decision', value: 'reject' }]} /></Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Panel>
      )}
      <Panel title="Recent recognitions" flush>
        {recent.filter((r) => r.status === 'approved').length === 0 ? <p className="px-5 py-4 text-sm text-muted">No recognitions in the last 30 days.</p> : (
          <ul className="divide-y divide-line">{recent.filter((r) => r.status === 'approved').slice(0, 30).map((r) => (
            <li key={r.id} className="px-5 py-3 text-sm"><span className="font-medium">{nameOf(p, r.from_employee_id)}</span> → <span className="font-medium">{r.recipients.map((id) => nameOf(p, id)).join(', ')}</span>
              <span className="ml-2">{badge.get(r.badge_id)?.emoji} {badge.get(r.badge_id)?.name}</span><p className="text-muted">{r.message}</p></li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}

// ─── Culture OS ──────────────────────────────────────────────────────────────

async function Culture(p: Props) {
  const view = ['dashboard', 'values', 'nominations'].includes(p.sp.view ?? '') ? p.sp.view! : 'dashboard';
  const range = ['7', '30', '90'].includes(p.sp.range ?? '') ? Number(p.sp.range) : 30;
  const [list, noms] = await Promise.all([recognitions(p.orgId, since(range)), nominations(p.orgId)]);
  const approved = list.filter((r) => r.status === 'approved');
  const valueOf = new Map(p.basics.badges.map((b) => [b.id, b.value_id]));
  const values = p.basics.values.filter((v) => !v.archived_at);
  const byValue = values.map((v) => {
    const rs = approved.filter((r) => valueOf.get(r.badge_id) === v.id);
    return { v, n: rs.length, givers: new Set(rs.map((r) => r.from_employee_id)).size };
  }).sort((a, b) => b.n - a.n);
  const reached = new Set(approved.flatMap((r) => r.recipients));
  const headcount = p.directory.length;
  const top3 = leaders(approved, 'received').slice(0, 3).reduce((s, [, n]) => s + n, 0);
  const allPoints = leaders(approved, 'received').reduce((s, [, n]) => s + n, 0);
  const health = Math.round(Math.min(100, (reached.size / Math.max(headcount, 1)) * 60 + (new Set(approved.map((r) => r.from_employee_id)).size / Math.max(headcount, 1)) * 40));
  const overlooked = p.directory.filter((c) => !reached.has(c.id)).slice(0, 12);
  const depts = [...new Set(p.directory.map((c) => c.department ?? 'Unassigned'))].map((d) => {
    const members = p.directory.filter((c) => (c.department ?? 'Unassigned') === d);
    const ids = new Set(members.map((m) => m.id));
    const given = approved.filter((r) => ids.has(r.from_employee_id)).length;
    const participating = new Set(approved.filter((r) => ids.has(r.from_employee_id)).map((r) => r.from_employee_id)).size;
    return { d, members: members.length, given, participation: Math.round((participating / members.length) * 100) };
  }).sort((a, b) => b.given - a.given);
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'culture' }} label="Culture OS" current={view} tabs={[{ key: 'dashboard', label: '📊 Dashboard' }, { key: 'values', label: '🧬 Values' }, { key: 'nominations', label: '🏅 Nominations' }]} />
      {view === 'dashboard' && (
        <>
          <nav aria-label="Range" className="flex gap-2 text-xs">{['7', '30', '90'].map((r) => <Link key={r} href={`${p.base}?tab=culture&range=${r}`} className={`rounded-full border px-3 py-1 ${range === Number(r) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted'}`}>{r} days</Link>)}</nav>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="🏆 Total recognitions" value={approved.length} tone="primary" />
            <StatCard label="🧭 Culture values" value={values.length} />
            <StatCard label="❤️ Culture health" value={`${health}/100`} note="reach and participation" tone={health >= 60 ? 'success' : health >= 30 ? 'warning' : 'danger'} />
            <StatCard label="🎯 Top value" value={byValue[0]?.n ? `${byValue[0].v.emoji} ${byValue[0].v.name}` : '—'} />
            <StatCard label="💎 Needs focus" value={approved.length && byValue.length ? `${byValue[byValue.length - 1]!.v.emoji} ${byValue[byValue.length - 1]!.v.name}` : '—'} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="🎯 Recognition coverage" meta={`last ${range} days`}>
              <p className="text-3xl font-semibold">{Math.round((reached.size / Math.max(headcount, 1)) * 100)}%</p>
              <p className="text-sm text-muted">reached · {reached.size} of {headcount}</p>
              <p className="mt-2 text-sm text-muted">Concentration (top 3): {allPoints ? Math.round((top3 / allPoints) * 100) : 0}%</p>
            </Panel>
            <Panel title="Recognition by culture value" className="lg:col-span-2">
              {approved.length === 0 ? <p className="text-sm text-muted">No recognition data yet.</p> : (
                <ul className="space-y-2">{byValue.map(({ v, n, givers }) => (
                  <li key={v.id}><div className="flex justify-between text-sm"><span>{v.emoji} {v.name}</span><span className="tabular-nums text-muted">{n} · {givers} givers</span></div>
                    <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${approved.length ? (n / approved.length) * 100 : 0}%` }} /></div></li>
                ))}</ul>
              )}
            </Panel>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="⚠️ Overlooked" meta={`${p.directory.length - reached.size} not recognised in ${range} days`}>
              {overlooked.length === 0 ? <p className="text-sm text-muted">Everyone was recognised. 🎉</p> : (
                <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{overlooked.map((c) => <li key={c.id}>{c.name}<span className="block text-xs text-muted">{c.department ?? '—'}</span></li>)}</ul>
              )}
            </Panel>
            <Panel title="🏢 Department leaderboard" flush>
              <Table caption="Department culture leaderboard">
                <thead><tr><Th>Department</Th><Th className="text-right">Members</Th><Th className="text-right">Given</Th><Th className="text-right">Participation</Th></tr></thead>
                <tbody>{depts.map((x) => <tr key={x.d}><Td>{x.d}</Td><Td className="text-right tabular-nums">{x.members}</Td><Td className="text-right tabular-nums">{x.given}</Td><Td className="text-right tabular-nums">{x.participation}%</Td></tr>)}</tbody>
              </Table>
            </Panel>
          </div>
        </>
      )}
      {view === 'values' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{values.map((v) => (
            <div key={v.id} className="rounded-xl border border-line bg-surface p-4"><p className="text-2xl">{v.emoji}</p><p className="mt-1 font-semibold">{v.name}</p><p className="text-sm text-muted">{v.description ?? ''}</p>
              <p className="mt-2 text-xs text-muted">{byValue.find((x) => x.v.id === v.id)?.n ?? 0} recognitions in {range} days</p></div>
          ))}</div>
          {p.isAdmin && <Panel title="＋ Add value"><ValueForm action={saveValueAction.bind(null, p.slug)} /></Panel>}
        </>
      )}
      {view === 'nominations' && (
        <>
          {p.meId && <Panel title="Nominate a colleague" meta="one nomination per value per month"><NominateForm action={nominateAction.bind(null, p.slug)}
            people={p.directory.filter((c) => c.id !== p.meId).map((c) => ({ value: c.id, label: c.name }))} values={values.map((v) => ({ value: v.id, label: `${v.emoji} ${v.name}` }))} /></Panel>}
          <Panel title={p.isAdmin ? 'Nominations' : 'Your nominations and winners'} flush>
            {noms.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No nominations yet.</p> : (
              <Table caption="Nominations">
                <thead><tr><Th>Month</Th><Th>Nominee</Th><Th>Value</Th><Th>Reason</Th><Th>Nominated by</Th><Th>Status</Th>{p.isAdmin && <Th><span className="sr-only">Decide</span></Th>}</tr></thead>
                <tbody>{noms.map((n) => {
                  const v = p.basics.values.find((x) => x.id === n.value_id);
                  return (
                    <tr key={n.id}><Td>{n.month.slice(0, 7)}</Td><Td className="font-medium">{nameOf(p, n.nominee_employee_id)}</Td><Td>{v?.emoji} {v?.name}</Td><Td className="max-w-xs text-muted">{n.reason}</Td>
                      <Td>{nameOf(p, n.nominator_employee_id)}</Td><Td><Badge tone={n.status === 'winner' ? 'success' : 'neutral'}>{n.status}</Badge></Td>
                      {p.isAdmin && <Td className="text-right">{n.status === 'open' && <Buttons action={nominationStatusAction.bind(null, p.slug)} hidden={{ nominationId: n.id }} label={`Decide nomination of ${nameOf(p, n.nominee_employee_id)}`}
                        buttons={[{ text: '🏆 Winner', name: 'status', value: 'winner', variant: 'primary' }, { text: 'Close', name: 'status', value: 'closed' }]} />}</Td>}</tr>
                  );
                })}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

// ─── Culture OKRs ────────────────────────────────────────────────────────────

async function Okrs(p: Props) {
  const year = /^\d{4}$/.test(p.sp.year ?? '') ? Number(p.sp.year) : Number(p.today.slice(0, 4));
  const q = ['1', '2', '3', '4'].includes(p.sp.q ?? '') ? Number(p.sp.q) : Math.floor((Number(p.today.slice(5, 7)) - 1) / 3) + 1;
  const quarter = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const list = await okrs(p.orgId, quarter);
  const progress = (o: { current: number; target: number }) => Math.min(100, Math.round((o.current / o.target) * 100));
  const values = p.basics.values.filter((v) => !v.archived_at).map((v) => ({ value: v.id, label: `${v.emoji} ${v.name}` }));
  const people = p.directory.map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[1, 2, 3, 4].map((n) => <Link key={n} href={`${p.base}?tab=okrs&year=${year}&q=${n}`} className={`rounded-full border px-3 py-1 ${n === q ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted'}`}>Q{n}</Link>)}
        <Link className="text-xs text-primary" href={`${p.base}?tab=okrs&year=${year - 1}&q=${q}`}>‹ {year - 1}</Link><span className="font-medium">{year}</span><Link className="text-xs text-primary" href={`${p.base}?tab=okrs&year=${year + 1}&q=${q}`}>{year + 1} ›</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="⏳ Active" value={list.filter((o) => progress(o) < 100).length} note="this quarter" tone="primary" />
        <StatCard label="✅ Achieved" value={list.filter((o) => progress(o) >= 100).length} note="this quarter" tone="success" />
        <StatCard label="📈 Average progress" value={`${list.length ? Math.round(list.reduce((s, o) => s + progress(o), 0) / list.length) : 0}%`} />
      </div>
      {list.length === 0 && <Panel title="Culture OKRs"><p className="text-sm text-muted">No OKRs for Q{q} {year} yet.</p></Panel>}
      {list.map((o) => {
        const v = p.basics.values.find((x) => x.id === o.value_id);
        return (
          <Panel key={o.id} title={o.title} meta={[v ? `${v.emoji} ${v.name}` : null, o.owner_employee_id ? nameOf(p, o.owner_employee_id) : null].filter(Boolean).join(' · ')}
            action={p.isAdmin ? <Buttons action={deleteOkrAction.bind(null, p.slug)} hidden={{ okrId: o.id }} label={`Delete ${o.title}`} buttons={[{ text: 'Delete' }]} confirm="Delete this OKR?" /> : undefined}>
            <div className="flex items-center gap-3"><div className="h-2 flex-1 rounded-full bg-subtle"><div className="h-2 rounded-full bg-success" style={{ width: `${progress(o)}%` }} /></div>
              <span className="text-sm tabular-nums">{o.current} / {o.target} {o.unit} · {progress(o)}%</span></div>
            {p.isAdmin && <details className="mt-3"><summary className="cursor-pointer text-xs text-primary">Update</summary><div className="mt-2"><OkrForm action={saveOkrAction.bind(null, p.slug)} quarter={quarter} values={values} people={people} okr={o} /></div></details>}
          </Panel>
        );
      })}
      {p.isAdmin && <Panel title="＋ New OKR"><OkrForm action={saveOkrAction.bind(null, p.slug)} quarter={quarter} values={values} people={people} /></Panel>}
    </div>
  );
}

// ─── Rewards ─────────────────────────────────────────────────────────────────

async function Rewards(p: Props) {
  const [wallet, requests] = await Promise.all([p.meId ? myWallet(p.orgId, p.meId) : Promise.resolve(null), p.isAdmin ? allRedemptions(p.orgId) : Promise.resolve([])]);
  const rewardName = new Map(p.basics.rewards.map((r) => [r.id, r.name]));
  const open = requests.filter((r) => r.status === 'requested');
  return (
    <div className="space-y-5">
      {!p.basics.settings.points_enabled && <Alert tone="info" title="Points are switched off">Recognitions post without points, so rewards can’t be redeemed right now.</Alert>}
      {wallet && <div className="grid gap-3 sm:grid-cols-3"><StatCard label="★ Current balance" value={`${wallet.balance} pts`} tone="primary" /><StatCard label="📈 Lifetime earned" value={`${wallet.earned} pts`} /><StatCard label="🎁 Redeemed" value={`${wallet.redeemed} pts`} /></div>}
      <Panel title="🎁 Rewards" meta="redeem your points">
        {p.basics.rewards.filter((r) => r.active).length === 0 ? <p className="text-sm text-muted">No rewards yet{p.isAdmin ? ' — add some in Settings › Rewards.' : '.'}</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{p.basics.rewards.filter((r) => r.active).map((r) => (
            <div key={r.id} className="flex flex-col rounded-xl border border-line bg-raised p-4">
              <p className="font-semibold">{r.name}</p><p className="flex-1 text-sm text-muted">{r.description ?? ''}</p>
              <p className="mt-2 text-sm"><span className="font-semibold tabular-nums">{r.cost} pts</span>{r.stock !== null && <span className="text-muted"> · {r.stock} left</span>}</p>
              {p.meId && p.basics.settings.points_enabled && <div className="mt-2"><Buttons action={redeemAction.bind(null, p.slug)} hidden={{ rewardId: r.id }} label={`Redeem ${r.name}`}
                buttons={[{ text: (wallet?.balance ?? 0) >= r.cost ? 'Redeem' : `Need ${r.cost - (wallet?.balance ?? 0)} more`, variant: (wallet?.balance ?? 0) >= r.cost ? 'primary' : 'ghost' }]} confirm={`Redeem ${r.name} for ${r.cost} points?`} /></div>}
            </div>
          ))}</div>
        )}
        <p className="mt-3 text-xs text-muted">Rewards are set by your organization and fulfilled by HR. (Kredily’s paid gift vouchers aren’t offered.)</p>
      </Panel>
      {wallet && wallet.redemptions.length > 0 && (
        <Panel title="My orders" flush>
          <Table caption="My reward requests">
            <thead><tr><Th>Reward</Th><Th className="text-right">Points</Th><Th>Requested</Th><Th>Status</Th></tr></thead>
            <tbody>{wallet.redemptions.map((r) => <tr key={r.id}><Td>{rewardName.get(r.reward_id)}</Td><Td className="text-right tabular-nums">{r.points}</Td><Td>{formatDate(r.created_at)}</Td>
              <Td><Badge tone={r.status === 'fulfilled' ? 'success' : r.status === 'cancelled' ? 'neutral' : 'warning'}>{r.status}</Badge>{r.note && <p className="text-xs text-muted">{r.note}</p>}</Td></tr>)}</tbody>
          </Table>
        </Panel>
      )}
      {p.isAdmin && (
        <Panel title="Requests to fulfil" meta={`${open.length} open`} flush>
          {open.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing to fulfil.</p> : (
            <Table caption="Reward requests">
              <thead><tr><Th>Employee</Th><Th>Reward</Th><Th className="text-right">Points</Th><Th>Requested</Th><Th><span className="sr-only">Decide</span></Th></tr></thead>
              <tbody>{open.map((r) => <tr key={r.id}><Td className="font-medium">{nameOf(p, r.employee_id)}</Td><Td>{rewardName.get(r.reward_id)}</Td><Td className="text-right tabular-nums">{r.points}</Td><Td>{formatDate(r.created_at)}</Td>
                <Td className="text-right"><Buttons action={fulfilAction.bind(null, p.slug)} hidden={{ redemptionId: r.id }} label={`Fulfil ${rewardName.get(r.reward_id)} for ${nameOf(p, r.employee_id)}`} note="Note (optional)"
                  buttons={[{ text: 'Fulfilled', name: 'status', value: 'fulfilled', variant: 'primary' }, { text: 'Cancel & refund', name: 'status', value: 'cancelled' }]} /></Td></tr>)}</tbody>
            </Table>
          )}
        </Panel>
      )}
    </div>
  );
}

// ─── Analytics (admins) ──────────────────────────────────────────────────────

async function Analytics(p: Props) {
  const range = ['7', '30', '90'].includes(p.sp.range ?? '') ? Number(p.sp.range) : 30;
  const from = new Date(new Date().getTime() - range * DAY).toISOString();
  const [list, posts, pulse] = await Promise.all([recognitions(p.orgId, from), feed(p.orgId, 500), pulseSummary(p.orgId, from.slice(0, 10), p.today)]);
  const inRange = posts.filter((x) => x.created_at >= from);
  const approved = list.filter((r) => r.status === 'approved');
  const active = new Set([...inRange.map((x) => x.author_employee_id), ...approved.map((r) => r.from_employee_id)]);
  const totals = pulse.reduce((s, d) => ({ n: s.n + d.responses, pos: s.pos + d.great + d.good }), { n: 0, pos: 0 });
  const badge = new Map(p.basics.badges.map((b) => [b.id, b]));
  const byBadge = [...new Set(approved.map((r) => r.badge_id))].map((id) => ({ b: badge.get(id), n: approved.filter((r) => r.badge_id === id).length })).sort((a, b) => b.n - a.n);
  return (
    <div className="space-y-5">
      <nav aria-label="Range" className="flex gap-2 text-xs">{['7', '30', '90'].map((r) => <Link key={r} href={`${p.base}?tab=analytics&range=${r}`} className={`rounded-full border px-3 py-1 ${range === Number(r) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted'}`}>{r}d</Link>)}</nav>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="📝 Total posts" value={inRange.length} note={`last ${range}d`} />
        <StatCard label="🏅 Recognitions" value={approved.length} tone="primary" />
        <StatCard label="👥 Active users" value={active.size} note={`of ${p.directory.length} people`} tone="info" />
        <StatCard label="★ Points distributed" value={approved.reduce((s, r) => s + r.points * r.recipients.length, 0)} tone="accent" />
      </div>
      <Panel title="💗 Pulse · team vibe" meta={`${totals.n ? Math.round((totals.pos / totals.n) * 100) : 0}% positive · ${totals.n} answers`} flush>
        {pulse.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Not enough check-ins yet (days need at least three answers).</p> : (
          <Table caption="Pulse by day">
            <thead><tr><Th>Day</Th>{MOODS.map((m) => <Th key={m.mood} className="text-right">{m.emoji} {m.label}</Th>)}<Th className="text-right">Answers</Th></tr></thead>
            <tbody>{pulse.map((d) => <tr key={d.day}><Td>{formatDate(d.day)}</Td><Td className="text-right tabular-nums">{d.great}</Td><Td className="text-right tabular-nums">{d.good}</Td><Td className="text-right tabular-nums">{d.okay}</Td><Td className="text-right tabular-nums">{d.stressed}</Td><Td className="text-right tabular-nums">{d.burnt}</Td><Td className="text-right tabular-nums">{d.responses}</Td></tr>)}</tbody>
          </Table>
        )}
      </Panel>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="🏅 Badge distribution">{byBadge.length === 0 ? <p className="text-sm text-muted">No badge awards yet.</p> : <ul className="space-y-1.5 text-sm">{byBadge.map(({ b, n }) => <li key={b?.id} className="flex justify-between"><span>{b?.emoji} {b?.name}</span><span className="tabular-nums">{n}</span></li>)}</ul>}</Panel>
        <Panel title="🏆 Top recognised">{leaders(list, 'received').length === 0 ? <p className="text-sm text-muted">No data yet.</p> : <ol className="space-y-1.5 text-sm">{leaders(list, 'received').map(([id, n], i) => <li key={id} className="flex justify-between"><span>{i + 1}. {nameOf(p, id)}</span><span className="tabular-nums">{n}</span></li>)}</ol>}</Panel>
        <Panel title="🎖️ Top recognisers">{leaders(list, 'given').length === 0 ? <p className="text-sm text-muted">No recognitions given yet.</p> : <ol className="space-y-1.5 text-sm">{leaders(list, 'given').map(([id, n], i) => <li key={id} className="flex justify-between"><span>{i + 1}. {nameOf(p, id)}</span><span className="tabular-nums">{n}</span></li>)}</ol>}</Panel>
      </div>
    </div>
  );
}

// ─── My insights and me ──────────────────────────────────────────────────────

async function Insights(p: Props) {
  if (!p.meId) return <Panel title="My culture insights"><p className="text-sm text-muted">Needs an employee record.</p></Panel>;
  const list = (await recognitions(p.orgId, since(90))).filter((r) => r.status === 'approved');
  const sent = list.filter((r) => r.from_employee_id === p.meId);
  const received = list.filter((r) => r.recipients.includes(p.meId!));
  const valueOf = new Map(p.basics.badges.map((b) => [b.id, b.value_id]));
  const count = (rs: Recognition[]) => p.basics.values.map((v) => ({ v, n: rs.filter((r) => valueOf.get(r.badge_id) === v.id).length })).sort((a, b) => b.n - a.n);
  const sentBy = count(sent);
  const recBy = count(received);
  const score = Math.min(100, 40 + sent.length * 8 + received.length * 5);
  const leastGiven = sentBy[sentBy.length - 1]?.v;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="📊 Culture score" value={`${score}/100`} note={score >= 70 ? '🟢 Great engagement' : score >= 50 ? '🟡 Getting there' : '🔴 Quiet lately'} tone="primary" />
        <StatCard label="Recognitions sent" value={sent.length} note="90 days" />
        <StatCard label="Received" value={received.length} note="90 days" tone="success" />
        <StatCard label="Most recognised for" value={recBy[0]?.n ? `${recBy[0].v.emoji} ${recBy[0].v.name}` : '—'} />
      </div>
      <Panel title="Suggestions">
        <ul className="space-y-2 text-sm">
          {sent.length === 0 && <li>⚡ <span className="font-medium">Send your first recognition this week</span> — teams where people recognise each other weekly report higher engagement.</li>}
          {sent.length > 0 && received.length > sent.length * 2 && <li>⚡ You receive more than you give — pass it on: recognise a colleague today.</li>}
          {leastGiven && sent.length > 0 && <li>💡 You rarely recognise <span className="font-medium">{leastGiven.emoji} {leastGiven.name}</span> — look for it in your team this week.</li>}
          <li>🗳️ Nominate someone who lives a value: <Link className="text-primary" href={`${p.base}?tab=culture&view=nominations`}>Nominations →</Link></li>
        </ul>
        <p className="mt-2 text-xs text-muted">Suggestions come from your own activity; Kredily’s AI coaching isn’t used.</p>
      </Panel>
    </div>
  );
}

async function Me(p: Props) {
  if (!p.meId) return <Panel title="My wallet"><p className="text-sm text-muted">Needs an employee record.</p></Panel>;
  const view = ['wallet', 'badges'].includes(p.sp.view ?? '') ? p.sp.view! : 'wallet';
  const [wallet, list] = await Promise.all([myWallet(p.orgId, p.meId), recognitions(p.orgId, since(3650))]);
  const mine = list.filter((r) => r.status === 'approved' && r.recipients.includes(p.meId!));
  const badge = new Map(p.basics.badges.map((b) => [b.id, b]));
  const byBadge = [...new Set(mine.map((r) => r.badge_id))].map((id) => ({ b: badge.get(id), n: mine.filter((r) => r.badge_id === id).length }));
  return (
    <div className="space-y-5">
      <SubTabs base={p.base} extra={{ tab: 'me' }} label="Me" current={view} tabs={[{ key: 'wallet', label: '💳 My Wallet' }, { key: 'badges', label: '🏅 My Badges', count: mine.length }]} />
      {view === 'wallet' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3"><StatCard label="★ Current balance" value={`${wallet.balance} pts`} tone="primary" /><StatCard label="📈 Lifetime earned" value={`${wallet.earned} pts`} /><StatCard label="🎁 Redeemed" value={`${wallet.redeemed} pts`} /></div>
          <Panel title="🕐 Transaction history" flush>
            {wallet.ledger.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No wallet activity yet.</p> : (
              <Table caption="Transactions">
                <thead><tr><Th>When</Th><Th>What</Th><Th className="text-right">Points</Th></tr></thead>
                <tbody>{wallet.ledger.map((l) => <tr key={l.id}><Td>{formatDate(l.created_at)}</Td><Td>{{ received: 'Recognised', redeemed: 'Redeemed', refund: 'Refund', adjustment: 'Adjustment' }[l.kind]}{l.note ? ` · ${l.note}` : ''}</Td>
                  <Td className={`text-right tabular-nums ${l.delta > 0 ? 'text-success' : 'text-danger'}`}>{l.delta > 0 ? '+' : ''}{l.delta}</Td></tr>)}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
      {view === 'badges' && (
        <Panel title="🏅 My badges">
          {byBadge.length === 0 ? <p className="text-sm text-muted">No badges yet.</p> : (
            <div className="flex flex-wrap gap-3">{byBadge.map(({ b, n }) => <div key={b?.id} className="rounded-xl border border-line bg-raised px-4 py-3 text-center"><p className="text-3xl">{b?.emoji}</p><p className="text-sm font-medium">{b?.name}</p><p className="text-xs text-muted">×{n}</p></div>)}</div>
          )}
          {mine.length > 0 && <ul className="mt-4 divide-y divide-line text-sm">{mine.slice(0, 20).map((r) => <li key={r.id} className="py-2"><span className="font-medium">{nameOf(p, r.from_employee_id)}</span> · {badge.get(r.badge_id)?.emoji} {badge.get(r.badge_id)?.name}<p className="text-muted">{r.message}</p></li>)}</ul>}
        </Panel>
      )}
    </div>
  );
}

// ─── Settings (admins) ───────────────────────────────────────────────────────

function Settings(p: Props) {
  const view = ['recognition', 'badges', 'values', 'rewards', 'points'].includes(p.sp.view ?? '') ? p.sp.view! : 'recognition';
  const values = p.basics.values.filter((v) => !v.archived_at).map((v) => ({ value: v.id, label: `${v.emoji} ${v.name}` }));
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Recognition rules, badges, values, rewards and points. Every change is in the <Link className="text-primary" href={`/app/${p.slug}/audit`}>audit log</Link>.</p>
      <SubTabs base={p.base} extra={{ tab: 'settings' }} label="Settings" current={view} tabs={[
        { key: 'recognition', label: '⚙️ Recognition' }, { key: 'badges', label: '🏅 Badge Store' }, { key: 'values', label: '🧬 Values' }, { key: 'rewards', label: '🎁 Rewards' }, { key: 'points', label: '★ Points' },
      ]} />
      {view === 'recognition' && <Panel title="Recognition settings"><RulesForm action={saveRulesAction.bind(null, p.slug)} s={p.basics.settings} /></Panel>}
      {view === 'badges' && (
        <>
          {p.basics.badges.map((b) => <Panel key={b.id} title={`${b.emoji} ${b.name}`} meta={`${b.points} pts${b.active ? '' : ' · retired'}`}><details><summary className="cursor-pointer text-xs text-primary">Edit</summary><div className="mt-2"><BadgeForm action={saveBadgeAction.bind(null, p.slug)} values={values} badge={b} /></div></details></Panel>)}
          <Panel title="＋ Add badge"><BadgeForm action={saveBadgeAction.bind(null, p.slug)} values={values} /></Panel>
        </>
      )}
      {view === 'values' && (
        <>
          {p.basics.values.filter((v) => !v.archived_at).map((v) => <Panel key={v.id} title={`${v.emoji} ${v.name}`}><ValueForm action={saveValueAction.bind(null, p.slug)} value={v} /></Panel>)}
          <Panel title="＋ Add value"><ValueForm action={saveValueAction.bind(null, p.slug)} /></Panel>
        </>
      )}
      {view === 'rewards' && (
        <>
          {p.basics.rewards.map((r) => <Panel key={r.id} title={r.name} meta={`${r.cost} pts${r.stock !== null ? ` · ${r.stock} in stock` : ''}${r.active ? '' : ' · hidden'}`}><RewardForm action={saveRewardAction.bind(null, p.slug)} reward={r} /></Panel>)}
          <Panel title="＋ Add reward"><RewardForm action={saveRewardAction.bind(null, p.slug)} /></Panel>
        </>
      )}
      {view === 'points' && <Panel title="Adjust someone’s points" meta="welcome bonus, correction"><AdjustForm action={adjustPointsAction.bind(null, p.slug)} people={p.directory.filter((c) => c.id !== p.meId).map((c) => ({ value: c.id, label: c.name }))} /></Panel>}
    </div>
  );
}
