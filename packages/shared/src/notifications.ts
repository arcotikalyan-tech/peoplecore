/**
 * Notifications count as read once they've been seen, on the website and the phone alike: when the list has been on
 * screen for a moment, everything up to the newest unread one shown is marked read. One that arrives after the list
 * was read stays unread, and so does anything never shown on screen.
 */

/** How long the list must be on screen to count as seen, so passing through the screen doesn't. */
export const SEEN_AFTER_MS = 1200;

export interface NotificationLike {
  created_at: string;
  read_at: string | null;
}

/**
 * The time of the newest unread notification, up to which the list is marked read; null when nothing is unread.
 * The times come from the database in one format, so they compare as text (and keep their microseconds).
 */
export function newestUnread(list: readonly NotificationLike[]): string | null {
  let newest: string | null = null;
  for (const n of list) if (!n.read_at && (newest === null || n.created_at > newest)) newest = n.created_at;
  return newest;
}
