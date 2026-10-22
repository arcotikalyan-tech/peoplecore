import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { HubHeader, Panel } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDateTime } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { requireModule } from '@/server/modules';
import { createClient } from '@/server/supabase';
import { ButtonAction } from '../settings/settings-client';
import {
  addTopicAction, archiveTopicAction, createThreadAction, deleteReplyAction, deleteThreadAction, editThreadAction, hideReplyAction, likeAction,
  moderateThreadAction, replyAction,
} from './actions';
import { EditThreadForm, NewThreadForm, ReplyForm, TopicForm } from './konnect-client';

export const metadata: Metadata = { title: 'Konnect' };

type Search = Record<string, string | undefined>;
const uuid = /^[0-9a-f-]{36}$/i;

interface ThreadView {
  id: string; topic_id: string; title: string; body: string; author_name: string; pinned: boolean; locked: boolean; hidden: boolean;
  reply_count: number; like_count: number; created_at: string; edited_at: string | null; mine: boolean; moderator: boolean; liked: boolean;
  replies: Array<{ id: string; body: string; author_name: string; hidden: boolean; created_at: string; edited_at: string | null; mine: boolean }>;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
function Avatar({ name }: { name: string }) {
  return <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(name)}</span>;
}

/**
 * Konnect (Kredily's employee social network): the company discussion board. Topics down the side, discussions with
 * replies and likes; authors edit or remove their own posts and people who manage announcements moderate.
 */
