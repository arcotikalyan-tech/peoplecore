import { teamCounts, teamRow, type Desks, type TeamGroup, type TeamRow, type TeamTone } from '@peoplecore/shared/desks';
import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { Stat } from '@/components/quick-actions';
import { clock, duration, inr, monthYear } from '@/lib/format';
import type { OrgToday } from '@/lib/org-today';
import { SITE_URL } from '@/lib/site';
import { Avatar, Banner, Card, EmptyState, ListGroup, ListRow, Pill, SectionHeader, type IconName, type Tone } from '@/ui';

/**
 * The role desks on the phone (the website's dashboard has the full ones): a manager's team today on Home and on the
 * My team screen, the whole organization today for owners and HR (Home and Everyone today), and for HR, payroll,
 * finance, recruiters, auditors and device admins what is waiting for them, each line opening the website page where
 * it is done.
 */

export const TEAM_TONE: Record<TeamTone, Tone> = { success: 'success', warning: 'warning', danger: 'danger', primary: 'info', neutral: 'neutral', ai: 'accent' };
const ORDER: Record<TeamGroup, number> = { not_in: 0, absent: 1, in: 2, out: 3, away: 4, leave: 5, off: 6 };

/** The team today, people who need a look first: not checked in, then late, then the rest by name. */
export function teamToday(team: NonNullable<Desks['team']>, now: Date): TeamRow[] {
  return team.members.map((m) => teamRow(m, now))
    .sort((a, b) => ORDER[a.group] - ORDER[b.group] || b.member.late - a.member.late || a.member.name.localeCompare(b.member.name));
}

/** "In 09:40 am · late 10m · at work 3h 05m" or the person's title when they haven't checked in. */
export function teamLine(r: TeamRow, tz: string): string {
  const m = r.member;
  if (!m.first_in) return [m.title, !m.direct && 'Indirect report'].filter(Boolean).join(' · ');
  return [
    `In ${clock(m.first_in, tz)}`, r.group === 'out' && m.last_out && `out ${clock(m.last_out, tz)}`,
    m.late > 0 && `late ${duration(m.late)}`, `at work ${duration(r.atWork)}`, r.breaks > 0 && `breaks ${duration(r.breaks)}`,
  ].filter(Boolean).join(' · ');
}

export function TeamFigures({ rows }: { rows: TeamRow[] }) {
  const c = teamCounts(rows);
  return (
    <Card padded={false} style={{ flexDirection: 'row', paddingVertical: 8 }}>
      <Stat label="Checked in" value={c.in} tone="success" />
      <Stat label="On leave" value={c.leave} tone="info" />
      <Stat label="Not in" value={c.notIn} tone="warning" />
      <Stat label="Late" value={c.late} tone="danger" />
    </Card>
  );
}

export function TeamPersonRow({ row, tz }: { row: TeamRow; tz: string }) {
  return (
    <ListRow leading={<Avatar name={row.member.name} size={34} />} title={row.member.name} subtitle={teamLine(row, tz)}
      right={<Pill label={row.label} tone={TEAM_TONE[row.tone]} />} />
  );
}

/** Home: the team's figures and the first few people, opening My team. */
export function MyTeamCard({ team, tz, now }: { team: NonNullable<Desks['team']>; tz: string; now: Date }) {
  const rows = teamToday(team, now);
  return (
    <View>
      <SectionHeader title={`My team today · ${rows.length}`} action="See all" onAction={() => router.push('/team')} />
      <View style={{ gap: 8 }}>
        <TeamFigures rows={rows} />
        <ListGroup>
          {rows.slice(0, 4).map((r) => <TeamPersonRow key={r.member.id} row={r} tz={tz} />)}
          {rows.length > 4 && <ListRow icon="people-outline" title={`See all ${rows.length} people`} subtitle="Who’s away, coming up and this month" onPress={() => router.push('/team')} />}
        </ListGroup>
      </View>
    </View>
  );
}

/**
 * Home, for people who read the whole organization (an owner, HR): today's figures for everyone, the website's
 * headcount, presence and exits, and the first few people who need a look, opening Everyone today.
 */
