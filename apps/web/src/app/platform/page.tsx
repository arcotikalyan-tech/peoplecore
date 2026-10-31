import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { Panel, StatCard } from '@/components/ui/hub';
import { Badge, EmptyState, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { attentionReasons, formatINR, isRevenue, monthlyValue, subscriptionState } from '@/lib/plans';
import { describeActivity } from '@/lib/platform-activity';
import { newRequestCount, platformActivity, platformOrgs, platformPlans, platformToday } from '@/server/platform';

export const metadata: Metadata = { title: 'Overview' };

export default async function PlatformOverviewPage() {
  const [orgs, plans, requests, activity] = await Promise.all([platformOrgs(), platformPlans(), newRequestCount(), platformActivity(null, 8)]);
  const today = platformToday();
  // Demo tenants hold synthetic data: they're listed, but kept out of revenue and usage figures.
  const real = orgs.filter((o) => !o.is_demo);
  const mrr = real.filter((o) => isRevenue(o.subscription_status)).reduce((sum, o) => sum + (monthlyValue(o) ?? 0), 0);
  const trials = real.filter((o) => o.subscription_status === 'trialing');
  const pipeline = trials.reduce((sum, o) => sum + (monthlyValue(o) ?? 0), 0);
  const employees = real.reduce((sum, o) => sum + o.employees, 0);
  const members = real.reduce((sum, o) => sum + o.members, 0);
  const active30 = real.reduce((sum, o) => sum + o.active_members_30d, 0);
  const attention = orgs.filter((o) => !o.is_demo || o.status === 'suspended')
    .map((o) => ({ org: o, reasons: attentionReasons(o, today) })).filter((a) => a.reasons.length > 0)
    .sort((a, b) => Number(b.reasons[0]!.tone === 'danger') - Number(a.reasons[0]!.tone === 'danger'));
  const byPlan = plans.map((p) => {
    const on = real.filter((o) => o.plan_code === p.code);
    return { plan: p, count: on.length, mrr: on.filter((o) => isRevenue(o.subscription_status)).reduce((s, o) => s + (monthlyValue(o) ?? 0), 0) };
  }).filter((p) => p.count > 0 || p.plan.is_active);
  const most = Math.max(1, ...byPlan.map((p) => p.count));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  return (
    <>
      <PageHeader title="Overview" description="Every organization on PeopleCore: revenue, usage and what needs you."
        actions={<ButtonLink href="/platform/organizations/new">New organization</ButtonLink>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organizations" value={real.length} href="/platform/organizations"
          note={`${real.filter((o) => o.status === 'active').length} active · ${real.filter((o) => o.status === 'suspended').length} suspended${orgs.length > real.length ? ` · ${orgs.length - real.length} demo` : ''}`} />
        <StatCard label="Monthly revenue" value={formatINR(mrr)} tone="success" note={`${formatINR(mrr * 12)} a year · ${formatINR(pipeline)} in trials`} />
        <StatCard label="Employees managed" value={employees.toLocaleString('en-IN')} note={`${members.toLocaleString('en-IN')} people can sign in`} />
        <StatCard label="Active in 30 days" value={active30.toLocaleString('en-IN')} tone="primary"
          note={members ? `${Math.round((active30 / members) * 100)}% of everyone who can sign in` : 'Nobody signed in yet'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Panel title="Needs attention" meta={attention.length + requests ? `${attention.length + (requests ? 1 : 0)}` : undefined} flush>
          {attention.length === 0 && requests === 0 ? (
            <EmptyState title="Nothing needs you" description="Trials, payments, plan limits and sign-ups that need a decision show up here." />
          ) : (
            <ul className="divide-y divide-line" aria-label="Needs attention">
              {requests > 0 && (
                <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><span className="font-medium">{requests} new sign-up request{requests === 1 ? '' : 's'}</span> <span className="text-muted">from the website</span></span>
                  <Link href="/platform/requests" className="text-primary hover:underline">Review</Link>
                </li>
              )}
              {attention.slice(0, 12).map(({ org, reasons }) => (
                <li key={org.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <Link href={`/platform/organizations/${org.id}`} className="font-medium hover:underline">{org.name}</Link>
                    <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">{reasons.map((r) => <Badge key={r.text} tone={r.tone}>{r.text}</Badge>)}</span>
                  </span>
                  <Link href={`/platform/organizations/${org.id}#plan`} className="text-primary hover:underline">Open</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Plans" action={<Link href="/platform/plans" className="text-sm text-primary hover:underline">Manage plans</Link>}>
          <ul className="space-y-3" aria-label="Organizations by plan">
            {byPlan.map(({ plan, count, mrr: value }) => (
              <li key={plan.code}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{plan.name}{!plan.is_active && <span className="ml-1 text-xs text-muted">(retired)</span>}</span>
                  <span className="tabular-nums text-muted">{count} org{count === 1 ? '' : 's'}{value ? ` · ${formatINR(value)}/mo` : ''}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-subtle" aria-hidden="true">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(count / most) * 100}%` }} />
                </div>
              </li>
            ))}
            {real.some((o) => !o.plan_code) && <li className="text-sm text-warning">{real.filter((o) => !o.plan_code).length} without a plan</li>}
          </ul>
        </Panel>

        <Panel title="Newest organizations" action={<Link href="/platform/organizations" className="text-sm text-primary hover:underline">All organizations</Link>} flush>
          {orgs.length === 0 ? <EmptyState title="No organizations yet" action={<ButtonLink href="/platform/organizations/new">Create the first</ButtonLink>} /> : (
            <ul className="divide-y divide-line" aria-label="Newest organizations">
              {orgs.slice(0, 6).map((o) => {
                const state = subscriptionState(o, today);
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <Link href={`/platform/organizations/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                      {o.is_demo && <span className="ml-2"><Badge tone="warning">Demo</Badge></span>}
                      <span className="block text-xs text-muted">{o.plan_name ?? 'No plan'} · {o.employees} employee{o.employees === 1 ? '' : 's'} · created {formatDate(o.created_at)}</span>
                    </span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" action={<Link href="/platform/activity" className="text-sm text-primary hover:underline">Full log</Link>} flush>
          {activity.length === 0 ? <EmptyState title="No activity yet" /> : (
            <ul className="divide-y divide-line" aria-label="Recent activity">
              {activity.map((a) => (
                <li key={a.id} className="px-5 py-2.5 text-sm">
                  <p>{describeActivity(a)}</p>
                  <p className="text-xs text-muted">{a.organization_id ? `${orgName.get(a.organization_id) ?? 'Organization'} · ` : ''}{a.actor_email ?? 'System'} · {formatDateTime(a.occurred_at, 'Asia/Kolkata')}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