export default async function KonnectPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'konnect');
  const base = `/app/${slug}/konnect`;
  const supabase = await createClient();
  const moderator = ctx.can('announcement.manage', 'org');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const topicId = sp.topic && uuid.test(sp.topic) ? sp.topic : undefined;
  const q = (sp.q ?? '').slice(0, 80);
  const [{ data: topicRows }, { data: list }, thread] = await Promise.all([
    supabase.from('konnect_topics').select('id, name, emoji, description, archived_at, position').eq('organization_id', ctx.org.id).order('position').order('name'),
    supabase.rpc('konnect_thread_list', { p_org: ctx.org.id, p_topic: topicId ?? (null as unknown as string), p_query: q || (null as unknown as string), p_limit: 100 }),
    sp.thread && uuid.test(sp.thread) ? supabase.rpc('konnect_thread_view', { p_thread: sp.thread }).then((r) => r.data as unknown as ThreadView | null) : Promise.resolve(null),
  ]);
  const topics = topicRows ?? [];
  const threads = list ?? [];
  const open = topics.filter((t) => !t.archived_at);
  const topicName = new Map(topics.map((t) => [t.id, `${t.emoji ? `${t.emoji} ` : ''}${t.name}`]));
  const current = topics.find((t) => t.id === topicId);
  const when = (iso: string) => formatDateTime(iso, ctx.org.timezone);

  return (
    <>
      <HubHeader title="Konnect" subtitle="The company discussion board: ask, share ideas and talk about anything with colleagues." />
      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Topics" flush>
            <nav aria-label="Topics">
              <ul className="space-y-0.5 px-2">
                <li><Link href={base} aria-current={!topicId && !thread ? 'page' : undefined}
                  className={cn('block rounded-lg px-3 py-2 text-sm', !topicId ? 'bg-primary-soft font-medium' : 'hover:bg-subtle')}>💬 All discussions</Link></li>
                {topics.map((t) => (
                  <li key={t.id}>
                    <Link href={`${base}?topic=${t.id}`} aria-current={topicId === t.id ? 'page' : undefined}
                      className={cn('block rounded-lg px-3 py-2 text-sm', topicId === t.id ? 'bg-primary-soft font-medium' : 'hover:bg-subtle', t.archived_at && 'text-muted')}>
                      {t.emoji ?? '#'} {t.name}{t.archived_at && <span className="ml-1 text-xs">(closed)</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </Panel>
          {moderator && (
            <Panel title="Manage topics">
              <div className="space-y-3">
                <TopicForm action={addTopicAction.bind(null, slug)} />
                {current && (
                  <ButtonAction action={archiveTopicAction.bind(null, slug, current.id, !current.archived_at)} aria={`${current.archived_at ? 'Reopen' : 'Close'} topic ${current.name}`}
                    label={current.archived_at ? 'Reopen this topic' : 'Close this topic'} variant="ghost" />
                )}
              </div>
            </Panel>
          )}
        </div>

        {thread ? (
          <div className="space-y-5">
            <Link href={`${base}?topic=${thread.topic_id}`} className="text-sm text-muted hover:text-fg">← {topicName.get(thread.topic_id) ?? 'Topic'}</Link>
            <article aria-label={thread.title} className="lift-soft rounded-xl border border-line bg-surface p-5">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Avatar name={thread.author_name} />
                  <div>
                    <h1 className="text-lg font-semibold">{thread.title}</h1>
                    <p className="text-xs text-muted">{thread.author_name} · {when(thread.created_at)}{thread.edited_at ? ' · edited' : ''}</p>
                  </div>
                </div>
                <span className="flex flex-wrap gap-1">
                  {thread.pinned && <Badge tone="primary">📌 Pinned</Badge>}{thread.locked && <Badge>🔒 Locked</Badge>}{thread.hidden && <Badge tone="warning">Hidden</Badge>}
                </span>
              </header>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{thread.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
                {me && <ButtonAction action={likeAction.bind(null, slug, thread.id, !thread.liked)} aria={thread.liked ? 'Unlike' : 'Like'} label={`${thread.liked ? '💙' : '👍'} ${thread.like_count}`} variant="ghost" />}
                <span className="text-muted">{thread.reply_count} repl{thread.reply_count === 1 ? 'y' : 'ies'}</span>
                {thread.moderator && (
                  <span className="ml-auto flex flex-wrap gap-1">
                    <ButtonAction action={moderateThreadAction.bind(null, slug, thread.id, thread.pinned ? 'unpin' : 'pin')} aria={thread.pinned ? 'Unpin' : 'Pin'} label={thread.pinned ? 'Unpin' : '📌 Pin'} variant="ghost" />
                    <ButtonAction action={moderateThreadAction.bind(null, slug, thread.id, thread.locked ? 'unlock' : 'lock')} aria={thread.locked ? 'Unlock' : 'Lock'} label={thread.locked ? 'Unlock' : '🔒 Lock'} variant="ghost" />
                    <ButtonAction action={moderateThreadAction.bind(null, slug, thread.id, thread.hidden ? 'unhide' : 'hide')} aria={thread.hidden ? 'Unhide' : 'Hide'} label={thread.hidden ? 'Unhide' : 'Hide'} variant="ghost" />
                  </span>
                )}
                {(thread.mine || thread.moderator) && <ButtonAction action={deleteThreadAction.bind(null, slug, thread.id)} aria="Remove this discussion" label="Remove" variant="ghost" />}
              </div>
              {thread.mine && (
                <details className="mt-3 rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-sm text-primary">Edit</summary>
                  <div className="mt-3"><EditThreadForm action={editThreadAction.bind(null, slug, thread.id)} title={thread.title} body={thread.body} /></div>
                </details>
              )}
            </article>
            <Panel title="Replies" meta={`${thread.replies.length}`}>
              {thread.replies.length === 0 ? <p className="text-sm text-muted">No replies yet.</p> : (
                <ul className="space-y-4" aria-label="Replies">
                  {thread.replies.map((r) => (
                    <li key={r.id} className={cn('flex gap-3', r.hidden && 'opacity-60')}>
                      <Avatar name={r.author_name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted"><span className="font-medium text-fg">{r.author_name}</span> · {when(r.created_at)}{r.hidden ? ' · hidden' : ''}</p>
                        <p className="mt-1 whitespace-pre-line text-sm">{r.body}</p>
                        <div className="mt-1 flex gap-1">
                          {(r.mine || thread.moderator) && <ButtonAction action={deleteReplyAction.bind(null, slug, r.id)} aria={`Remove reply by ${r.author_name}`} label="Remove" variant="ghost" />}
                          {thread.moderator && <ButtonAction action={hideReplyAction.bind(null, slug, r.id, !r.hidden)} aria={`${r.hidden ? 'Unhide' : 'Hide'} reply by ${r.author_name}`} label={r.hidden ? 'Unhide' : 'Hide'} variant="ghost" />}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 border-t border-line pt-4">
                {thread.locked ? <p className="text-sm text-muted">🔒 This discussion is locked; no new replies.</p>
                  : me ? <ReplyForm action={replyAction.bind(null, slug, thread.id)} /> : <p className="text-sm text-muted">Only employees can reply.</p>}
              </div>
            </Panel>
          </div>
        ) : (
          <div className="space-y-5">
            {me && open.length > 0 && (
              <details className="lift-soft rounded-xl border border-line bg-surface p-5" open={threads.length === 0 || undefined}>
                <summary className={buttonClass('primary', 'sm', 'cursor-pointer list-none')}>＋ Start a discussion</summary>
                <div className="mt-4"><NewThreadForm action={createThreadAction.bind(null, slug)} topics={open.map((t) => ({ value: t.id, label: `${t.emoji ? `${t.emoji} ` : ''}${t.name}` }))} topicId={current && !current.archived_at ? current.id : undefined} /></div>
              </details>
            )}
            <Panel title={current ? topicName.get(current.id)! : 'All discussions'} meta={current?.description ?? `${threads.length} discussion${threads.length === 1 ? '' : 's'}`} flush
              action={
                <form method="get" action={base} className="flex gap-2" aria-label="Search discussions">
                  {topicId && <input type="hidden" name="topic" value={topicId} />}
                  <input name="q" defaultValue={q} placeholder="Search discussions" aria-label="Search discussions" className="h-8 w-48 rounded-md border border-line-strong bg-surface px-2.5 text-sm" />
                  <button className={buttonClass('secondary', 'sm')}>Search</button>
                </form>
              }>
              {threads.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{q ? 'Nothing matches that search.' : 'No discussions here yet. Start one!'}</p> : (
                <ul className="divide-y divide-line" aria-label="Discussions">
                  {threads.map((t) => (
                    <li key={t.id} className="px-5 py-3">
                      <Link href={`${base}?thread=${t.id}`} className="flex items-start gap-3 hover:opacity-90">
                        <Avatar name={t.author_name} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 font-medium">{t.pinned && <span aria-label="Pinned">📌</span>}{t.locked && <span aria-label="Locked">🔒</span>}{t.title}{t.hidden && <Badge tone="warning">Hidden</Badge>}</span>
                          <span className="block truncate text-sm text-muted">{t.excerpt}</span>
                          <span className="mt-0.5 block text-xs text-muted">{t.author_name} · {!topicId && `${topicName.get(t.topic_id) ?? ''} · `}last activity {when(t.last_activity_at)}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs text-muted tabular-nums">💬 {t.reply_count}<br />👍 {t.like_count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </div>
    </>
  );
}
