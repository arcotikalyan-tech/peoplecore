/** The phone screens a notification can open. */
export type PushScreen = '/(app)/(tabs)' | '/(app)/(tabs)/inbox' | '/(app)/(tabs)/leave' | '/(app)/(tabs)/attendance' | '/(app)/payslips' | '/(app)/announcements';

/**
 * Which notification a tapped push was, as the server sends it (its kind and its link, empty when it has none): the
 * tap means it has been seen, so it's marked read without opening the Inbox.
 */
export function tappedNotification(data: unknown): { kind: string; link: string | null } | null {
  const d = data as { kind?: unknown; link?: unknown } | null | undefined;
  if (typeof d?.kind !== 'string' || !d.kind) return null;
  return { kind: d.kind, link: typeof d.link === 'string' && d.link ? d.link : null };
}

/**
 * The Inbox on its Notifications view, wherever it was left. `at` makes each press a new request: the tab keeps its
 * params, so the same link a second time would otherwise change nothing and leave the person on Approvals.
 */
export const notificationsLink = (at = Date.now()) => `/inbox?view=notifications&at=${at}` as const;

/**
 * Where tapping a notification takes you: its link names a website page; the phone opens its own screen for that
 * part of the app, and the Inbox (which lists every notification) for anything the phone doesn't have.
 */
export function screenFor(link: unknown): PushScreen {
  const path = typeof link === 'string' ? link.split('?')[0]! : '';
  const first = path.split('/')[1] ?? '';
  if (first === 'leave') return '/(app)/(tabs)/leave';
  if (first === 'payslips') return '/(app)/payslips';
  if (first === 'attendance') return '/(app)/(tabs)/attendance';
  if (first === 'engagement') return '/(app)/announcements';
  return '/(app)/(tabs)/inbox';
}
