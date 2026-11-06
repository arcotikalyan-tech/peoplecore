'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { SEEN_AFTER_MS } from '@peoplecore/shared';
import { Card, CardHeader } from '@/components/ui/surface';

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  when: string;
  unread: boolean;
}

/**
 * The notifications, marked read once they've been on screen for a moment (see @peoplecore/shared/notifications; the
 * phone's Inbox does the same). Done from the browser, not while the server renders the page, because Next can fetch a
 * page ahead of a click, and only here is the list known to be in view: it can sit below the fold on a small screen.
 * Marking them refreshes the page, so from then on they look read and the count has gone.
 */
export function NotificationsCard({ items, through, markSeen }: { items: NotificationItem[]; through: string | null; markSeen: (through: string) => Promise<void> }) {
  const unread = items.filter((n) => n.unread).length;
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = card.current;
    if (!through || !el) return;
    let onScreen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (onScreen && document.visibilityState === 'visible') {
        timer ??= setTimeout(() => void markSeen(through), SEEN_AFTER_MS);
      } else {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const seen = new IntersectionObserver(([entry]) => { onScreen = entry?.isIntersecting ?? false; check(); });
    seen.observe(el);
    document.addEventListener('visibilitychange', check);
    return () => {
      seen.disconnect();
      document.removeEventListener('visibilitychange', check);
      clearTimeout(timer);
    };
  }, [through, markSeen]);

  return (
    <div ref={card}>
      <Card>
        <CardHeader title="Notifications" description={unread ? `${unread} new` : 'All caught up'} />
        {items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Notifications">
            {items.map((n) => (
              <li key={n.id} data-new={n.unread || undefined} className={`px-5 py-3 text-sm ${n.unread ? 'bg-primary-soft/40' : ''}`}>
                <p className="font-medium">{n.href ? (
                  // A quick click: leaving now would stop the timer.
                  <Link className="hover:underline" href={n.href} onClick={() => { if (through) void markSeen(through); }}>{n.title}</Link>
                ) : n.title}</p>
                {n.body && <p className="text-muted">{n.body}</p>}
                <p className="mt-0.5 text-xs text-muted">{n.when}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
