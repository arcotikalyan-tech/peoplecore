import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addMonths, todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { Alert, Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { COMMITTEE_ROLES, committeeGaps, POSH_ACTIONS } from '@/lib/posh';
import { getOrgContext } from '@/server/context';
import { colleagueOptions } from '@/server/engagement';
import { poshAnnualReport, poshRegister, poshSessions } from '@/server/grievances';
import { requireModule } from '@/server/modules';
import { addCommitteeMemberAction, addPoshSessionAction, deletePoshSessionAction, endCommitteeTermAction } from '../actions';
import { CommitteeMemberForm, PoshSessionForm } from '../grievance-forms';

export const metadata: Metadata = { title: 'POSH' };

/**
 * POSH for case managers: the Internal Committee register with the make-up the law asks for (section 4), awareness
 * sessions, and the figures for the committee's annual report (section 21, rule 14). Cases themselves stay on the
 * grievances list, handled by the committee.
 */
export default async function PoshPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'grievances');
  if (!ctx.can('grievance.manage', 'org')) notFound();
  const today = todayIn(ctx.org.timezone);
  const thisYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(sp.year ?? '') && Number(sp.year) >= 2013 && Number(sp.year) <= thisYear ? Number(sp.year) : thisYear - (today.slice(5) < '04-01' ? 1 : 0);
  const [register, sessions, report, people] = await Promise.all([poshRegister(ctx.org.id), poshSessions(ctx.org.id), poshAnnualReport(ctx.org.id, year), colleagueOptions(ctx.org.id)]);
  const name = new Map(people.map((p) => [p.value, p.label.split(' · ')[0]!]));
  const gaps = committeeGaps(register, today);
  const base = `/app/${slug}/grievances`;
  const serving = (m: { term_from: string; term_until: string }) => m.term_from <= today && today <= m.term_until;

  return (
    <>
      <PageHeader eyebrow={<Link href={base} className="hover:text-fg">← Grievances</Link>} title="POSH"
        description="The Internal Committee for sexual harassment complaints, awareness sessions and the committee’s annual report. Committee members handle POSH cases from the grievances list." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Internal Committee" description="Section 4: a woman presiding officer, at least two members from the staff and one external member; at least half women; terms of up to three years." />
          <div className="space-y-2 px-5 pt-4">
            {gaps.length === 0
              ? <Alert tone="success" title="The committee has the make-up the law asks for." />
              : gaps.map((g) => <Alert key={g} tone="warning" title={g} />)}
          </div>
          <Table caption="Committee members">
            <thead><tr><Th>Role</Th><Th>Name</Th><Th>Woman</Th><Th>Term</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {register.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">No members yet.</td></tr>}
              {register.map((m) => {
                const who = m.external_name ?? name.get(m.employee_id ?? '') ?? 'Former employee';
                return (
                  <tr key={m.id}>
                    <Td>{COMMITTEE_ROLES[m.role] ?? m.role}</Td>
                    <Td className="font-medium">{who}{m.external_org && <span className="block text-xs font-normal text-muted">{m.external_org}</span>}</Td>
                    <Td>{m.woman ? 'Yes' : 'No'}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(m.term_from)} – {formatDate(m.term_until)}</Td>
                    <Td><Badge tone={serving(m) ? 'success' : m.term_from > today ? 'primary' : 'neutral'}>{serving(m) ? 'Serving' : m.term_from > today ? 'Starts later' : 'Term over'}</Badge></Td>
                    <Td className="text-right">{m.term_until >= today && (
                      <ActionForm action={endCommitteeTermAction.bind(null, slug)} label={`End the term of ${who}`} submit="End term" hidden={{ memberId: m.id }}
                        variant="ghost" size="sm" className="inline-flex items-center gap-2" />
                    )}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="border-t border-line">
            <CommitteeMemberForm action={addCommitteeMemberAction.bind(null, slug)} employees={people} today={today} termUntil={addMonths(today, 36)} />
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Awareness sessions" description="Section 19: workshops for employees and orientation for the committee, held regularly." />
            {sessions.length === 0 ? <p className="px-5 py-4 text-sm text-muted">None recorded yet.</p> : (
              <ul className="divide-y divide-line" aria-label="Awareness sessions">
                {sessions.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
                    <span><span className="font-medium">{x.title}</span>
                      <span className="block text-xs text-muted">{formatDate(x.held_on)} · {x.audience === 'committee' ? 'Committee orientation' : 'Employees'}{x.attendees != null ? ` · ${x.attendees} attended` : ''}</span></span>
                    <ActionForm action={deletePoshSessionAction.bind(null, slug)} label={`Remove ${x.title}`} submit="Remove" hidden={{ sessionId: x.id }} variant="ghost" size="sm"
                      className="inline-flex items-center gap-2" />
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line"><PoshSessionForm action={addPoshSessionAction.bind(null, slug)} today={today} /></div>
          </Card>

          <Card>
            <CardHeader title={`Annual report ${year}`} description="Section 21 and rule 14: the committee reports each calendar year to the employer and the District Officer; companies include it in their annual report." />
            <form method="get" action={`${base}/posh`} className="flex items-end gap-2 px-5 pt-4" aria-label="Choose the year">
              <select name="year" defaultValue={year} aria-label="Year" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
                {Array.from({ length: Math.min(8, thisYear - 2012) }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-subtle">Show</button>
            </form>
            <DetailList items={[
              { label: 'Complaints received', value: report.received },
              { label: 'Complaints disposed of', value: report.disposed },
              { label: 'Pending for more than 90 days', value: report.pending_over_90_days },
              { label: 'Awareness workshops', value: report.workshops },
              { label: 'Committee orientation sessions', value: report.committee_sessions },
              { label: 'Action taken', value: Object.keys(report.actions).length
                ? Object.entries(report.actions).map(([k, n]) => `${POSH_ACTIONS[k] ?? k}: ${n}`).join(', ') : 'None recorded' },
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}
