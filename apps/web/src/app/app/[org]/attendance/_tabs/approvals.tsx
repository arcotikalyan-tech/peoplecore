import { ATTENDANCE_REQUEST_LABELS, LEAVE_STATUS_LABELS } from '@peoplecore/shared';
import { Panel, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { getOpenAnomalies } from '@/server/attendance';
import { attendanceRequests } from '@/server/attendance-ops';
import { getInbox } from '@/server/inbox';
import { namesFor } from '@/server/leave';
import { createClient } from '@/server/supabase';
import { decideApprovalAction } from '../../inbox/actions';
import { ApprovalsPanel } from '../../inbox/inbox-forms';
import { reviewAnomalyAction } from '../actions';
import { ReviewAnomaly } from '../attendance-forms';

const ATTENDANCE_SUBJECTS = new Set(['regularization', 'attendance_request']);

export async function ApprovalsTab({ ctx, slug, orgBase, base, view, myEmployeeId }: {
  ctx: OrgContext; slug: string; orgBase: string; base: string; view: string; myEmployeeId: string | null;
}) {
  const open = view !== 'resolved';
  const reviews = ctx.can('attendance.manage', 'org') || ctx.can('attendance.approve');
  const [inbox, anomalies] = await Promise.all([getInbox(ctx.org.id, myEmployeeId), reviews ? getOpenAnomalies(ctx.org.id) : Promise.resolve([])]);
  const mine = inbox.approvals.filter((a) => ATTENDANCE_SUBJECTS.has(a.subject_type));

  return (
    <>
      <SubTabs base={base} label="Approvals" current={open ? 'open' : 'resolved'} extra={{ tab: 'approvals' }}
        tabs={[{ key: 'open', label: 'Open', count: mine.length + anomalies.length }, { key: 'resolved', label: 'Resolved' }]} />
      {open ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Waiting for your decision" meta={`${mine.length}`} flush>
            <ApprovalsPanel action={decideApprovalAction.bind(null, slug)} items={mine.map((a) => ({
              id: a.id, summary: a.summary, href: a.link ? `${orgBase}${a.link}` : null, stepLabel: a.step_label,
              meta: `${humanize(a.subject_type)} · from ${a.requested_by_name} · ${formatDateTime(a.created_at, ctx.org.timezone)}`,
              onBehalfOf: a.via === 'delegation' ? (a.on_behalf_of_name ?? 'a colleague') : null, escalated: a.escalated,
            }))} />
          </Panel>
          {reviews && <Anomalies ctx={ctx} slug={slug} anomalies={anomalies} myEmployeeId={myEmployeeId} />}
        </div>
      ) : (
        <Resolved ctx={ctx} />
      )}
    </>
  );
}

async function Anomalies({ ctx, slug, anomalies, myEmployeeId }: { ctx: OrgContext; slug: string; anomalies: Awaited<ReturnType<typeof getOpenAnomalies>>; myEmployeeId: string | null }) {
  const names = await namesFor(ctx.org.id, anomalies.map((a) => a.employee_id));
  return (
    <Panel title="Anomalies to review" meta={`${anomalies.length}`} flush>
      <p className="px-5 pb-2 text-sm text-muted">Flags are evidence to check, never proof on their own.</p>
      {anomalies.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing flagged.</p> : (
        <ul className="divide-y divide-line" aria-label="Anomalies">
          {anomalies.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{names.get(a.employee_id) ?? '—'} <Badge tone="warning">{humanize(a.rule)}</Badge></p>
                <p className="text-muted">{a.explanation}</p>
              </div>
              {a.employee_id !== myEmployeeId && (
                <ReviewAnomaly action={reviewAnomalyAction.bind(null, slug)} flagId={a.id} label={`${names.get(a.employee_id) ?? ''} ${humanize(a.rule)}`} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function Resolved({ ctx }: { ctx: OrgContext }) {
  const supabase = await createClient();
  const [regs, requests] = await Promise.all([
    supabase.from('regularization_requests').select('id, employee_id, work_date, check_in, check_out, reason, status, decided_at')
      .eq('organization_id', ctx.org.id).neq('status', 'pending').order('decided_at', { ascending: false, nullsFirst: false }).limit(100),
    attendanceRequests(ctx.org.id, {}),
  ]);
  const decided = requests.filter((r) => r.status !== 'pending');
  const names = await namesFor(ctx.org.id, [...(regs.data ?? []).map((r) => r.employee_id), ...decided.map((r) => r.employee_id)]);
  const tone = (s: string) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'neutral') as 'success' | 'danger' | 'neutral';
  return (
    <div className="space-y-5">
      <Panel title="Regularizations" meta="decided" flush>
        <Table caption="Decided regularizations">
          <thead><tr><Th>Employee</Th><Th>Day</Th><Th>Times</Th><Th>Reason</Th><Th>Outcome</Th></tr></thead>
          <tbody>
            {(regs.data ?? []).map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
                <Td>{formatDate(r.work_date)}</Td>
                <Td className="tabular-nums">{[r.check_in?.slice(0, 5), r.check_out?.slice(0, 5)].filter(Boolean).join(' – ')}</Td>
                <Td className="max-w-xs truncate text-muted">{r.reason}</Td>
                <Td><Badge tone={tone(r.status)}>{LEAVE_STATUS_LABELS[r.status]}</Badge></Td>
              </tr>
            ))}
            {(regs.data ?? []).length === 0 && <tr><Td className="py-6 text-center text-muted">Nothing decided yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Work from home and on duty" meta="decided" flush>
        <Table caption="Decided requests">
          <thead><tr><Th>Employee</Th><Th>Type</Th><Th>Dates</Th><Th>Reason</Th><Th>Outcome</Th></tr></thead>
          <tbody>
            {decided.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
                <Td>{ATTENDANCE_REQUEST_LABELS[r.kind]}</Td>
                <Td>{r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`}</Td>
                <Td className="max-w-xs truncate text-muted">{r.reason}</Td>
                <Td><Badge tone={tone(r.status)}>{LEAVE_STATUS_LABELS[r.status]}</Badge></Td>
              </tr>
            ))}
            {decided.length === 0 && <tr><Td className="py-6 text-center text-muted">Nothing decided yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
