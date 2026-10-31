import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/surface';
import { MODULES } from '@/lib/modules';
import { formatINR, isRevenue, monthlyValue, planSummary } from '@/lib/plans';
import { platformOrgs, platformPlans, platformSettings } from '@/server/platform';

export const metadata: Metadata = { title: 'Plans' };

export default async function PlansPage() {
  const [plans, orgs, settings] = await Promise.all([platformPlans(), platformOrgs(), platformSettings()]);
  const real = orgs.filter((o) => !o.is_demo);

  return (
    <>
      <PageHeader title="Plans" description="What organizations can buy: price, employee limit, trial and modules. A change applies to every organization on the plan at once."
        actions={<ButtonLink href="/platform/plans/new">New plan</ButtonLink>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const on = real.filter((o) => o.plan_code === p.code);
          const mrr = on.filter((o) => isRevenue(o.subscription_status)).reduce((s, o) => s + (monthlyValue(o) ?? 0), 0);
          return (
            <Card key={p.code} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <span className="flex gap-1">
                  {p.code === settings.defaultPlan && <Badge tone="primary">Default</Badge>}
                  {!p.is_active && <Badge tone="neutral">Retired</Badge>}
                </span>
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {p.price_per_employee == null ? 'Custom' : p.price_per_employee === 0 && !p.base_price ? 'Free' : formatINR(p.price_per_employee)}
                {p.price_per_employee ? <span className="text-sm font-normal text-muted"> /employee/month</span> : null}
              </p>
              <p className="mt-1 text-sm text-muted">{planSummary(p)}</p>
              {p.description && <p className="mt-3 text-sm">{p.description}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
                <div><dt className="text-xs text-muted">Free trial</dt><dd>{p.trial_days ? `${p.trial_days} days` : 'None'}</dd></div>
                <div><dt className="text-xs text-muted">Modules</dt><dd>{p.modules ? `${p.modules.length} of ${MODULES.length}` : 'All'}</dd></div>
                <div><dt className="text-xs text-muted">Organizations</dt><dd className="tabular-nums">{on.length}</dd></div>
                <div><dt className="text-xs text-muted">Revenue a month</dt><dd className="tabular-nums">{formatINR(mrr)}</dd></div>
                {p.annual_discount_pct > 0 && <div className="col-span-2"><dt className="text-xs text-muted">Annual billing</dt><dd>{p.annual_discount_pct}% off</dd></div>}
              </dl>
              <div className="mt-auto pt-4">
                <Link href={`/platform/plans/${p.code}`} className="text-sm font-medium text-primary hover:underline" aria-label={`Edit ${p.name}`}>Edit plan</Link>
                {on.length > 0 && <Link href={`/platform/organizations?plan=${p.code}`} className="ml-4 text-sm text-muted hover:text-fg">See organizations</Link>}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-6 text-sm text-muted">
        New organizations start on <span className="font-medium text-fg">{plans.find((p) => p.code === settings.defaultPlan)?.name ?? settings.defaultPlan}</span> unless you choose another;
        change the default in <Link href="/platform/settings" className="text-primary hover:underline">Settings</Link>. Prices are in rupees, before GST.
      </p>
    </>
  );
}
