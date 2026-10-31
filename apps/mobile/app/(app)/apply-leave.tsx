import { todayIn } from '@peoplecore/shared/dates';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { DateField } from '@/date-field';
import { useCounts } from '@/lib/counts';
import { dateRange } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import { Avatar, Banner, Button, Card, Chips, ErrorState, Field, ListRow, Page, SkeletonList, space, Text, useTheme, useToast } from '@/ui';

interface Balance { leave_type_id: string; name: string; is_paid: boolean; allow_half_day: boolean; available: number }
interface Away { employee_id: string; name: string; start_date: string; end_date: string; status: string }

/**
 * Applying for leave: the type (with what's left of each), the dates, half days where the type allows them and a
 * reason. Teammates already away on those dates are shown before you send it. The database checks the balance and
 * the policy, and asks your approvers.
 */
export default function ApplyLeave() {
  const { workplace } = useSession();
  const { colors } = useTheme();
  const toast = useToast();
  const counts = useCounts();
  const emp = workplace?.employeeId;
  const today = todayIn(workplace?.timezone ?? 'Asia/Kolkata');
  const [type, setType] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfStart, setHalfStart] = useState(false);
  const [halfEnd, setHalfEnd] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [away, setAway] = useState<Away[]>([]);

  const { data: balances, loading, error, reload } = useLoad(async () => {
    if (!emp) return [] as Balance[];
    return (must(await supabase.rpc('leave_balances', { p_employee: emp })) as Balance[]).map((b) => ({ ...b, available: Number(b.available) }));
  }, [emp]);
  const chosen = balances?.find((b) => b.leave_type_id === type);
  const last = to || from;
  const single = !!from && last === from;

  // Who on your team is already away on those dates.
  useEffect(() => {
    if (!workplace || !from) { setAway([]); return; }
    let live = true;
    void supabase.rpc('team_leave_calendar', { p_org: workplace.orgId, p_from: from, p_to: last }).then(({ data }) => {
      if (live) setAway(((data ?? []) as Away[]).filter((a) => a.employee_id !== emp && a.status !== 'rejected' && a.status !== 'cancelled'));
    });
    return () => { live = false; };
  }, [workplace, from, last, emp]);

  const submit = async () => {
    setProblem(null);
    if (!emp || !type) return setProblem('Choose a leave type.');
    if (!from) return setProblem('Choose the first day of your leave.');
    if (to && to < from) return setProblem('The last day can’t be before the first.');
    setBusy(true);
    const { error: e } = await supabase.rpc('apply_leave', {
      p_employee: emp, p_type: type, p_start: from, p_end: last,
      p_half_start: chosen?.allow_half_day ? halfStart : false, p_half_end: chosen?.allow_half_day && !single ? halfEnd : false,
      p_reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (e) return setProblem(e.code === '22023' ? e.message : 'That didn’t work. Check your connection and try again.');
    toast('Leave requested. Your manager has been asked to approve it.');
    void counts.refresh();
    if (router.canGoBack()) router.back();
    else router.replace('/leave');
  };

  if (!emp) return <Page><Banner tone="info" text="Your sign-in isn’t linked to an employee profile yet, so leave can’t be requested." /></Page>;
  return (
    <Page keyboard>
      {loading ? <SkeletonList rows={3} /> : error ? <ErrorState onRetry={() => void reload()} /> : (
        <>
          <Chips label="Leave type" value={type} onChange={(v) => { setType(v); setHalfStart(false); setHalfEnd(false); }}
            options={(balances ?? []).map((b) => ({ value: b.leave_type_id, label: b.name, note: b.is_paid ? `${Number.isInteger(b.available) ? b.available : b.available.toFixed(1)} left` : 'unpaid' }))} />
          <View>
            <DateField label="From" value={from} min={today} onChange={(d) => { setFrom(d); if (to && to < d) setTo(''); }} />
            <DateField label="To" value={to} onChange={setTo} min={from || today} placeholder="Same day" clearable />
          </View>
          {chosen?.allow_half_day && from && (
            <Card padded={false}>
              <ListRow title={single ? 'Half day' : 'Start in the second half'} subtitle={single ? 'Only half of this day' : `Of ${dateRange(from, from, Number(today.slice(0, 4)))}`}
                right={<Switch value={halfStart} onValueChange={setHalfStart} accessibilityLabel={single ? 'Half day' : 'Start in the second half'}
                  trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor="#fff" />} />
              {!single && (
                <ListRow title="End after the first half" subtitle={`Of ${dateRange(last, last, Number(today.slice(0, 4)))}`}
                  right={<Switch value={halfEnd} onValueChange={setHalfEnd} accessibilityLabel="End after the first half"
                    trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor="#fff" />} />
              )}
            </Card>
          )}
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Optional, shown to your approver" multiline />
          {away.length > 0 && (
            <Card>
              <Text variant="footnote" style={{ fontWeight: '600', marginBottom: space.sm }}>Also away on these dates</Text>
              {away.slice(0, 5).map((a) => (
                <View key={a.employee_id + a.start_date} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 }}>
                  <Avatar name={a.name} size={26} />
                  <Text variant="callout" style={{ flex: 1 }} numberOfLines={1}>{a.name}</Text>
                  <Text variant="caption" tone="muted">{dateRange(a.start_date, a.end_date, Number(today.slice(0, 4)))}</Text>
                </View>
              ))}
            </Card>
          )}
          {chosen?.is_paid && chosen.available <= 0 && <Banner tone="warning" text={`You have no ${chosen.name} left. Your policy decides whether it can go below zero.`} />}
          {problem && <Banner tone="danger" text={problem} />}
          <Button label="Send for approval" size="lg" icon="paper-plane-outline" busy={busy} onPress={() => void submit()} />
        </>
      )}
    </Page>
  );
}