export function OrgTodayCard({ org, name, tz, now }: { org: OrgToday; name: string; tz: string; now: Date }) {
  const rows = teamToday({ reports: 0, members: org.members, away: [], events: [], reviews: [] }, now);
  return (
    <View>
      <SectionHeader title={`${name} today · ${rows.length}`} action="See all" onAction={() => router.push('/everyone')} />
      <View style={{ gap: 8 }}>
        <TeamFigures rows={rows} />
        {(org.headcount != null || org.presence != null || org.exits != null) && (
          <Card padded={false} style={{ flexDirection: 'row', paddingVertical: 8 }}>
            {org.headcount != null && <Stat label="Headcount" value={org.headcount} />}
            {org.presence != null && <Stat label="Present this month" value={`${org.presence}%`} tone="info" />}
            {org.exits != null && <Stat label="Exits · 30 days" value={org.exits} tone={org.exits > 0 ? 'warning' : 'neutral'} />}
          </Card>
        )}
        {rows.length === 0
          ? <Card><EmptyState compact icon="people-outline" title="No one to show yet" body="Add employees on the website, and their day shows here." /></Card>
          : (
            <ListGroup>
              {rows.slice(0, 4).map((r) => <TeamPersonRow key={r.member.id} row={r} tz={tz} />)}
              <ListRow icon="people-outline" title={`See all ${rows.length} ${rows.length === 1 ? 'person' : 'people'}`} subtitle="Each person’s check-in, lunch and breaks, leave" onPress={() => router.push('/everyone')} />
            </ListGroup>
          )}
      </View>
    </View>
  );
}

/** Reports but no Reporting manager role: the database won't show their team, so say why. */
export function TeamRoleBanner({ reports }: { reports: number }) {
  return (
    <Banner tone="warning" title={`${reports} ${reports === 1 ? 'person reports' : 'people report'} to you`}
      text="Your account doesn’t have the Reporting manager role, so you can’t see their attendance or approve their requests. Ask HR to give you the role." />
  );
}

interface Line { key: string; icon: IconName; tone: Tone; title: string; subtitle?: string; path: string }

