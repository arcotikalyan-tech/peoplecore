import { evaluateSetup, type SetupFacts, type SetupProgress } from '@peoplecore/shared/org-setup';
import { todayIn } from '@peoplecore/shared/dates';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { AttendanceCard } from '@/components/attendance-card';
import { MyTeamCard, TeamRoleBanner, WorkCard } from '@/components/desks';
import { DateLeaf, QuickActions, Stat, type QuickAction } from '@/components/quick-actions';
import { useCounts } from '@/lib/counts';
import { loadDesks } from '@/lib/desks';
import { ago, dateParts, dateRange, dayMonth, days, firstName, greeting, inr, monthYear, plainText, relativeDay } from '@/lib/format';
import { loadHolidays } from '@/lib/holidays';
import { loadCompleteness, PROFILE_PARTS } from '@/lib/profile';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { daysToFix, monthTotals, type DayRow } from '@/lib/worked';
import { Avatar, Button, Card, IconButton, LinkButton, ListGroup, ListRow, Page, Pill, ProgressBar, SectionHeader, SkeletonList, space, TabHeader, Text } from '@/ui';

interface Approval { id: string; summary: string; requested_by_name: string; created_at: string; escalated: boolean; step_label: string | null }
interface Balance { leave_type_id: string; name: string; available: number; is_paid: boolean; allow_negative: boolean }
interface Away { employee_id: string; name: string; start_date: string; end_date: string; status: string }
interface Birthday { employee_id: string; name: string; next_birthday: string }

const safe = <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => Promise.resolve(p).catch(() => fallback);

/**
 * Home: today's check-in first, then what needs you, a manager's team today, the work waiting in the person's role
 * (HR, payroll, finance, hiring), shortcuts, your leave and month, who's out, your latest payslip, holidays, birthdays
 * and announcements. Each part only appears when there's something in it, and only for
 * modules the organization uses.
 */
