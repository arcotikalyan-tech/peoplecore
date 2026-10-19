/**
 * The sidebar's shape, built on the server from the person's permissions and passed to the client shell.
 * Icons are named here and drawn by the shell (component references can't cross the server/client line).
 * Filtering is for usability only: every page re-checks, and RLS enforces.
 */
export type IconKey =
  | 'home' | 'inbox' | 'users' | 'building' | 'user-plus' | 'briefcase' | 'log-out' | 'clock' | 'palm' | 'wallet'
  | 'receipt' | 'card' | 'trophy' | 'graduation' | 'megaphone' | 'lifebuoy' | 'book' | 'file' | 'shield' | 'laptop'
  | 'sparkles' | 'chart' | 'user-cog' | 'workflow' | 'bot' | 'scroll' | 'user' | 'mail';

export interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
  exact?: boolean;
  count?: number;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/** Admin ("CEO") view or the person's own self-service view. */
export type ViewMode = 'admin' | 'self';

export const pruneEmpty = (groups: NavGroup[]) => groups.filter((g) => g.items.length > 0);
