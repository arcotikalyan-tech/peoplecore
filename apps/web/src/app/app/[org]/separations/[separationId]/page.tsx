import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { colleagueNames } from '@/server/engagement';
import { employeeNames, getMyEmployee } from '@/server/employees';
import { clearanceItems, getSeparation, separationDetails } from '@/server/separations';
import { clearItemAction, exitInterviewAction, rehireAction, setTermsAction, withdrawAction } from '../actions';
import { OWNER_LABEL, REASONS, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from '../labels';
import { ExitInterviewForm, RehireForm, TermsForm, WaiveForm } from '../separation-forms';

export const metadata: Metadata = { title: 'Separation' };

export default async function SeparationPage({ params }: { params: Promise<{ org: string; separationId: string }> }) {
  const { org: slug, separationId } = await params;
  const ctx = await getOrgContext(slug);
  const s = /^[0-9a-f-]{36}$/i.test(separationId) ? await getSeparation(ctx.org.id, separationId) : null;
  if (!s) notFound();
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const self = me?.id === s.employee_id;
  const hr = ctx.can('separation.manage', 'org');
  const [items, details, names, colleagues] = await Promise.all([
    clearanceItems(ctx.org.id, [s.id]),
    self || hr ? separationDetails(s.id) : Promise.resolve(null),
    employeeNames(ctx.org.id, [s.employee_id]),
    colleagueNames(ctx.org.id),
  ]);
  const name = self ? 'You' : (names.get(s.employee_id) ?? colleagues.get(s.employee_id) ?? 'Employee');
  const today = todayIn(ctx.org.timezone);
  const inProgress = s.status === 'approved';
  // Who can act on an item, mirroring app.can_clear (the database decides regardless).
  const canAct = (owner: string) => !self && (hr || (owner === 'manager' && ctx.can('employee.read', 'team'))
    || (owner === 'it' && ctx.can('asset.manage', 'org')) || (owner === 'finance' && (ctx.can('payroll.prepare', 'org') || ctx.can('expense.manage', 'org'))));
  const reason = REASONS.find((r) => r.value === s.reason_category)?.label;
  const interview = details?.exit_interview as Record<string, unknown> | null | undefined;

  return (
    <>
      <PageHeader eyebrow={TYPE_LABEL[s.type]} title={self ? 'Your separation' : name}
        actions={<>
          <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
          <ButtonLink href={`/app/${slug}/separations`} variant="ghost">All separations</ButtonLink>
        </>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Dates" />
            <div className="px-5 py-4">
              <DetailList items={[
                { label: 'Submitted', value: formatDate(s.submitted_on) },
                { label: 'Asked to leave on', value: formatDate(s.requested_last_day) },
                { label: 'Notice period', value: `${s.notice_days} days, ending ${formatDate(s.notice_end)}` },
                { label: 'Last working day', value: formatDate(s.last_working_day) },
                { label: 'Notice shortfall', value: s.shortfall_days
                  ? `${s.shortfall_days} days · ${s.shortfall_treatment === 'waived' ? 'waived' : s.shortfall_treatment === 'recovered' ? 'recovered in the settlement' : 'to be decided'}`
                  : 'None' },
                ...(details ? [{ label: 'Reason', value: [reason, details.reason].filter(Boolean).join(' · ') || 'Not given' }] : []),
                ...(s.status === 'completed' && hr ? [{ label: 'Eligible for rehire', value: s.rehire_eligible == null ? 'Not decided' : s.rehire_eligible ? 'Yes' : 'No' }] : []),
              ]} />
            </div>
            {self && s.status === 'submitted' && s.type === 'resignation' && (
              <ActionForm action={withdrawAction.bind(null, slug)} label="Withdraw resignation" submit="Withdraw resignation" hidden={{ separationId: s.id }}
                variant="secondary" className="flex items-center gap-3 border-t border-line px-5 py-3" />
            )}
          </Card>

          {items.length > 0 && (
            <Card>
              <CardHeader title="Clearance" description={`${items.filter((i) => i.status !== 'pending').length} of ${items.length} done`} />
              <ul className="divide-y divide-line" aria-label="Clearance">
                {items.map((i) => (
                  <li key={i.id} className="space-y-2 px-5 py-3 text-sm" aria-label={i.title}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><span className="font-medium">{i.title}</span> <span className="text-xs text-muted">· {OWNER_LABEL[i.owner]}</span></span>
                      {i.status === 'pending' ? <Badge tone="warning">To do</Badge> : <Badge tone={i.status === 'cleared' ? 'success' : 'neutral'}>{i.status === 'cleared' ? 'Done' : 'Waived'}</Badge>}
                    </div>
                    {i.note && <p className="text-xs text-muted">{i.note}</p>}
                    {i.status === 'pending' && inProgress && canAct(i.owner) && (
                      <div className="flex flex-wrap items-end gap-3">
                        {i.kind === 'asset' && <Link className="text-sm text-primary hover:underline" href={`/app/${slug}/assets`}>Record the return</Link>}
                        {i.kind === 'access' && <Link className="text-sm text-primary hover:underline" href={`/app/${slug}/assets/access`}>Revoke the access</Link>}
                        {(i.kind === 'handover' || i.kind === 'finance') && (
                          <ActionForm action={clearItemAction.bind(null, slug)} label={`Clear ${i.title}`} submit="Mark done" size="sm"
                            hidden={{ itemId: i.id, status: 'cleared' }} className="inline-flex items-center gap-2" />
                        )}
                        {(hr || i.kind === 'asset' || i.kind === 'access') && <WaiveForm action={clearItemAction.bind(null, slug)} itemId={i.id} title={i.title} />}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {interview && hr && (
            <Card>
              <CardHeader title="Exit interview" description="Only HR sees this." />
              <div className="px-5 py-4">
                <DetailList items={[
                  { label: 'Would recommend', value: `${String(interview.recommend ?? '—')} of 5` },
                  { label: 'Would come back', value: String(interview.wouldReturn ?? 'Not said') },
                  { label: 'Do better', value: String(interview.improve ?? '—') },
                  { label: 'Valued', value: String(interview.liked ?? '—') },
                  { label: 'Alumni network', value: s.alumni_opt_in ? 'Opted in' : 'No' },
                ]} />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {hr && !self && (s.status === 'submitted' || s.status === 'approved') && (
            <Card>
              <CardHeader title="Terms" description="The last working day, and what happens to a notice shortfall." />
              <TermsForm action={setTermsAction.bind(null, slug)} separationId={s.id} lastDay={s.last_working_day} treatment={s.shortfall_treatment}
                shortfall={s.shortfall_days} today={today} />
              <ActionForm action={withdrawAction.bind(null, slug)} label="Cancel separation" submit="Cancel separation" hidden={{ separationId: s.id }}
                variant="ghost" className="flex items-center gap-3 border-t border-line px-5 py-3" />
            </Card>
          )}
          {self && inProgress && !interview && (
            <Card>
              <CardHeader title="Exit interview" description="A few questions before you go. Your manager won’t see your answers." />
              <ExitInterviewForm action={exitInterviewAction.bind(null, slug)} separationId={s.id} />
            </Card>
          )}
          {hr && s.status === 'completed' && (
            <Card>
              <CardHeader title="Rehire" />
              <RehireForm action={rehireAction.bind(null, slug)} separationId={s.id} eligible={s.rehire_eligible} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
