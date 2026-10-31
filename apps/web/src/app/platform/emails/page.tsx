import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ACCOUNT_EMAIL_KEYS, type AccountEmailKey, type AccountEmailText } from '@peoplecore/shared';
import { Alert, Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { loadEmailTemplates } from '@/server/email-templates';
import { appUrl, emailStatus } from '@/server/mailer';
import { requirePlatformAdmin } from '@/server/platform';
import { createClient } from '@/server/supabase';
import { EmailTemplatesEditor } from './email-templates-editor';

export const metadata: Metadata = { title: 'Email templates' };

export default async function EmailTemplatesPage() {
  const user = await requirePlatformAdmin();
  const templates = await loadEmailTemplates(await createClient());
  const texts = Object.fromEntries(ACCOUNT_EMAIL_KEYS.map((k) => [k, templates.text(k)])) as Record<AccountEmailKey, AccountEmailText>;
  const edited = ACCOUNT_EMAIL_KEYS.filter((k) => templates.rows[k]);
  const h = await headers();
  const origin = appUrl() ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
  const { smtp, hook, fromAddress: from } = emailStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email templates"
        description="How every email PeopleCore sends looks, the same for every organization. Change the layout once; reword the account emails (invitation, password reset, sign-in link) here. Changes apply to the next email sent."
      />
      {!smtp && (
        <Alert tone="warning" title="Email isn’t set up on this server">
          SMTP_URL is missing from the server’s settings, so no email can go out (see docs/runbooks/email.md).
        </Alert>
      )}
      <EmailTemplatesEditor layout={templates.layout} texts={texts} edited={edited} email={user.email ?? 'you@example.test'} origin={origin} from={from} />
      <Card>
        <CardHeader title="How emails go out" description="From the same mailbox, in this layout." />
        <ul className="divide-y divide-line text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <span><span className="font-medium">Notifications</span> <span className="text-muted">· sent by the worker every 15 minutes</span></span>
            <Badge tone={smtp ? 'success' : 'warning'}>{smtp ? 'Mail server set' : 'No mail server'}</Badge>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <span><span className="font-medium">Account emails</span> <span className="text-muted">· sent straight away, when Supabase hands them over (its send-email hook)</span></span>
            <Badge tone={hook && smtp ? 'success' : 'warning'}>{hook ? 'Hook key set' : 'Hook key missing: Supabase’s own emails'}</Badge>
          </li>
        </ul>
      </Card>
    </div>
  );
}
