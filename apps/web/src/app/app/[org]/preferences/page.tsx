import type { Metadata } from 'next';
import { buttonClass } from '@/components/ui/button';
import { cookies } from 'next/headers';
import { AppearanceSettings } from '@/components/shell/theme-menu';
import { Panel } from '@/components/ui/hub';
import { PageHeader } from '@/components/ui/surface';
import { asScene, asTheme, asWeather, COOKIE } from '@/lib/theme';
import { Badge } from '@/components/ui/surface';
import { ProfileChecklist } from '@/components/profile-checklist';
import { legalName } from '@peoplecore/shared';
import type { Completeness } from '@/lib/profile-checklist';
import { formatDate } from '@/lib/format';
import { getOrgContext, needsMfa } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { changePasswordAction, signOutOtherDevicesAction, turnOffTwoStepAction } from './account-actions';
import { ChangePasswordForm, SignOutOthersButton, TurnOffTwoStepButton } from './account-client';
import { requestDeletionAction } from './privacy-actions';
import { DeletionRequestForm } from './privacy-client';
import { SCOPE_LABELS } from './privacy-data';

export const metadata: Metadata = { title: 'Account settings' };

/**
 * The signed-in person's account: who they are, their password and sessions, two-step sign-in, how complete their
 * employee profile is, appearance for this browser, and their personal data.
 */
export default async function PreferencesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const jar = await cookies();
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const supabase = await createClient();
  const requests = me ? (await supabase.from('data_deletion_requests').select('id, scope, status, decision_note, created_at, decided_at').eq('employee_id', me.id).order('created_at', { ascending: false })).data ?? [] : [];
  const pending = requests.some((r) => r.status === 'pending');
  const [{ data: aal }, { data: completeness }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    me ? supabase.rpc('my_profile_completeness', { p_org: ctx.org.id }) : Promise.resolve({ data: null }),
  ]);
  const twoStepOn = aal?.nextLevel === 'aal2';
  const twoStepRequired = await needsMfa();
  const base = `/app/${slug}`;
  return (
    <>
      <PageHeader title="Account settings" description="Your sign-in, password and security, your profile, and how PeopleCore looks for you." />
      <div className="max-w-xl space-y-5">
        <Panel title="Account">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted">Name</dt><dd className="mt-1">{me ? legalName(me) : '—'}</dd></div>
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted">Sign-in email</dt><dd className="mt-1 break-all">{ctx.user.email}</dd></div>
          </dl>
          {me
            ? <p className="mt-3 text-sm"><a className="text-primary hover:underline" href={`${base}/employees/${me.id}?tab=personal`}>Edit your profile details →</a></p>
            : <p className="mt-3 text-sm text-muted">Your sign-in isn’t linked to an employee profile yet. HR links it, after which you can punch in, apply for leave and see your pay.</p>}
        </Panel>
        {completeness && (
          <Panel title="Your profile" meta="what HR and payroll need from you">
            <ProfileChecklist base={base} c={completeness as unknown as Completeness} />
          </Panel>
        )}
        <Panel title="Password">
          <ChangePasswordForm action={changePasswordAction.bind(null, slug)} email={ctx.user.email ?? ''} />
          <p className="mt-3 text-xs text-muted">Forgotten it? Sign out and use “Forgot password?” on the sign-in page.</p>
        </Panel>
        <Panel title="Signed-in devices">
          <p className="mb-3 text-sm text-muted">Signed in on a shared computer or lost a phone? Sign out everywhere except here.</p>
          <SignOutOthersButton action={signOutOtherDevicesAction.bind(null, slug)} />
        </Panel>
        <Panel title="Appearance" meta="Auto is light by day and dark at night">
          <AppearanceSettings initial={{
            theme: asTheme(jar.get(COOKIE.theme)?.value), scene: asScene(jar.get(COOKIE.scene)?.value), weather: asWeather(jar.get(COOKIE.weather)?.value),
          }} />
        </Panel>
        <Panel title="Two-step sign-in" meta={twoStepOn ? 'On' : 'Off'}>
          {twoStepOn ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p>✓ Your sign-in asks for a code from your authenticator app.
                {twoStepRequired && <span className="mt-1 block text-xs text-muted">Your organization requires it for everyone.</span>}</p>
              {!twoStepRequired && <TurnOffTwoStepButton action={turnOffTwoStepAction.bind(null, slug)} />}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="max-w-sm text-muted">Add a code from an authenticator app (Google Authenticator, Microsoft Authenticator) so a leaked password alone can’t open your account.</p>
              <a href={`/mfa?next=${encodeURIComponent(`/app/${slug}/preferences`)}`} className={buttonClass('secondary', 'sm')}>Turn on</a>
            </div>
          )}
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