/** What is waiting in each of the person's desks, only the lines with something in them. */
export function workLines(d: Desks): Line[] {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const lines: Array<Line | false> = [];
  if (d.hr) {
    const h = d.hr;
    lines.push(
      h.leave_pending > 0 && { key: 'hr-leave', icon: 'airplane-outline', tone: 'warning', title: `${n(h.leave_pending, 'leave request')} waiting`, path: '/leave?tab=approvals' },
      h.attendance_pending > 0 && { key: 'hr-att', icon: 'time-outline', tone: 'warning', title: `${n(h.attendance_pending, 'attendance request')} waiting`, path: '/attendance?tab=approvals' },
      h.exits_to_decide > 0 && { key: 'hr-exit', icon: 'exit-outline', tone: 'warning', title: `${n(h.exits_to_decide, 'resignation')} to decide`, path: '/separations' },
      h.probation_overdue + h.probation_due > 0 && { key: 'hr-prob', icon: 'ribbon-outline', tone: h.probation_overdue ? 'danger' : 'warning',
        title: `${n(h.probation_overdue + h.probation_due, 'probation')} to confirm`, subtitle: h.probation_overdue ? `${h.probation_overdue} already ended` : 'Ending in the next 30 days', path: '/employees?tab=lifecycle' },
      h.joining > 0 && { key: 'hr-join', icon: 'person-add-outline', tone: 'info', title: `${n(h.joining, 'person', 'people')} joining soon`, path: '/employees?tab=people&status=pre_joining' },
      h.onboarding > 0 && { key: 'hr-onb', icon: 'rocket-outline', tone: 'info', title: `${n(h.onboarding, 'onboarding')} in progress`, path: '/onboarding' },
    );
  }
  if (d.payroll) {
    const p = d.payroll;
    const status = p.run ? p.run.status.charAt(0).toUpperCase() + p.run.status.slice(1) : 'Not started';
    lines.push(
      { key: 'pay-run', icon: 'wallet-outline', tone: p.run?.status === 'locked' ? 'success' : 'primary', title: `${monthYear(p.period)} payroll: ${status}`,
        subtitle: p.run ? `${p.run.employee_count} employees · net ${inr(Number(p.run.total_net ?? 0))}` : undefined, path: p.run ? `/payroll/${p.run.id}` : '/payroll?tab=run' },
      p.no_salary > 0 && { key: 'pay-sal', icon: 'alert-circle-outline', tone: 'danger', title: `${n(p.no_salary, 'person', 'people')} with no salary`, path: '/payroll?tab=people' },
      p.revisions_pending > 0 && { key: 'pay-rev', icon: 'trending-up-outline', tone: 'warning', title: `${n(p.revisions_pending, 'salary revision')} to sign off`, path: '/payroll?tab=people&view=revisions' },
      p.declarations_to_review > 0 && { key: 'pay-dec', icon: 'document-text-outline', tone: 'warning', title: `${n(p.declarations_to_review, 'tax declaration')} to review`, path: '/payroll?tab=declarations' },
    );
  }
  if (d.finance) {
    const f = d.finance;
    lines.push(
      ...f.runs_to_approve.map((r) => ({ key: `fin-run-${r.id}`, icon: 'checkmark-done-outline' as IconName, tone: 'warning' as Tone,
        title: `Approve ${monthYear(r.period_month)} payroll`, subtitle: `${r.employee_count} employees · net ${inr(Number(r.total_net ?? 0))}`, path: `/payroll/${r.id}` })),
      f.claims_to_pay.count > 0 && { key: 'fin-claims', icon: 'receipt-outline', tone: 'warning', title: `${n(f.claims_to_pay.count, 'expense claim')} to reimburse`, subtitle: inr(Number(f.claims_to_pay.amount)), path: '/expenses?tab=reimbursement' },
      f.invoices_to_approve.count + f.invoices_to_pay.count > 0 && { key: 'fin-inv', icon: 'business-outline', tone: f.invoices_overdue ? 'danger' : 'warning',
        title: `${n(f.invoices_to_approve.count + f.invoices_to_pay.count, 'vendor invoice')} to approve or pay`, subtitle: f.invoices_overdue ? `${f.invoices_overdue} past their due date` : undefined, path: '/vendors?tab=payments' },
      f.settlements > 0 && { key: 'fin-fnf', icon: 'calculator-outline', tone: 'warning', title: `${n(f.settlements, 'final settlement')} to approve`, path: '/separations' },
    );
  }
  if (d.hiring) {
    const h = d.hiring;
    lines.push(
      h.interviews_today > 0 && { key: 'hire-int', icon: 'chatbubbles-outline', tone: 'info', title: `${n(h.interviews_today, 'interview')} today`, path: '/recruitment/interviews' },
      h.offers_to_approve + h.offers_to_send > 0 && { key: 'hire-off', icon: 'mail-outline', tone: 'warning', title: `${n(h.offers_to_approve + h.offers_to_send, 'offer')} to approve or send`, path: '/recruitment?tab=pipeline' },
      h.open_jobs > 0 && { key: 'hire-jobs', icon: 'briefcase-outline', tone: 'primary', title: `${n(h.open_jobs, 'open job')} · ${n(h.openings, 'opening')}`,
        subtitle: `${h.stages.applied} applied · ${h.stages.screening} screening · ${h.stages.interview} interview · ${h.stages.offer} offer`, path: '/recruitment' },
    );
  }
  if (d.audit && d.audit.today > 0) lines.push({ key: 'audit', icon: 'shield-checkmark-outline', tone: 'primary', title: `${n(d.audit.today, 'audited change')} today`, path: '/audit' });
  const silent = (d.devices ?? []).filter((x) => x.active && (!x.last_punch || Date.now() - Date.parse(x.last_punch) > 24 * 3600_000)).length;
  if (silent > 0) lines.push({ key: 'devices', icon: 'hardware-chip-outline', tone: 'warning', title: `${n(silent, 'attendance device')} silent for a day`, path: '/attendance?tab=devices' });
  return lines.filter((l): l is Line => !!l);
}

/** Home: what is waiting in the person's desks; each line opens the website, where the work is done. */
export function WorkCard({ desks, slug }: { desks: Desks; slug: string }) {
  const lines = workLines(desks);
  if (!desks.hr && !desks.payroll && !desks.finance && !desks.hiring && !desks.audit && !desks.devices?.length) return null;
  return (
    <View>
      <SectionHeader title="Your work" action="Website" onAction={() => void Linking.openURL(`${SITE_URL}/app/${slug}`)} />
      <ListGroup footer="Opens on the website">
        {lines.length === 0
          ? <ListRow icon="checkmark-circle-outline" tone="success" title="Nothing waiting for you" />
          : lines.map((l) => <ListRow key={l.key} icon={l.icon} tone={l.tone} title={l.title} subtitle={l.subtitle} external
            onPress={() => void Linking.openURL(`${SITE_URL}/app/${slug}${l.path}`)} />)}
      </ListGroup>
    </View>
  );
}
