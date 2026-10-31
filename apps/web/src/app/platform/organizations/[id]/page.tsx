import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel, StatCard } from '@/components/ui/hub';
import { Badge, DetailList, EmptyState, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { MODULES } from '@/lib/modules';
import { formatINR, monthlyValue, planSummary, subscriptionState } from '@/lib/plans';
import { describeActivity } from '@/lib/platform-activity';
import { platformActivity, platformOrgs, platformPlans, platformToday } from '@/server/platform';
import { createClient } from '@/server/supabase';
import { quickSubscriptionAction } from '../../actions';
import { countryOptions, timezoneList } from '../../countries';
import { AddOwnerForm, EditOrgForm, RemoveOwnerButton, SubscriptionForm } from './forms';
import { OrgStatusControl } from './org-status-control';

export const metadata: Metadata = { title: 'Organization' };

interface Detail {
  owners: Array<{ user_id: string; email: string; last_sign_in_at: string | null; member_status: string }>;
  employees_by_status: Record<string, number>;
  members_by_status: Record<string, number>;
  disabled_modules: string[];
  last_activity_at: string | null;
  support_open: boolean;
}

const statusTone = { active: 'success', suspended: 'warning', archived: 'neutral' } as const;
const EMPLOYEE_STATUS = [['active', 'Active'], ['on_notice', 'On notice'], ['pre_joining', 'Joining soon'], ['exited', 'Left']] as const;
const MEMBER_STATUS = [['active', 'Signed up'], ['invited', 'Invited, not signed in yet'], ['suspended', 'Suspended']] as const;

export default async function PlatformOrganizationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ support?: string }> }) {
  const [{ id }, { support }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [orgs, plans, activity, { data: detailData }, { data: sub }] = await Promise.all([
    platformOrgs(), platformPlans(), platformActivity(id, 25),
    supabase.rpc('platform_org_detail', { p_org: id }),
    supabase.from('organization_subscriptions')
      .select('plan_code, status, billing_cycle, employee_limit, price_per_employee, trial_ends_at, paid_until, billing_email, notes, updated_at')
      .eq('organization_id', id).maybeSingle(),
  ]);
  const org = orgs.find((o) => o.id === id);
  const detail = detailData as unknown as Detail | null;
  if (!org || !detail) notFound();
  const summary = support && detail.support_open
    ? ((await supabase.rpc('support_overview', { p_org: id })).data as Record<string, unknown> | null) : null;

  const today = platformToday();
  const state = subscriptionState(org, today);
  const plan = plans.find((p) => p.code === org.plan_code);
  const value = monthlyValue(org);
  const planModules = plan?.modules ? new Set(plan.modules) : null;
  const notInPlan = planModules ? MODULES.filter((m) => !planModules.has(m.key)) : [];
  const switchedOff = MODULES.filter((m) => detail.disabled_modules.includes(m.key) && (!planModules || planModules.has(m.key)));
  const signedUp = detail.members_by_status.active ?? 0;

  return (
    <>
      <PageHeader title={org.name} eyebrow={<Link href="/platform/organizations" className="hover:text-fg">← Organizations</Link>}
        description={`/app/${org.slug} · ${org.timezone} · created ${formatDate(org.created_at)}`}
        actions={<span className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone[org.status]}>{org.status}</Badge>
          {org.is_demo && <Badge tone="warning">Demo</Badge>}
          <Badge tone={state.tone}>{org.plan_name ? `${org.plan_name} · ${state.label}` : state.label}</Badge>
        </span>} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Employees" value={org.employee_limit ? `${org.employees} / ${org.employee_limit}` : org.employees}
          tone={org.employee_limit && org.employees >= org.employee_limit ? 'danger' : 'muted'}
          note={org.employee_limit ? `${Math.max(0, org.employee_limit - org.employees)} left on the plan` : 'No employee limit'} />
        <StatCard label="People who can sign in" value={org.members} note={`${org.active_members_30d} signed in during the last 30 days`} />
        <StatCard label="Per month" value={value == null ? 'Custom' : formatINR(value)} tone="success"
          note={org.billing_cycle === 'annual' ? `Billed yearly: ${value == null ? '—' : formatINR(value * 12)}` : 'Billed monthly'} />
        <StatCard label="Last activity" value={detail.last_activity_at ? formatDate(detail.last_activity_at) : '—'}
          note={org.last_sign_in_at ? `Last sign-in ${formatDateTime(org.last_sign_in_at, 'Asia/Kolkata')}` : 'Nobody has signed in yet'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="min-w-0 space-y-6">
          <section id="plan" className="scroll-mt-20">
            <Panel title="Plan and billing" meta={sub?.updated_at ? `changed ${formatDate(sub.updated_at)}` : undefined}>
              {org.plan_code ? (
                <DetailList items={[
                  { label: 'Plan', value: plan ? `${plan.name} · ${planSummary(plan)}` : org.plan_name },
                  { label: 'Status', value: <Badge tone={state.tone}>{state.label}</Badge> },
                  { label: 'Billing', value: org.billing_cycle === 'annual' ? `Annual${org.annual_discount_pct ? ` (${org.annual_discount_pct}% off)` : ''}` : 'Monthly' },
                  { label: 'Price per employee', value: org.price_per_employee == null ? 'Custom' : `${formatINR(org.price_per_employee)}${sub?.price_per_employee != null ? ' (negotiated)' : ''}` },
                  { label: 'Employee limit', value: org.employee_limit ? `${org.employee_limit}${sub?.employee_limit ? ' (set for them)' : ''}` : 'None' },
                  { label: 'Trial ends', value: formatDate(org.trial_ends_at) },
                  { label: 'Paid until', value: formatDate(org.paid_until) },
                  { label: 'Billing email', value: org.billing_email ?? '—' },
                ]} />
              ) : <p className="text-sm text-warning">No plan yet: everything is switched on and there’s no employee limit. Choose a plan below.</p>}
              {sub?.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-subtle p-3 text-sm"><span className="font-medium">Notes: </span>{sub.notes}</p>}
              {org.plan_code && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={quickSubscriptionAction}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <button name="op" value="extend_trial" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">Extend trial by 14 days</button>
                  </form>
                  <form action={quickSubscriptionAction}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <button name="op" value="record_payment" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-subtle">
                      Record a payment ({org.billing_cycle === 'annual' ? '1 year' : '1 month'})
                    </button>
                  </form>
                </div>
              )}
              <details className="mt-5 rounded-lg border border-line" open={!org.plan_code}>
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Change plan or billing</summary>
                <div className="border-t border-line px-4 py-4">
                  <SubscriptionForm orgId={org.id} sub={sub}
                    plans={plans.filter((p) => p.is_active || p.code === org.plan_code).map((p) => ({
                      value: p.code, label: `${p.name}${p.is_active ? '' : ' (retired)'} · ${planSummary(p)}`, limit: p.max_employees, price: p.price_per_employee,
                    }))} />
                </div>
              </details>
            </Panel>
          </section>

          <Panel title="Organization details">
            <EditOrgForm orgId={org.id} org={org} timezones={timezoneList(org.timezone)} countries={countryOptions(org.country_code)} />
          </Panel>

          <Panel title="Activity" meta="plan, status and detail changes" flush>
            {activity.length === 0 ? <EmptyState title="Nothing yet" /> : (
              <ul className="divide-y divide-line" aria-label="Organization activity">
                {activity.map((a) => (
                  <li key={a.id} className="px-5 py-2.5 text-sm">
                    <p>{describeActivity(a)}</p>
                    <p className="text-xs text-muted">{a.actor_email ?? 'System'} · {formatDateTime(a.occurred_at, 'Asia/Kolkata')}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Owners" meta={`${detail.owners.length}`}>
            {detail.owners.length === 0 ? <p className="text-sm text-warning">No owner: nobody can manage this organization. Add one below.</p> : (
              <ul className="-mt-1 mb-4 divide-y divide-line" aria-label="Owners">
                {detail.owners.map((o) => (
                  <li key={o.user_id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={o.email}>{o.email}</span>
                      <span className="text-xs text-muted">{o.last_sign_in_at ? `Last sign-in ${formatDate(o.last_sign_in_at)}` : 'Hasn’t signed in yet'}{o.member_status !== 'active' ? ` · ${o.member_status}` : ''}</span>
                    </span>
                    {detail.owners.length > 1 && <RemoveOwnerButton orgId={org.id} userId={o.user_id} email={o.email} />}
                  </li>
                ))}
              </ul>
            )}
            <AddOwnerForm orgId={org.id} />
          </Panel>

          <Panel title="People">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {EMPLOYEE_STATUS.map(([k, label]) => (
                <div key={k}><dt className="text-xs text-muted">Employees · {label}</dt><dd className="font-medium tabular-nums">{detail.employees_by_status[k] ?? 0}</dd></div>
              ))}
              {MEMBER_STATUS.map(([k, label]) => (
                <div key={k}><dt className="text-xs text-muted">{label}</dt><dd className="font-medium tabular-nums">{detail.members_by_status[k] ?? 0}</dd></div>
              ))}
            </dl>
            {org.members > 0 && signedUp === 0 && <p className="mt-3 text-sm text-warning">Nobody has finished signing up yet.</p>}
          </Panel>

          <Panel title="Modules">
            <p className="text-sm">{planModules ? `${MODULES.length - notInPlan.length} of ${MODULES.length} modules in the plan` : 'Every module is in the plan'}{switchedOff.length ? `; the organization switched ${switchedOff.length} off` : ''}.</p>
            {notInPlan.length > 0 && <p className="mt-2 text-xs text-muted"><span className="font-medium text-fg">Not in the plan:</span> {notInPlan.map((m) => m.label).join(', ')}</p>}
            {switchedOff.length > 0 && <p className="mt-2 text-xs text-muted"><span className="font-medium text-fg">Switched off by them:</span> {switchedOff.map((m) => m.label).join(', ')}</p>}
          </Panel>

          <Panel title="Support access">
            {detail.support_open ? (
              <>
                <p className="text-sm">The owner has opened support access. Viewing the summary is recorded in their audit log.</p>
                {summary ? (
                  <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-subtle p-3 text-sm">
                    {Object.entries(summary).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k.replaceAll('_', ' ')}</dt><dd className="font-medium">{Array.isArray(v) ? v.join(', ') || '—' : String(v)}</dd></div>)}
                  </dl>
                ) : <Link className="mt-2 inline-block text-sm text-primary hover:underline" href={`/platform/organizations/${org.id}?support=1`}>View summary</Link>}
              </>
            ) : <p className="text-sm text-muted">Closed. An owner can open it for a few hours from Settings › Support access in their workspace.</p>}
          </Panel>

          <Panel title="Access">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">{org.status === 'suspended' ? 'Suspended: nobody in it can sign in.' : 'Suspending locks every member out at once, until it’s reactivated.'}</p>
              <OrgStatusControl key={org.status} orgId={org.id} name={org.name} status={org.status} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
