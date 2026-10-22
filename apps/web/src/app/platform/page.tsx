import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/brand';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { isPlatformAdmin, requireMfaIfNeeded, requirePasswordSet, requireUser } from '@/server/context';
import { createClient } from '@/server/supabase';
import { CreateOrgForm } from './create-org-form';
import { OrgStatusControl } from './org-status-control';
import { setAccessRequestStatusAction, setPlatformRequireMfaAction } from './actions';

export const metadata: Metadata = { title: 'Platform console' };

const statusTone = { active: 'success', suspended: 'warning', archived: 'neutral' } as const;

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ support?: string }> }) {
  const { support } = await searchParams;
  const user = await requireUser();
  if (!(await isPlatformAdmin())) notFound();
  await requirePasswordSet('/platform');
  await requireMfaIfNeeded(user, '/platform');

  // Platform admins can list tenants (organizations RLS) but cannot read tenant data without membership.
  const supabase = await createClient();
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, slug, status, is_demo, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error('Failed to load organizations');
  // Support windows tenants have opened (Settings › Support access); a summary is read only on request, and audited.
  const now = new Date().toISOString();
  const { data: windows } = await supabase.from('support_access_windows').select('organization_id, reason, expires_at, revoked_at').is('revoked_at', null).gt('expires_at', now);
  const { data: requests } = await supabase.from('access_requests')
    .select('id, company, contact_name, work_email, phone, headcount, message, status, created_at')
    .order('created_at', { ascending: false }).limit(100);
  const { data: platformSettings } = await supabase.from('platform_settings').select('require_mfa_for_admins').maybeSingle();
  const requireMfa = platformSettings?.require_mfa_for_admins ?? false;
  const summary = support && (windows ?? []).some((w) => w.organization_id === support)
    ? ((await supabase.rpc('support_overview', { p_org: support })).data as Record<string, unknown> | null) : null;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Brand />
            <Badge tone="primary">Platform</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted">
            <span className="hidden sm:inline">{user.email}</span>
            <Link href="/app" className="hover:text-fg">Workspaces</Link>
            <form action="/auth/signout" method="post">
              <button className="hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PageHeader title="Organizations" description="Tenants on this PeopleCore deployment. Opening a tenant requires membership in it." />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            {orgs.length === 0 ? (
              <EmptyState title="No organizations yet" description="Create the first tenant with the form." />
            ) : (
              <Table caption="Organizations">
                <thead>
                  <tr><Th>Name</Th><Th>URL</Th><Th>Status</Th><Th>Created</Th><Th><span className="sr-only">Actions</span></Th></tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <Td className="font-medium">
                        {o.name} {o.is_demo && <Badge tone="warning">Demo</Badge>}
                      </Td>
                      <Td className="font-mono text-xs text-muted">/app/{o.slug}</Td>
                      <Td><Badge tone={statusTone[o.status]}>{o.status}</Badge></Td>
                      <Td className="text-muted">{formatDate(o.created_at)}</Td>
                      <Td className="text-right">
                        {/* key: remount after a status change so the confirmation step resets */}
                        <OrgStatusControl key={o.status} orgId={o.id} name={o.name} status={o.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {(windows ?? []).length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader title="Support access" description="Tenants that opened support access. Viewing a summary is recorded in their audit log." />
              <ul className="divide-y divide-line text-sm" aria-label="Open support access">
                {(windows ?? []).map((w) => {
                  const org = orgs.find((o) => o.id === w.organization_id);
                  return (
                    <li key={w.organization_id} className="space-y-2 px-5 py-3">
                      <p className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium">{org?.name ?? 'Organization'}</span> · {w.reason} · until {formatDate(w.expires_at)}</span>
                        <Link className="text-primary hover:underline" href={`/platform?support=${w.organization_id}`}>View summary</Link></p>
                      {support === w.organization_id && summary && (
                        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-subtle p-3 sm:grid-cols-5">
                          {Object.entries(summary).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{Array.isArray(v) ? v.join(', ') || '—' : String(v)}</dd></div>)}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <Card className="lg:col-span-2">
            <CardHeader title="Sign-up requests" description="Companies that signed up on the website. Create their organization with the form, then mark them onboarded." />
            {(requests ?? []).length === 0 ? (
              <EmptyState title="No sign-up requests yet" description="Requests from hrms.tazq.io/signup appear here." />
            ) : (
              <Table caption="Sign-up requests">
                <thead>
                  <tr><Th>Company</Th><Th>Contact</Th><Th>Team</Th><Th>Received</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {(requests ?? []).map((r) => (
                    <tr key={r.id}>
                      <Td><span className="font-medium">{r.company}</span>{r.message && <p className="mt-1 max-w-xs text-xs text-muted">{r.message}</p>}</Td>
                      <Td>{r.contact_name}<p className="text-xs text-muted">{r.work_email}{r.phone ? ` · ${r.phone}` : ''}</p></Td>
                      <Td className="text-muted">{r.headcount ?? '—'}</Td>
                      <Td className="text-muted">{formatDate(r.created_at)}</Td>
                      <Td>
                        <form action={setAccessRequestStatusAction} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <select name="status" defaultValue={r.status} aria-label={`Status of ${r.company}`} className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
                            {['new', 'contacted', 'onboarded', 'declined'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button className="text-sm text-primary hover:underline">Save</button>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Two-step sign-in for platform administrators" description={requireMfa
              ? 'On: platform administrators enter an authenticator code before any platform power works.'
              : 'Off: platform administrators sign in with their password. Anyone can still turn it on for themselves.'} />
            <form action={setPlatformRequireMfaAction} className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 text-sm">
              <input type="hidden" name="on" value={String(!requireMfa)} />
              <span className="text-xs text-muted">{requireMfa || user.aal === 'aal2'
                ? 'Recommended on: this account can create and suspend every organization.'
                : <>To turn it on, first <a className="text-primary hover:underline" href="/mfa?next=%2Fplatform">set it up for yourself</a>.</>}</span>
              {(requireMfa || user.aal === 'aal2') && (
                <button className={requireMfa ? 'rounded-md bg-danger px-3 py-1.5 text-white' : 'rounded-md border border-line px-3 py-1.5'}>{requireMfa ? 'Turn off' : 'Turn on'}</button>
              )}
            </form>
          </Card>
          <Card className="self-start">
            <CardHeader title="New organization" description="Seeds the standard roles. The owner manages everything else." />
            <CreateOrgForm />
          </Card>
        </div>
      </main>
    </div>
  );
}
