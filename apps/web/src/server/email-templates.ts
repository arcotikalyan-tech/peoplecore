import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import {
  accountEmailText, DEFAULT_EMAIL_LAYOUT, layoutFromRow, type AccountEmailKey, type AccountEmailRow, type AccountEmailText,
  type EmailLayout,
} from '@peoplecore/shared';

export interface EmailTemplates {
  layout: EmailLayout;
  /** The edited rows, by email (none: the default text). */
  rows: Partial<Record<AccountEmailKey, AccountEmailRow>>;
  text: (key: AccountEmailKey) => AccountEmailText;
}

const LAYOUT_COLUMNS = 'brand_name, accent_color, logo_url, show_brand_name, footer_text, support_email, address';

/**
 * The layout and edited account emails (migration 20261031220000). Platform admins read them with their own client;
 * the send-email hook with the service role. If they can't be read, emails still go out with the defaults.
 */
export async function loadEmailTemplates(db: SupabaseClient<Database>): Promise<EmailTemplates & { complete: boolean }> {
  const [layout, templates] = await Promise.all([
    db.from('platform_email_layout').select(LAYOUT_COLUMNS).maybeSingle(),
    db.from('platform_email_templates').select('key, subject, heading, body, button_label, note'),
  ]);
  if (layout.error || templates.error) console.error('email.templates_unread', (layout.error ?? templates.error)!.message);
  const rows = Object.fromEntries((templates.data ?? []).map((r) => [r.key, r])) as EmailTemplates['rows'];
  return {
    layout: layout.data ? layoutFromRow(layout.data) : DEFAULT_EMAIL_LAYOUT,
    rows,
    text: (key) => accountEmailText(key, rows[key]),
    complete: !layout.error && !templates.error,
  };
}

/** How long the send-email hook reuses what it read: Supabase gives the hook five seconds, and most calls need none. */
const CACHE_MS = 60_000;
let cached: { at: number; value: EmailTemplates } | null = null;

/** The templates for the send-email hook, read at most once a minute (and again after a platform admin saves). */
export async function cachedEmailTemplates(db: SupabaseClient<Database>): Promise<EmailTemplates> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await loadEmailTemplates(db);
  if (value.complete) cached = { at: Date.now(), value };
  return value;
}

/** After a change in the console, so the next email uses it. */
export function forgetCachedEmailTemplates() {
  cached = null;
}
