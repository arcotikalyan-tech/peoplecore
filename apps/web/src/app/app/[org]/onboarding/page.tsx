import type { Metadata } from 'next';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { getPlans, getTemplates } from '@/server/onboarding';
import { addTemplateTaskAction, cancelOnboardingAction, removeTemplateTaskAction, startOnboardingAction } from './actions';
import { SmallAction, StartOnboardingForm, TemplateTaskForm } from './onboarding-forms';

export const metadata: Metadata = { title: 'Onboarding' };

const ASSIGNEE = { joiner: 'Joiner', manager: 'Manager', owner: 'Owner' } as const;

export default async function OnboardingPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'onboarding.manage', 'org');
  const [plans, templates, employees] = await Promise.all([getPlans(ctx.org.id), getTemplates(ctx.org.id), managerOptions(ctx.org.id)]);
  const names = await namesFor(ctx.org.id, [...plans.map((p) => p.employee_id), ...plans.flatMap((p) => p.tasks.map((t) => t.assignee_employee_id))]);
  const active = plans.filter((p) => p.status === 'in_progress');
  const finished = plans.filter((p) => p.status !== 'in_progress').slice(0, 10);

  return (
    <>
      <PageHeader title="Onboarding" description="Plans start automatically for every hire. Tasks land in each person’s Inbox; a plan completes when its tasks are done." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="In progress" description={`${active.length}`} />
            {active.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nobody is onboarding right now.</p> : (
              <ul className="divide-y divide-line" aria-label="Onboarding in progress">
                {active.map((p) => (
                  <li key={p.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{names.get(p.employee_id) ?? 'Employee'}</p>
                      <span className="text-sm tabular-nums text-muted">{p.done}/{p.tasks.length} done</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-subtle" aria-hidden="true">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${p.tasks.length ? Math.round((p.done / p.tasks.length) * 100) : 0}%` }} />
                    </div>
                    <ul className="space-y-1 text-sm">
                      {p.tasks.map((t) => (
                        <li key={t.id} className="flex justify-between gap-2">
                          <span className={t.status === 'open' ? '' : 'text-muted line-through'}>{t.title}</span>
                          <span className="shrink-0 text-xs text-muted">{names.get(t.assignee_employee_id) ?? ''}{t.due_on ? ` · ${formatDate(t.due_on)}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                    <SmallAction action={cancelOnboardingAction.bind(null, slug)} label={`Cancel onboarding for ${names.get(p.employee_id) ?? ''}`} submit="Cancel onboarding" hidden={{ planId: p.id }} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {finished.length > 0 && (
            <Card>
              <CardHeader title="Recently finished" />
              <ul className="divide-y divide-line text-sm">
                {finished.map((p) => (
                  <li key={p.id} className="flex justify-between px-5 py-2.5">
                    <span>{names.get(p.employee_id) ?? 'Employee'}</span>
                    <span className="flex items-center gap-2 text-muted">{p.completed_at ? formatDate(p.completed_at) : ''} <Badge tone={p.status === 'completed' ? 'success' : 'neutral'}>{p.status === 'completed' ? 'Completed' : 'Cancelled'}</Badge></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Start onboarding" description="For people added without a hire, or a second plan after a cancellation." />
            <StartOnboardingForm action={startOnboardingAction.bind(null, slug)} employees={employees}
              templates={templates.filter((t) => t.is_active).map((t) => ({ value: t.id, label: t.name + (t.is_default ? ' (default)' : '') }))} />
          </Card>
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader title={t.name} description={t.is_default ? 'Default template' : undefined} />
              <ul className="divide-y divide-line text-sm" aria-label={`Tasks in ${t.name}`}>
                {t.tasks.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 px-5 py-2">
                    <span>{x.title} <span className="text-xs text-muted">· {ASSIGNEE[x.assignee]} · day {x.due_offset_days >= 0 ? `+${x.due_offset_days}` : x.due_offset_days}</span></span>
                    <SmallAction action={removeTemplateTaskAction.bind(null, slug)} label={`Remove ${x.title}`} submit="Remove" hidden={{ taskId: x.id }} />
                  </li>
                ))}
              </ul>
              <TemplateTaskForm action={addTemplateTaskAction.bind(null, slug)} templateId={t.id} />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
