import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { AppearanceSettings } from '@/components/shell/theme-menu';
import { Panel } from '@/components/ui/hub';
import { PageHeader } from '@/components/ui/surface';
import { asScene, asTheme, asWeather, COOKIE } from '@/lib/theme';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { requestDeletionAction } from './privacy-actions';
import { DeletionRequestForm, SCOPE_LABELS } from './privacy-client';

export const metadata: Metadata = { title: 'My preferences' };

/** Personal preferences for this browser: appearance (theme, time-of-day scene, weather tint). */
export default async function PreferencesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const jar = await cookies();
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const supabase = await createClient();
  const requests = me ? (await supabase.from('data_deletion_requests').select('id, scope, status, decision_note, created_at, decided_at').eq('employee_id', me.id).order('created_at', { ascending: false })).data ?? [] : [];
  const pending = requests.some((r) => r.status === 'pending');
  return (
    <>
      <PageHeader title="My preferences" description="How PeopleCore looks for you, and your personal data." />
      <div className="max-w-xl space-y-5">
        <Panel title="Appearance" meta="Auto is light by day and dark at night">
          <AppearanceSettings initial={{
            theme: asTheme(jar.get(COOKIE.theme)?.value), scene: asScene(jar.get(COOKIE.scene)?.value), weather: asWeather(jar.get(COOKIE.weather)?.value),
          }} />
        </Panel>
        {me && (
          <Panel title="Your personal data" meta="ask HR to erase optional details">
            <p className="mb-3 text-sm text-muted">Records the law requires us to keep — identity numbers, salary, tax and statutory filings, your employment record — can’t be erased while they must be kept.</p>
            {pending ? <p className="text-sm">⏳ Your request is with HR.</p> : <DeletionRequestForm action={requestDeletionAction.bind(null, slug)} />}
            {requests.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm" aria-label="Your deletion requests">{requests.map((r) => (
                <li key={r.id} className="py-2"><span className="flex items-center justify-between gap-2"><span>{formatDate(r.created_at)} · {r.scope.map((x) => SCOPE_LABELS[x] ?? x).join(', ')}</span>
                  <Badge tone={r.status === 'completed' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'}>{r.status === 'completed' ? 'Erased' : r.status === 'rejected' ? 'Declined' : 'Pending'}</Badge></span>
                  {r.decision_note && <span className="text-xs text-muted">{r.decision_note}</span>}</li>
              ))}</ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
