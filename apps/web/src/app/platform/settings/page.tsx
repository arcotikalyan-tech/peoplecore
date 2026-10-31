import type { Metadata } from 'next';
import { Panel } from '@/components/ui/hub';
import { Badge, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { platformPlans, platformSettings, requirePlatformAdmin } from '@/server/platform';
import { createClient } from '@/server/supabase';
import { setPlatformRequireMfaAction } from '../actions';
import { AddAdminForm, DefaultPlanForm, RemoveAdminButton } from './forms';

export const metadata: Metadata = { title: 'Settings' };

export default async function PlatformSettingsPage() {
  const user = await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: admins }, plans, settings] = await Promise.all([supabase.rpc('platform_admin_list'), platformPlans(), platformSettings()]);

  return (
    <>
      <PageHeader title="Settings" description="Who runs the platform, how new organizations start, and how platform administrators sign in." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Platform administrators" meta={`${admins?.length ?? 0}`} className="lg:row-span-2">
          <p className="mb-3 text-sm text-muted">They can create, edit and suspend every organization and change plans. They can’t see inside an organization unless it adds them or opens support access.</p>
          <ul className="mb-4 divide-y divide-line" aria-label="Platform administrators">
            {(admins ?? []).map((a) => (
              <li key={a.user_id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium" title={a.email}>{a.email}{a.user_id === user.id && <span className="ml-2"><Badge tone="primary">You</Badge></span>}</span>
                  <span className="text-xs text-muted">Added {formatDate(a.added_at)} · {a.last_sign_in_at ? `last sign-in ${formatDate(a.last_sign_in_at)}` : 'hasn’t signed in yet'}</span>
                </span>
                {a.user_id !== user.id && <RemoveAdminButton userId={a.user_id} email={a.email} />}
              </li>
            ))}
          </ul>
          <AddAdminForm />
        </Panel>

        <Panel title="New organizations">
          <DefaultPlanForm current={settings.defaultPlan} plans={plans.filter((p) => p.is_active).map((p) => ({ value: p.code, label: p.name }))} />
          <p className="mt-3 text-xs text-muted">Chosen for you on the New organization form; its trial length comes from the plan.</p>
        </Panel>

        <Panel title="Two-step sign-in for platform administrators">
          <p className="text-sm text-muted">{settings.requireMfa
            ? 'On: platform administrators enter an authenticator code before any platform power works.'
            : 'Off: platform administrators sign in with their password. Anyone can still turn it on for themselves.'}</p>
          <form action={setPlatformRequireMfaAction} className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <input type="hidden" name="on" value={String(!settings.requireMfa)} />
            <span className="text-xs text-muted">{settings.requireMfa || user.aal === 'aal2'
              ? 'Recommended on: these accounts can create and suspend every organization.'
              : <>To turn it on, first <a className="text-primary hover:underline" href="/mfa?next=%2Fplatform%2Fsettings">set it up for yourself</a>.</>}</span>
            {(settings.requireMfa || user.aal === 'aal2') && (
              <button className={settings.requireMfa ? 'rounded-md bg-danger px-3 py-1.5 text-white' : 'rounded-md border border-line px-3 py-1.5'}>{settings.requireMfa ? 'Turn off' : 'Turn on'}</button>
            )}
          </form>
        </Panel>
      </div>
    </>
  );
}
