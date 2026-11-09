import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { STARTER_POLICIES, unfilled } from '@/lib/policy-library';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getAcknowledgementStatus, getPolicies, getPolicyDrafts } from '@/server/onboarding';
import {
  acknowledgePolicyAction, addStarterPoliciesAction, deleteDraftAction, publishDraftAction, publishPolicyAction, saveDraftAction,
} from '../onboarding/actions';
import { PolicyDraftForm, PublishPolicyForm } from '../onboarding/onboarding-forms';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Policies' };

export default async function PoliciesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'policies');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const policies = await getPolicies(ctx.org.id, me?.id ?? null);
  const manages = ctx.can('policy.manage', 'org');
  const [statuses, drafts] = manages
    ? await Promise.all([Promise.all(policies.map((p) => getAcknowledgementStatus(p.id))), getPolicyDrafts(ctx.org.id)])
    : [[], []];
  // Starter policies not yet drafted or published.
  const have = new Set([...policies, ...drafts].map((p) => p.title.toLowerCase()));
  const starters = STARTER_POLICIES.filter((p) => !have.has(p.title.toLowerCase())).length;

  return (
    <>
      <PageHeader title="Policies" description="Company policies. Acknowledging records that you have read the current version." />
      {manages && (
        <section aria-label="Drafts" className="mb-6">
          <Card>
            <CardHeader title={`Drafts${drafts.length ? ` (${drafts.length})` : ''}`}
              description="Only people who manage policies see drafts. Publishing one shows it to everyone and asks them to acknowledge it."
              actions={starters > 0 ? (
                <ActionForm action={addStarterPoliciesAction.bind(null, slug)} label="Add starter policies" submit={`Add ${starters} starter polic${starters === 1 ? 'y' : 'ies'}`}
                  pendingLabel="Adding…" size="sm" variant="secondary" className="flex items-center gap-2" />
              ) : undefined} />
            {drafts.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">
                No drafts. Start one on the right, or add PeopleCore’s starter policies (code of conduct, attendance, leave, POSH, data protection and more) to adapt.
              </p>
            ) : (
              <ul className="divide-y divide-line border-t border-line" aria-label="Policy drafts">
                {drafts.map((d) => {
                  const left = unfilled(d.body);
                  return (
                    <li key={d.id}>
                      <details className="group px-5 py-3">
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{d.title}</span>
                          {d.source === 'starter' && <Badge tone="primary">Starter</Badge>}
                          {left.length > 0 ? <Badge tone="warning">{left.length} part{left.length === 1 ? '' : 's'} to fill in</Badge> : <Badge tone="success">Ready to publish</Badge>}
                          <span className="ml-auto text-xs text-muted">Saved {formatDate(d.updated_at)}</span>
                        </summary>
                        <div className="mt-4 space-y-4">
                          {d.source === 'starter' && (
                            <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
                              A starting point, not legal advice: fill in the parts in [[double brackets]], adapt it to how your company works and check it with your HR or legal adviser before publishing.
                            </p>
                          )}
                          <PolicyDraftForm action={saveDraftAction.bind(null, slug)} draft={{ id: d.id, title: d.title, body: d.body }} />
                          <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
                            <ActionForm action={publishDraftAction.bind(null, slug)} label={`Publish ${d.title}`} submit="Publish" hidden={{ draftId: d.id }}
                              size="sm" pendingLabel="Publishing…" className="flex flex-wrap items-center gap-2" />
                            <ActionForm action={deleteDraftAction.bind(null, slug)} label={`Delete draft ${d.title}`} submit="Delete draft" hidden={{ draftId: d.id }}
                              size="sm" variant="ghost" confirm={`Delete the draft “${d.title}”? This can’t be undone.`} className="flex flex-wrap items-center gap-2" />
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {policies.length === 0 && <Card><p className="px-5 py-4 text-sm text-muted">No policies published yet.{manages ? ' Publish one from your drafts above or write one on the right.' : ''}</p></Card>}
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
          <div className="space-y-6">
            <Card>
              <CardHeader title="Start a draft" description="Saved as a draft: nobody else sees it until you publish it." />
              <div className="px-5 pb-5"><PolicyDraftForm action={saveDraftAction.bind(null, slug)} /></div>
            </Card>
            <Card>
              <CardHeader title="Publish a policy" />
              <PublishPolicyForm action={publishPolicyAction.bind(null, slug)} />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
