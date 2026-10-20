import type { Metadata } from 'next';
import Link from 'next/link';
import { HubTabs, Panel, StatCard } from '@/components/ui/hub';
import { Badge, Card, CardHeader } from '@/components/ui/surface';
import { PLAN } from '@/lib/onboarding-plan';
import { formatDate } from '@/lib/format';
import { getOrgContext, requirePermission } from '@/server/context';
import { MyOnboarding } from './my-onboarding';
import { managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { getPlans, getTemplates } from '@/server/onboarding';
import { requireModule } from '@/server/modules';
import { setupChecks } from '@/server/setup';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { activateEmployeesAction, addTemplateTaskAction, cancelOnboardingAction, markSetupStepAction, removeTemplateTaskAction, startOnboardingAction } from './actions';
import { ActivationForm, SmallAction, StartOnboardingForm, TemplateTaskForm } from './onboarding-forms';

export const metadata: Metadata = { title: 'Onboarding' };

const ASSIGNEE = { joiner: 'Joiner', manager: 'Manager', owner: 'Owner' } as const;

type Search = Record<string, string | undefined>;

/**
 * Onboarding (Kredily's company onboarding): a hub with readiness, the company at a glance, activation (inviting
 * employees to sign in), the six-week guided plan, and journeys (new-hire plans and their templates).
 */
export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'onboarding');
  if (!ctx.can('onboarding.manage', 'org')) return <MyOnboarding slug={slug} orgId={ctx.org.id} userId={ctx.user.id} />;
  const base = `/app/${slug}/onboarding`;
  const tabs = [{ key: 'hub', label: '✦ Hub' }, { key: 'company', label: 'Company' }, { key: 'activation', label: 'Activation' }, { key: 'guided', label: 'Guided plan' }, { key: 'journeys', label: 'Journeys' }];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const supabase = await createClient();
  const [checks, done, emps] = await Promise.all([
    setupChecks(ctx.org.id, slug),
    supabase.from('org_setup_steps').select('step_key, done_at').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    supabase.from('employees').select('id, employee_code, first_name, last_name, work_email, user_id, status, department_id, designation_id, location_id').eq('organization_id', ctx.org.id).neq('status', 'exited').order('employee_code').then((r) => r.data ?? []),
  ]);
  const auto = new Map(checks.map((c) => [c.key, c.done]));
  const manual = new Set(done.map((d) => d.step_key));
  const stepDone = (s: { key: string; auto?: string }) => (s.auto ? auto.get(s.auto) ?? false : false) || manual.has(s.key);
  const allSteps = PLAN.flatMap((w) => w.steps);
  const planDone = allSteps.filter(stepDone).length;
  const activated = emps.filter((e) => e.user_id).length;
  const pending = emps.filter((e) => !e.user_id && e.status !== 'pre_joining');
  const app = `/app/${slug}`;

  return (
    <>
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="mt-1 text-sm text-muted">Set up {ctx.org.name}, invite your people, and welcome every new hire.</p></header>
      <HubTabs base={base} label="Onboarding sections" tabs={tabs} current={tab} />
      {tab === 'hub' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Setup ready" value={`${checks.filter((c) => c.done).length}/${checks.length}`} note="readiness checks" tone="primary" href={`${app}/settings?tab=setup`} />
            <StatCard label="Guided plan" value={`${Math.round((planDone / allSteps.length) * 100)}%`} note={`${planDone} of ${allSteps.length} steps`} tone="success" href={`${base}?tab=guided`} />
            <StatCard label="Activated" value={`${activated}/${emps.length}`} note={`${pending.length} still to invite`} tone={pending.length ? 'warning' : 'muted'} href={`${base}?tab=activation`} />
            <StatCard label="New hires onboarding" value="→" note="Journeys in progress" href={`${base}?tab=journeys`} />
          </div>
          <Panel title="Next up">
            <ul className="space-y-2 text-sm" aria-label="Next steps">
              {allSteps.filter((s) => !stepDone(s)).slice(0, 5).map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3"><span><span className="font-medium">{s.title}</span> <span className="text-muted">· {s.note}</span></span>
                  {s.href && <Link className="text-primary hover:underline" href={`${app}/${s.href}`}>Open →</Link>}</li>
              ))}
              {allSteps.every(stepDone) && <li className="text-success">Everything in the plan is done. 🎉</li>}
            </ul>
          </Panel>
        </div>
      )}
      {tab === 'company' && await (async () => {
        const st = await getStructure(ctx.org.id);
        const count = (k: 'department_id' | 'designation_id' | 'location_id', id: string) => emps.filter((e) => e[k] === id).length;
        const block = (title: string, rows: Array<{ id: string; name: string }>, k: 'department_id' | 'designation_id' | 'location_id', href: string) => (
          <Panel title={title} meta={`${rows.length}`} action={<Link className="text-sm text-primary hover:underline" href={href}>Manage →</Link>}>
            {rows.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="space-y-1.5 text-sm" aria-label={title}>{rows.map((r) => <li key={r.id} className="flex justify-between"><span>{r.name}</span><span className="tabular-nums text-muted">{count(k, r.id)}</span></li>)}</ul>
            )}
          </Panel>
        );
        return (
          <div className="grid gap-5 lg:grid-cols-3">
            {block('Departments', st.departments.map((d) => ({ id: d.id, name: d.name })), 'department_id', `${app}/company?tab=departments`)}
            {block('Designations', st.designations.map((d) => ({ id: d.id, name: d.title })), 'designation_id', `${app}/company?tab=designations`)}
            {block('Locations', st.locations.map((l) => ({ id: l.id, name: l.name })), 'location_id', `${app}/company?tab=offices`)}
          </div>
        );
      })()}
      {tab === 'activation' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title="Not yet activated" meta={`${pending.length}`}>
            {pending.length === 0 ? <p className="text-sm text-muted">Everyone has a sign-in. 🎉</p>
              : ctx.can('member.manage', 'org') ? <ActivationForm action={activateEmployeesAction.bind(null, slug)} people={pending.slice(0, 200).map((e) => ({ id: e.id, code: e.employee_code, name: [e.first_name, e.last_name].filter(Boolean).join(' '), email: e.work_email }))} />
              : <p className="text-sm text-muted">Ask someone who manages members to send invitations.</p>}
          </Panel>
          <Panel title="Activation">
            <div className="h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${emps.length ? (activated / emps.length) * 100 : 0}%` }} /></div>
            <p className="mt-2 text-sm">{activated} of {emps.length} employees can sign in.</p>
            <p className="mt-1 text-xs text-muted">Each invitation goes to the employee’s work email. They join with the Employee role, linked to their record. Manage roles on <Link className="text-primary hover:underline" href={`${app}/members`}>Members</Link>.</p>
          </Panel>
        </div>
      )}
      {tab === 'guided' && (
        <div className="space-y-5">
          <Panel title="Six-week implementation plan" meta={`${planDone} of ${allSteps.length} done`}>
            <div className="h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-primary" style={{ width: `${(planDone / allSteps.length) * 100}%` }} /></div>
          </Panel>
          <div className="grid gap-5 lg:grid-cols-2">
            {PLAN.map((w) => (
              <Panel key={w.week} title={`Week ${w.week} · ${w.title}`} flush>
                <ul className="divide-y divide-line" aria-label={`Week ${w.week}`}>
                  {w.steps.map((s) => {
                    const ok = stepDone(s);
                    const byData = s.auto && auto.get(s.auto);
                    return (
                      <li key={s.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                        <span className="flex items-center gap-3"><span aria-hidden className={`grid size-6 place-items-center rounded-full text-xs ${ok ? 'bg-success-soft text-success' : 'bg-subtle text-muted'}`}>{ok ? '✓' : w.week}</span>
                          <span><span className="block font-medium">{s.title}</span><span className="block text-xs text-muted">{s.note}{byData ? ' · confirmed from your data' : ''}</span></span></span>
                        <span className="flex shrink-0 items-center gap-2">
                          {s.href && <Link className="text-primary hover:underline" href={`${app}/${s.href}`}>Open</Link>}
                          {!byData && <SmallAction action={markSetupStepAction.bind(null, slug)} label={`${manual.has(s.key) ? 'Undo' : 'Mark done'}: ${s.title}`} submit={manual.has(s.key) ? 'Undo' : 'Mark done'} hidden={{ step: s.key, done: manual.has(s.key) ? 'no' : 'yes' }} />}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))}
          </div>
        </div>
      )}
      {tab === 'journeys' && <Journeys slug={slug} />}
    </>
  );
}

async function Journeys({ slug }: { slug: string }) {
  const ctx = await requirePermission(slug, 'onboarding.manage', 'org');
  const [plans, templates, employees] = await Promise.all([getPlans(ctx.org.id), getTemplates(ctx.org.id), managerOptions(ctx.org.id)]);
  const names = await namesFor(ctx.org.id, [...plans.map((p) => p.employee_id), ...plans.flatMap((p) => p.tasks.map((t) => t.assignee_employee_id))]);
  const active = plans.filter((p) => p.status === 'in_progress');
  const finished = plans.filter((p) => p.status !== 'in_progress').slice(0, 10);

  return (
    <>
      <p className="mb-4 text-sm text-muted">Plans start automatically for every hire. Tasks land in each person’s Inbox; a plan completes when its tasks are done.</p>
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
