import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getAcknowledgementStatus, getPolicies } from '@/server/onboarding';
import { acknowledgePolicyAction, publishPolicyAction } from '../onboarding/actions';
import { PublishPolicyForm } from '../onboarding/onboarding-forms';

export const metadata: Metadata = { title: 'Policies' };

export default async function PoliciesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const policies = await getPolicies(ctx.org.id, me?.id ?? null);
  const manages = ctx.can('policy.manage', 'org');
  const statuses = manages ? await Promise.all(policies.map((p) => getAcknowledgementStatus(p.id))) : [];

  return (
    <>
      <PageHeader title="Policies" description="Company policies. Acknowledging records that you have read the current version." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {policies.length === 0 && <Card><p className="px-5 py-4 text-sm text-muted">No policies published yet.</p></Card>}
          {policies.map((p, i) => {
            const status = statuses[i];
            const acked = status?.filter((s) => s.acknowledged_at).length ?? 0;
            return (
              <div key={p.id} id={`policy-${p.id}`} className="scroll-mt-6"><Card>
                <CardHeader title={p.title} description={`Version ${p.version} · ${formatDate(p.published_at)}`}
                  actions={p.acknowledgedAt ? <Badge tone="success">Acknowledged {formatDate(p.acknowledgedAt)}</Badge> : undefined} />
                <div className="whitespace-pre-line px-5 py-4 text-sm leading-6">{p.body}</div>
                {me && !p.acknowledgedAt && p.requires_acknowledgement && (
                  <div className="border-t border-line px-5 py-3">
                    <ActionForm action={acknowledgePolicyAction.bind(null, slug)} label={`Acknowledge ${p.title}`} submit="I have read and accept this policy"
                      hidden={{ policyId: p.id }} size="sm" className="flex flex-wrap items-center gap-3" />
                  </div>
                )}
                {status && (
                  <details className="border-t border-line px-5 py-3 text-sm">
                    <summary className="cursor-pointer text-muted">{acked} of {status.length} acknowledged</summary>
                    <ul className="mt-2 space-y-1" aria-label={`Acknowledgements for ${p.title}`}>
                      {status.map((s) => (
                        <li key={s.employee_id} className="flex justify-between">
                          <span>{s.employee_name} <span className="text-muted">{s.employee_code}</span></span>
                          <span className="text-muted">{s.acknowledged_at ? formatDate(s.acknowledged_at) : 'Not yet'}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card></div>
            );
          })}
        </div>
        {manages && (
          <Card>
            <CardHeader title="Publish a policy" />
            <PublishPolicyForm action={publishPolicyAction.bind(null, slug)} />
          </Card>
        )}
      </div>
    </>
  );
}
