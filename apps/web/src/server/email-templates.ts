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
export async function loadEmailTemplates(db: SupabaseClient<Database>): Promise<EmailTemplates> {
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
  };
}
