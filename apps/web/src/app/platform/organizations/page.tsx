import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { formatINR, monthlyValue, subscriptionState } from '@/lib/plans';
import { platformOrgs, platformPlans, platformToday } from '@/server/platform';

export const metadata: Metadata = { title: 'Organizations' };

const statusTone = { active: 'success', suspended: 'warning', archived: 'neutral' } as const;

export default async function PlatformOrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; plan?: string }> }) {
  const { q = '', status = '', plan = '' } = await searchParams;
  const [orgs, plans] = await Promise.all([platformOrgs(), platformPlans()]);
  const today = platformToday();
  const needle = q.trim().toLowerCase();
  const shown = orgs.filter((o) =>
    (!needle || o.name.toLowerCase().includes(needle) || o.slug.includes(needle) || o.owner_emails.some((e) => e.toLowerCase().includes(needle)))
    && (!status || (status === 'trialing' || status === 'past_due' ? o.subscription_status === status : o.status === status))
    && (!plan || (plan === 'none' ? !o.plan_code : o.plan_code === plan)));
  const select = 'h-9 rounded-md border border-line bg-surface px-2 text-sm';

  return (
    <>
      <PageHeader title="Organizations" description="Every tenant with its plan, people and usage. Opening a workspace itself needs membership in it."
        actions={<ButtonLink href="/platform/organizations/new">New organization</ButtonLink>} />
      <form role="search" aria-label="Find organizations" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" name="q" defaultValue={q} placeholder="Name, URL or owner’s email" aria-label="Search organizations"
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm sm:max-w-xs" />
        <select name="status" defaultValue={status} aria-label="Status" className={select}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="trialing">On trial</option>
          <option value="past_due">Payment due</option>
        </select>
        <select name="plan" defaultValue={plan} aria-label="Plan" className={select}>
          <option value="">Any plan</option>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          <option value="none">No plan</option>
        </select>
        <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-subtle">Filter</button>
        {(q || status || plan) && <Link href="/platform/organizations" className="text-sm text-muted hover:text-fg">Clear</Link>}
        <span className="ml-auto text-sm text-muted">{shown.length} of {orgs.length}</span>
      </form>
      <Card>
        {shown.length === 0 ? (
          <EmptyState title={orgs.length ? 'No organization matches' : 'No organizations yet'} description={orgs.length ? 'Try another search or filter.' : 'Create the first one.'} />
        ) : (
          <Table caption="Organizations">
            <thead>
              <tr><Th>Organization</Th><Th>Plan</Th><Th>Employees</Th><Th>People</Th><Th className="text-right">Per month</Th><Th>Last sign-in</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const state = subscriptionState(o, today);
                const value = monthlyValue(o);
                const full = o.employee_limit ? Math.min(100, (o.employees / o.employee_limit) * 100) : 0;
                return (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/platform/organizations/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                      {o.is_demo && <span className="ml-2"><Badge tone="warning">Demo</Badge></span>}
                      <p className="font-mono text-xs text-muted">/app/{o.slug}</p>
                      {o.owner_emails.length > 0 && <p className="max-w-[16rem] truncate text-xs text-muted" title={o.owner_emails.join(', ')}>{o.owner_emails.join(', ')}</p>}
                    </Td>
                    <Td>
                      <p>{o.plan_name ?? <span className="text-muted">No plan</span>}</p>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </Td>
                    <Td className="tabular-nums">
                      {o.employees}{o.employee_limit ? <span className="text-muted"> / {o.employee_limit}</span> : null}
                      {o.employee_limit ? (
                        <div className="mt-1 h-1.5 w-20 rounded-full bg-subtle" aria-hidden="true">
                          <div className={`h-1.5 rounded-full ${full >= 100 ? 'bg-danger' : full >= 90 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${full}%` }} />
                        </div>
                      ) : null}
                    </Td>
                    <Td className="tabular-nums">{o.members}<p className="text-xs text-muted">{o.active_members_30d} active in 30 days</p></Td>
                    <Td className="text-right tabular-nums">{value == null ? <span className="text-muted">Custom</span> : formatINR(value)}</Td>
                    <Td className="text-muted">{o.last_sign_in_at ? formatDate(o.last_sign_in_at) : 'Never'}</Td>
                    <Td><Badge tone={statusTone[o.status]}>{o.status}</Badge><p className="mt-1 text-xs text-muted">since {formatDate(o.created_at)}</p></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
