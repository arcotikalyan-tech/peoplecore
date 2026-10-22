import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { POSH_ACTIONS, poshTimeline, type StepState } from '@/lib/posh';
import { getOrgContext } from '@/server/context';
import { colleagueOptions } from '@/server/engagement';
import { getGrievance, grievancePeople, grievanceThread, investigatorOptions, poshSteps } from '@/server/grievances';
import {
  addInvestigatorAction, addRespondentAction, grievanceMessageAction, recordPoshStepAction, removeInvestigatorAction, updateGrievanceAction, withdrawGrievanceAction,
} from '../actions';
import { AddPersonForm, GrievanceMessageForm, PoshStepForm, UpdateGrievanceForm, WithdrawGrievanceForm } from '../grievance-forms';
import { CATEGORY_LABEL, OPEN_STATUSES, STATUS_LABEL, STATUS_TONE } from '../labels';

export const metadata: Metadata = { title: 'Grievance' };

const STATE: Record<StepState, { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'primary'; label: (due: string | null, done: string | null) => string }> = {
  done: { tone: 'success', label: (_, done) => (done ? `Done ${formatDate(done)}` : 'Done') },
  late: { tone: 'danger', label: () => 'Late' },
  overdue: { tone: 'danger', label: (due) => `Overdue since ${formatDate(due)}` },
  due_soon: { tone: 'warning', label: (due) => `Due ${formatDate(due)}` },
  open: { tone: 'primary', label: (due) => (due ? `Due ${formatDate(due)}` : 'Not yet due') },
  optional: { tone: 'neutral', label: () => 'If asked for' },
  not_needed: { tone: 'neutral', label: () => 'Not needed' },
};

