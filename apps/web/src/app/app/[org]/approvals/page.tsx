import type { Metadata } from 'next';
import { PERMISSIONS, type PermissionKey } from '@peoplecore/shared';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { humanize } from '@/lib/format';
import { approvalFlows, SUBJECT_LABEL } from '@/server/approvals';
import { requirePermission } from '@/server/context';
import { saveEscalationAction } from './actions';
import { EscalationForm } from './approval-forms';

export const metadata: Metadata = { title: 'Approval rules' };

export default async function ApprovalRulesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'org.manage', 'org');
  const flows = await approvalFlows(ctx.org.id);
  const holders = (key: string | null) => key && key in PERMISSIONS ? `people with “${PERMISSIONS[key as PermissionKey].description}” org-wide` : 'HR';

  return (
    <>
      <PageHeader title="Approval rules" description="Who approves what, and when a request that has waited too long escalates."
        actions={<ButtonLink href={`/app/${slug}/inbox`} variant="ghost">Inbox</ButtonLink>} />
      <div className="space-y-6">
        {flows.map((f) => (
          <Card key={f.id}>
            <CardHeader title={SUBJECT_LABEL[f.subject_type] ?? humanize(f.subject_type)} />
            <ol className="divide-y divide-line" aria-label={SUBJECT_LABEL[f.subject_type] ?? humanize(f.subject_type)}>
              {f.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-end justify-between gap-4 px-5 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">Step {s.step_no}: {s.label}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.approver_rule === 'reporting_manager'
                        ? `The employee’s manager, or someone they delegate to. If it waits too long, the manager’s manager can decide too (without one, ${holders(s.permission_key)}).`
                        : `Decided by ${holders(s.permission_key)}. If it waits too long, they are reminded.`}
                    </p>
                  </div>
                  <EscalationForm action={saveEscalationAction.bind(null, slug)} stepId={s.id} label={`${SUBJECT_LABEL[f.subject_type] ?? f.subject_type} step ${s.step_no}`}
                    hours={s.escalate_after_hours} />
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </>
  );
}
