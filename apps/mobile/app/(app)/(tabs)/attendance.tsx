import { todayIn } from '@peoplecore/shared/dates';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AttendanceCard } from '@/components/attendance-card';
import { DAY_STATUS, MonthCalendar } from '@/components/month-calendar';
import { Stat } from '@/components/quick-actions';
import { longDate, monthTitle, shiftMonth } from '@/lib/calendar';
import { clock, dateRange, duration } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import { useToday } from '@/lib/today';
import { monthTotals } from '@/lib/worked';
import { Button, Card, DetailRow, EmptyState, ErrorState, ListGroup, ListRow, Page, Pill, SectionHeader, SkeletonList, space, StatusPill, TabHeader, Text, useTheme } from '@/ui';

interface DayRow { work_date: string; status: string; first_in: string | null; last_out: string | null; worked_minutes: number; late_minutes: number; early_out_minutes: number; is_regularized: boolean }

/**
 * Attendance: today's check-in, the month as a calendar (tap a day for its times, and to correct it), the month's
 * totals and your correction, work from home and on duty requests.
 */
export default function Attendance() {
  const { workplace } = useSession();
  const { colors } = useTheme();
  const { sync, day: live } = useToday();
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const emp = workplace?.employeeId;
  const [[year, month], setMonth] = useState<[number, number]>([Number(today.slice(0, 4)), Number(today.slice(5, 7))]);
  const [selected, setSelected] = useState<string | null>(today);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;

  const days = useLoad(async () => {
    if (!emp) return [] as DayRow[];
    return must(await supabase.rpc('attendance_days_for', { p_employee: emp, p_month: first })) as DayRow[];
  }, [emp, first]);
  const requests = useLoad(async () => {
    if (!emp) return { corrections: [], away: [] };
    const [regs, reqs] = await Promise.all([
      supabase.from('regularization_requests').select('id, work_date, status').eq('employee_id', emp).order('created_at', { ascending: false }).limit(10),
      supabase.from('attendance_requests').select('id, kind, start_date, end_date, status').eq('employee_id', emp).order('created_at', { ascending: false }).limit(10),
    ]);
    return { corrections: must(regs), away: must(reqs) };
  }, [emp]);

  const statuses = Object.fromEntries((days.data ?? []).map((d) => [d.work_date, d.status]));
  const chosen = selected ? days.data?.find((d) => d.work_date === selected) : undefined;
  const totals = days.data ? monthTotals(days.data, today) : null;
  const thisYear = Number(today.slice(0, 4));
  const isCurrent = first === `${today.slice(0, 7)}-01`;
  const move = (by: number) => { const next = shiftMonth(year, month, by); setMonth(next); setSelected(null); };
  const all = [
    ...(requests.data?.corrections ?? []).map((r) => ({ id: r.id, title: 'Correction', when: longDate(r.work_date), status: r.status, icon: 'create-outline' as const })),
    ...(requests.data?.away ?? []).map((r) => ({ id: r.id, title: r.kind === 'wfh' ? 'Work from home' : 'On duty', when: dateRange(r.start_date, r.end_date, thisYear), status: r.status, icon: r.kind === 'wfh' ? 'home-outline' as const : 'briefcase-outline' as const })),
  ];

  return (
    <Page tab onRefresh={() => Promise.all([days.reload(), requests.reload(), sync()])}
      header={<TabHeader title="Attendance" subtitle={workplace?.orgName} />}>
      <AttendanceCard />

      {emp && (
        <>
          <View>
            <SectionHeader title="Calendar" />
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md }}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => move(-1)} style={{ padding: 4 }}>
                  <Ionicons name="chevron-back" size={22} color={colors.primary} />
                </Pressable>
                <Text variant="headline" accessibilityRole="header">{monthTitle(year, month)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: isCurrent }} disabled={isCurrent} hitSlop={10}
                  onPress={() => move(1)} style={{ padding: 4, opacity: isCurrent ? 0.3 : 1 }}>
                  <Ionicons name="chevron-forward" size={22} color={colors.primary} />
                </Pressable>
              </View>
              {days.error ? <ErrorState onRetry={() => void days.reload()} /> : (
                <MonthCalendar year={year} month={month} statuses={statuses} today={today} selected={selected} onSelect={setSelected} />
              )}
            </Card>
          </View>

          {selected && selected <= today && (
            <Card accessibilityLabel={`Details for ${longDate(selected)}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xs }}>
                <Text variant="headline">{longDate(selected)}</Text>
                {chosen && <Pill label={DAY_STATUS[chosen.status]?.label ?? chosen.status} tone={DAY_STATUS[chosen.status]?.tone ?? 'neutral'} />}
              </View>
              {selected === today ? (
                <>
                  <DetailRow label="Check in" value={live.firstIn ? clock(live.firstIn, tz) : '—'} />
                  <DetailRow label="Check out" value={live.lastOut ? clock(live.lastOut, tz) : '—'} />
                  <DetailRow label="Lunch and breaks" value={live.breakMinutes ? duration(live.breakMinutes) : '—'} />
                  <DetailRow label="At work so far" value={duration(live.atWorkMinutes)} last />
                </>
              ) : chosen ? (
                <>
                  <DetailRow label="Check in" value={chosen.first_in ? clock(chosen.first_in, tz) : '—'} />
                  <DetailRow label="Check out" value={chosen.last_out ? clock(chosen.last_out, tz) : '—'} />
                  <DetailRow label="Worked" value={duration(chosen.worked_minutes)} />
                  {chosen.late_minutes > 0 && <DetailRow label="Late by" value={duration(chosen.late_minutes)} />}
                  {chosen.early_out_minutes > 0 && <DetailRow label="Left early by" value={duration(chosen.early_out_minutes)} />}
                  <DetailRow label="Corrected" value={chosen.is_regularized ? 'Yes' : 'No'} last />
                </>
              ) : <Text variant="callout" tone="muted">Nothing recorded for this day.</Text>}
              {selected < today && (
                <Button label="Correct this day" variant="tonal" icon="create-outline" style={{ marginTop: space.md }}
                  onPress={() => router.push(`/attendance-request?kind=correct&date=${selected}`)} />
              )}
            </Card>
          )}

          {totals && (
            <View>
              <SectionHeader title={`${monthTitle(year, month)} so far`} />
              <Card padded={false} style={{ flexDirection: 'row', paddingVertical: space.sm }}>
                <Stat label="Present" value={totals.present} tone="success" />
                <Stat label="Late" value={totals.late} tone="warning" />
                <Stat label="On leave" value={totals.leave} tone="info" />
                <Stat label="Absent" value={totals.absent} tone="danger" />
              </Card>
            </View>
          )}

          <View>
            <SectionHeader title="My requests" action="New request" onAction={() => router.push('/attendance-request')} />
            {requests.loading ? <SkeletonList rows={2} /> : requests.error ? <Card><ErrorState onRetry={() => void requests.reload()} /></Card> : all.length === 0 ? (
              <Card>
                <EmptyState compact icon="document-text-outline" title="No requests yet"
                  body="Missed a punch, working from home or out on duty? Ask for it here and your manager approves it."
                  action="New request" onAction={() => router.push('/attendance-request')} />
              </Card>
            ) : (
              <ListGroup>
                {all.map((r) => <ListRow key={r.id} icon={r.icon} tone="info" title={r.title} subtitle={r.when} right={<StatusPill status={r.status} />} />)}
              </ListGroup>
            )}
          </View>
        </>
      )}
    </Page>
  );
}