export default async function GrievancePage({ params }: { params: Promise<{ org: string; caseId: string }> }) {
  const { org: slug, caseId } = await params;
  const ctx = await getOrgContext(slug);
  // Opening a case as a handler is recorded in the audit log (grievance_case).
  const g = /^[0-9a-f-]{36}$/i.test(caseId) ? await getGrievance(caseId) : null;
  if (!g) notFound();
  const handler = g.my_role === 'manager' || g.my_role === 'investigator';
  const manager = g.my_role === 'manager';
  const open = OPEN_STATUSES.includes(g.status) || g.status === 'resolved';
  const posh = g.category === 'posh' && handler;
  const [thread, people, investigators, colleagues, steps] = await Promise.all([
    grievanceThread(g.id),
    grievancePeople(g.id),
    manager && open ? investigatorOptions(ctx.org.id) : Promise.resolve([]),
    manager && open ? colleagueOptions(ctx.org.id) : Promise.resolve([]),
    posh ? poshSteps(g.id) : Promise.resolve(null),
  ]);
  const named = people.filter((p) => p.kind === 'named');
  const team = people.filter((p) => p.kind === 'investigator');
  const onCase = new Set([...team.map((p) => p.user_id), ...named.map((p) => p.user_id)]);
  const namedIds = new Set(named.map((p) => p.employee_id));
  const tz = ctx.org.timezone;
  const today = todayIn(tz);
  const timeline = posh ? poshTimeline({ filedOn: todayIn(tz, new Date(g.created_at)), incidentOn: g.incident_on, steps, today }) : [];
  const editable = g.status !== 'withdrawn';

  return (
    <>
      <PageHeader eyebrow={`Case #${g.number} · ${CATEGORY_LABEL[g.category]}`} title={g.subject}
        actions={<Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="What happened" description={handler ? 'Confidential. Your reading of this case is recorded in the audit log.' : undefined} />
            <div className="whitespace-pre-line px-5 py-4 text-sm leading-6">{g.description}</div>
            <div className="border-t border-line px-5 py-4">
              <DetailList items={[
                ...(handler ? [{ label: 'Raised by', value: g.reporter_name }] : []),
                { label: 'Raised on', value: formatDate(g.created_at) },
                { label: 'When it happened', value: g.incident_on ? formatDate(g.incident_on) : 'Not given' },
                { label: 'People named', value: named.length ? named.map((p) => p.name).join(', ') : 'No one' },
              ]} />
            </div>
          </Card>
          {posh && (
            <Card>
              <CardHeader title="POSH timeline" description="What the Act and its Rules ask for, and when. Record each step as it happens; reasons and documents go in internal notes." />
              <ol className="divide-y divide-line" aria-label="POSH timeline">
                {timeline.map((r) => (
                  <li key={r.key} className="space-y-2 px-5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{r.label}{r.key === 'action_taken' && steps?.action_kind && <span className="font-normal text-muted"> · {POSH_ACTIONS[steps.action_kind]}</span>}</p>
                        <p className="text-xs text-muted">{r.rule}</p>
                      </div>
                      <Badge tone={STATE[r.state].tone}>{r.key === 'filing' && r.state === 'late' ? 'Past the time limit' : STATE[r.state].label(r.due, r.done)}</Badge>
                    </div>
                    {editable && r.step && r.state !== 'not_needed' && (r.key !== 'filing' || r.state === 'late' || steps?.filing_extended_on) && (
                      <div className="flex flex-wrap items-end gap-2">
                        <PoshStepForm action={recordPoshStepAction.bind(null, slug)} caseId={g.id} step={r.step} today={today}
                          label={r.key === 'filing' ? 'Time limit extended' : r.label} done={r.key === 'filing' ? steps?.filing_extended_on ?? null : r.done} />
                        {(r.key === 'filing' ? steps?.filing_extended_on : r.done) && (
                          <ActionForm action={recordPoshStepAction.bind(null, slug)} label={`Clear: ${r.label}`} submit="Clear" hidden={{ caseId: g.id, step: r.step, clear: 'yes' }}
                            variant="ghost" size="sm" className="inline-flex items-center gap-2" />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {g.outcome && (
            <Card>
              <CardHeader title="Outcome" description={g.resolved_at ? `Resolved ${formatDate(g.resolved_at)}` : undefined} />
              <div className="whitespace-pre-line px-5 py-4 text-sm leading-6">{g.outcome}</div>
            </Card>
          )}
          <Card>
            <CardHeader title="Messages" />
            {thread.length === 0 && <p className="px-5 py-4 text-sm text-muted">No messages yet.</p>}
            <ol className="divide-y divide-line" aria-label="Messages">
              {thread.map((m) => (
                <li key={m.id} className={m.internal ? 'bg-warning-soft px-5 py-3 text-sm' : 'px-5 py-3 text-sm'}>
                  <p className="text-xs text-muted">
                    <span className="font-medium text-fg">{m.mine ? 'You' : m.author_name}</span> · {formatDateTime(m.created_at, tz)}
                    {m.internal && <> · <span className="font-medium text-warning">Internal note</span></>}
                  </p>
                  <p className="mt-1 whitespace-pre-line">{m.body}</p>
                </li>
              ))}
            </ol>
            {g.status === 'closed' || g.status === 'withdrawn'
              ? <p className="border-t border-line px-5 py-4 text-sm text-muted">This case is closed.</p>
              : <GrievanceMessageForm action={grievanceMessageAction.bind(null, slug)} caseId={g.id} handler={handler} />}
          </Card>
        </div>

        <div className="space-y-6">
          {handler && open && (
            <Card>
              <CardHeader title="Update" />
              <UpdateGrievanceForm action={updateGrievanceAction.bind(null, slug)} caseId={g.id} status={g.status} outcome={g.outcome} />
            </Card>
          )}
          {handler && (
            <Card>
              <CardHeader title="Investigators" description="Case managers see every case that doesn’t name them. Investigators see only the cases they are added to." />
              {team.length === 0 ? <p className="px-5 py-3 text-sm text-muted">No one added yet.</p> : (
                <ul className="divide-y divide-line" aria-label="Investigators">
                  {team.map((p) => (
                    <li key={p.user_id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                      <span>{p.name}</span>
                      {manager && (
                        <ActionForm action={removeInvestigatorAction.bind(null, slug)} label={`Remove ${p.name}`} submit="Remove"
                          hidden={{ caseId: g.id, userId: p.user_id }} variant="ghost" size="sm" className="inline-flex items-center gap-2" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {manager && open && (
                <AddPersonForm action={addInvestigatorAction.bind(null, slug)} caseId={g.id} name="userId" label="Add an investigator" submit="Add"
                  placeholder="Choose…" options={investigators.filter((o) => !onCase.has(o.user_id) && o.user_id !== ctx.user.id).map((o) => ({ value: o.user_id, label: o.name }))} />
              )}
              {manager && open && (
                <AddPersonForm action={addRespondentAction.bind(null, slug)} caseId={g.id} name="employeeId" label="Name someone involved" submit="Name"
                  placeholder="Choose…" options={colleagues.filter((o) => !namedIds.has(o.value) && o.value !== g.reporter_id)} />
              )}
            </Card>
          )}
          {g.my_role === 'reporter' && OPEN_STATUSES.includes(g.status) && (
            <Card>
              <CardHeader title="Withdraw" description="If it has been sorted out, you can withdraw the concern. The people handling it are told." />
              <WithdrawGrievanceForm action={withdrawGrievanceAction.bind(null, slug)} caseId={g.id} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