export default function Home() {
  const { workplace, refreshWorkplace } = useSession();
  const { unread, refresh: refreshCounts } = useCounts();
  const [showNet, setShowNet] = useState(false);
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const emp = workplace?.employeeId ?? null;
  const off = new Set(workplace?.off ?? []);
  const on = (m: string) => !off.has(m);

  const { data, loading, reload } = useLoad(async () => {
    if (!workplace) return null;
    const org = workplace.orgId;
    const [facts, holidays, balances, month, birthdays, announcements, acks, completeness, approvals, out, slip] = await Promise.all([
      safe(supabase.rpc('org_setup_status', { p_org: org }).then((r) => r.data as SetupFacts | null), null),
      on('holidays') ? safe(loadHolidays(org, today, undefined, 3), []) : [],
      emp && on('leave') ? safe(supabase.rpc('leave_balances', { p_employee: emp }).then((r) => (r.data ?? []) as Balance[]), []) : [],
      emp && on('attendance') ? safe(supabase.rpc('attendance_days_for', { p_employee: emp, p_month: `${today.slice(0, 7)}-01` }).then((r) => (r.data ?? []) as DayRow[]), []) : [],
      safe(supabase.rpc('upcoming_birthdays', { p_org: org, p_days: 14 }).then((r) => (r.data ?? []) as Birthday[]), []),
      on('engagement') ? safe(supabase.from('announcements').select('id, title, body, requires_ack, published_at, expires_at').eq('organization_id', org)
        .order('published_at', { ascending: false }).limit(5).then((r) => r.data ?? []), []) : [],
      emp ? safe(supabase.from('announcement_acknowledgements').select('announcement_id').eq('employee_id', emp).then((r) => r.data ?? []), []) : [],
      emp ? safe(loadCompleteness(org), null) : null,
      safe(supabase.rpc('my_pending_approvals', { p_org: org }).then((r) => (r.data ?? []) as Approval[]), []),
      on('leave') ? safe(supabase.rpc('team_leave_calendar', { p_org: org, p_from: today, p_to: today }).then((r) => (r.data ?? []) as Away[]), []) : [] as Away[],
      emp && on('payroll') ? safe(supabase.from('payroll_run_employees').select('run_id, period_month, net').eq('employee_id', emp)
        .order('period_month', { ascending: false }).limit(1).maybeSingle().then((r) => r.data), null) : null,
    ]);
    const acked = new Set(acks.map((a) => a.announcement_id));
    const live = announcements.filter((a) => !a.expires_at || a.expires_at >= today);
    return {
      setup: facts ? evaluateSetup(facts, off) as SetupProgress : null,
      holidays, balances: balances.map((b) => ({ ...b, available: Number(b.available) })).filter((b) => b.is_paid),
      totals: month.length ? monthTotals(month, today) : null,
      toFix: daysToFix(month, today),
      birthdays, announcements: live.slice(0, 2), toAcknowledge: live.filter((a) => a.requires_ack && !acked.has(a.id)).length,
      completeness, approvals,
      out: out.filter((o) => o.employee_id !== emp && o.status === 'approved'),
      slip: slip ? { ...slip, net: Number(slip.net) } : null,
    };
  }, [workplace, today]);

  // The role desks load on their own, so the rest of Home doesn't wait for them.
  const desks = useLoad(async () => (workplace ? loadDesks(workplace.orgId, workplace.slug, today) : null), [workplace, today]);
  const team = desks.data?.team ?? null;

  const refresh = () => Promise.all([reload(), desks.reload(), refreshCounts(), refreshWorkplace()]);
  const profileDone = data?.completeness ? PROFILE_PARTS.filter((p) => data.completeness![p.key]).length : PROFILE_PARTS.length;
  const actions: QuickAction[] = [
    on('leave') && { key: 'leave', label: 'Apply leave', icon: 'airplane-outline', tone: 'primary', onPress: () => router.push('/apply-leave') },
    on('attendance') && { key: 'correct', label: 'Correct a day', icon: 'create-outline', tone: 'warning', onPress: () => router.push('/attendance-request?kind=correct') },
    on('attendance') && { key: 'wfh', label: 'Work from home', icon: 'home-outline', tone: 'info', onPress: () => router.push('/attendance-request?kind=wfh') },
    on('payroll') && { key: 'payslips', label: 'Payslips', icon: 'wallet-outline', tone: 'success', onPress: () => router.push('/payslips') },
    on('holidays') && { key: 'holidays', label: 'Holidays', icon: 'sunny-outline', tone: 'accent', onPress: () => router.push('/holidays') },
    { key: 'directory', label: 'Directory', icon: 'people-outline', tone: 'info', onPress: () => router.push('/directory') },
    on('engagement') && { key: 'news', label: 'News', icon: 'megaphone-outline', tone: 'danger', onPress: () => router.push('/announcements') },
    { key: 'profile', label: 'My profile', icon: 'person-outline', tone: 'neutral', onPress: () => router.push('/profile') },
  ].filter((a): a is QuickAction => !!a && (!!emp || ['directory', 'holidays', 'news', 'profile'].includes(a.key)));

  const attention = data ? [
    ...data.approvals.slice(0, 3).map((a) => (
      <ListRow key={a.id} leading={<Avatar name={a.requested_by_name} size={34} />} title={a.summary}
        subtitle={`${a.requested_by_name} · ${ago(a.created_at)}${a.escalated ? ' · Overdue' : ''}`} onPress={() => router.navigate('/inbox')} />
    )),
    data.approvals.length > 3 && <ListRow key="more" icon="file-tray-full-outline" title={`${data.approvals.length - 3} more waiting for you`} onPress={() => router.navigate('/inbox')} />,
    data.toFix.length > 0 && (
      <ListRow key="fix" icon="alert-circle-outline" tone="warning" title={`${data.toFix.length} day${data.toFix.length === 1 ? '' : 's'} to correct this month`}
        subtitle="A missed check-out or an absence. Tap a day on the calendar to correct it." onPress={() => router.navigate('/attendance')} />
    ),
    data.toAcknowledge > 0 && <ListRow key="ack" icon="megaphone-outline" tone="danger" title={`${data.toAcknowledge} announcement${data.toAcknowledge === 1 ? '' : 's'} to acknowledge`} onPress={() => router.push('/announcements')} />,
    emp && data.completeness && profileDone < PROFILE_PARTS.length && (
      <ListRow key="profile" icon="person-add-outline" tone="warning" title="Complete your profile" subtitle={`${profileDone} of ${PROFILE_PARTS.length} done · HR needs these to pay you`} onPress={() => router.push('/profile')} />
    ),
  ].filter(Boolean) : [];

  return (
    <Page tab onRefresh={refresh} header={
      <TabHeader title={`${greeting(new Date(), tz)}${workplace?.employeeName ? `, ${firstName(workplace.employeeName)}` : ''}`}
        subtitle={`${dayMonth(today)} · ${workplace?.orgName ?? 'No organization'}`}
        right={<>
          <IconButton icon="notifications-outline" label="Notifications" badge={unread} onPress={() => router.navigate('/inbox?view=notifications')} />
          <Pressable accessibilityRole="button" accessibilityLabel="My profile" onPress={() => router.push('/profile')} hitSlop={6}>
            <Avatar name={workplace?.employeeName ?? workplace?.orgName} size={40} />
          </Pressable>
        </>} />
    }>
      {data?.setup && data.setup.percent < 100 && workplace && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm }}>
            <Text variant="headline">Set up {workplace.orgName}</Text>
            <Text variant="headline" tone="primary">{data.setup.percent}%</Text>
          </View>
          <ProgressBar value={data.setup.percent} label="Organization setup" />
          <Text variant="footnote" tone="muted" style={{ marginTop: space.sm }}>
            {data.setup.done} of {data.setup.total} steps done{data.setup.next[0] ? ` · Next: ${data.setup.next[0].title}` : ''}
          </Text>
          <Button label="Continue on the website" variant="tonal" size="sm" icon="open-outline" style={{ marginTop: space.md }}
            onPress={() => void Linking.openURL(`${SITE_URL}/app/${workplace.slug}/setup`)} />
        </Card>
      )}

      {on('attendance') && <AttendanceCard />}

      {attention.length > 0 && (
        <View>
          <SectionHeader title="Needs your attention" action={data?.approvals.length ? 'Inbox' : undefined} onAction={() => router.navigate('/inbox')} />
          <ListGroup>{attention}</ListGroup>
        </View>
      )}

      {team && team.members.length > 0 && <MyTeamCard team={team} tz={tz} now={new Date()} />}
      {team && team.reports > 0 && team.members.length === 0 && <TeamRoleBanner reports={team.reports} />}
      {desks.data && workplace && <WorkCard desks={desks.data} slug={workplace.slug} />}

      {actions.length > 0 && (
        <View>
          <SectionHeader title="Quick actions" />
          <Card><QuickActions actions={actions} /></Card>
        </View>
      )}

      {loading && <SkeletonList rows={4} />}

      {!!data?.balances.length && (
        <View>
          <SectionHeader title="Leave balance" action="Apply" onAction={() => router.push('/apply-leave')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }} style={{ marginHorizontal: -space.lg }}>
            <View style={{ width: space.lg - space.md }} />
            {data.balances.map((b) => (
              <Card key={b.leave_type_id} onPress={() => router.navigate('/leave')} style={{ width: 132 }} accessibilityLabel={`${b.name}: ${days(b.available)} available`}>
                <Text variant="figure" tone="primary">{Number.isInteger(b.available) ? b.available : b.available.toFixed(1)}</Text>
                <Text variant="caption" tone="muted">days available</Text>
                <Text variant="footnote" style={{ fontWeight: '600', marginTop: space.sm }} numberOfLines={2}>{b.name}</Text>
              </Card>
            ))}
            <View style={{ width: space.lg - space.md }} />
          </ScrollView>
        </View>
      )}

      {data?.totals && (
        <View>
          <SectionHeader title={monthYear(today)} action="Calendar" onAction={() => router.navigate('/attendance')} />
          <Card padded={false} style={{ flexDirection: 'row', paddingVertical: space.sm }}>
            <Stat label="Present" value={data.totals.present} tone="success" />
            <Stat label="Late" value={data.totals.late} tone="warning" />
            <Stat label="On leave" value={data.totals.leave} tone="info" />
            <Stat label="Absent" value={data.totals.absent} tone="danger" />
          </Card>
        </View>
      )}

      {!!data?.out.length && (
        <View>
          <SectionHeader title="Who’s out today" />
          <ListGroup>
            {data.out.slice(0, 5).map((o) => (
              <ListRow key={o.employee_id + o.start_date} leading={<Avatar name={o.name} size={34} />} title={o.name}
                subtitle={o.start_date === o.end_date ? 'On leave today' : `On leave ${dateRange(o.start_date, o.end_date, Number(today.slice(0, 4)))}`} />
            ))}
          </ListGroup>
        </View>
      )}

      {data?.slip && (
        <View>
          <SectionHeader title="Latest payslip" action="All payslips" onAction={() => router.push('/payslips')} />
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text variant="footnote" tone="muted">{monthYear(data.slip.period_month)} · Net pay</Text>
                <Text variant="figure">{showNet ? inr(data.slip.net) : '₹ • • • • •'}</Text>
                <LinkButton label="View payslip" onPress={() => router.push(`/payslip?run=${data.slip!.run_id}`)} />
              </View>
              <Button label={showNet ? 'Hide' : 'Show'} variant="tonal" size="sm" icon={showNet ? 'eye-off-outline' : 'eye-outline'}
                accessibilityLabel={showNet ? 'Hide net pay' : 'Show net pay'} onPress={() => setShowNet((v) => !v)} />
            </View>
          </Card>
        </View>
      )}

      {!!data?.holidays.length && (
        <View>
          <SectionHeader title="Upcoming holidays" action="View all" onAction={() => router.push('/holidays')} />
          <ListGroup>
            {data.holidays.map((h) => {
              const p = dateParts(h.holiday_date);
              return (
                <ListRow key={h.holiday_date + h.name} leading={<DateLeaf month={p.month} day={p.day} tone={h.is_optional ? 'accent' : 'primary'} />}
                  title={h.name} subtitle={`${relativeDay(h.holiday_date, today) === 'Today' ? 'Today' : p.weekday}${h.is_optional ? ' · Optional' : ''}`} />
              );
            })}
          </ListGroup>
        </View>
      )}

      {!!data?.birthdays.length && (
        <View>
          <SectionHeader title="Celebrations" />
          <ListGroup>
            {data.birthdays.slice(0, 4).map((b) => (
              <ListRow key={b.employee_id} leading={<Avatar name={b.name} size={34} />} title={b.name}
                subtitle={`Birthday · ${relativeDay(b.next_birthday, today)}`}
                right={relativeDay(b.next_birthday, today) === 'Today' ? <Pill label="Today 🎂" tone="accent" /> : undefined} />
            ))}
          </ListGroup>
        </View>
      )}

      {!!data?.announcements.length && (
        <View>
          <SectionHeader title="Announcements" action="View all" onAction={() => router.push('/announcements')} />
          <View style={{ gap: space.md }}>
            {data.announcements.map((a) => (
              <Card key={a.id} onPress={() => router.push('/announcements')} accessibilityLabel={a.title}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, marginBottom: 4 }}>
                  <Text variant="headline" style={{ flex: 1 }} numberOfLines={2}>{a.title}</Text>
                  <Text variant="caption" tone="muted">{ago(a.published_at)}</Text>
                </View>
                <Text variant="callout" tone="muted" numberOfLines={3}>{plainText(a.body)}</Text>
              </Card>
            ))}
          </View>
        </View>
      )}
    </Page>
  );
}
