import { todayIn } from '@peoplecore/shared/dates';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { addDays } from '@/lib/calendar';
import { dateRange, days } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import { Avatar, Banner, Button, Card, EmptyState, ErrorState, ListGroup, ListRow, Page, Segmented, SectionHeader, Sheet, SkeletonList, space, StatusPill, TabHeader, Text, useToast } from '@/ui';

interface Balance { leave_type_id: string; name: string; is_paid: boolean; balance: number; pending: number; available: number }
interface Request { id: string; leave_type_id: string; start_date: string; end_date: string; days: number; status: string; reason: string | null }
interface Away { employee_id: string; name: string; start_date: string; end_date: string; status: string }

/** Leave: balances, the Apply button, your requests (upcoming and past, cancel from here) and who's away soon. */
export default function Leave() {
  const { workplace } = useSession();
  const toast = useToast();
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const emp = workplace?.employeeId;
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelling, setCancelling] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async () => {
    if (!emp || !workplace) return null;
    const [b, r, team] = await Promise.all([
      supabase.rpc('leave_balances', { p_employee: emp }),
      supabase.from('leave_requests').select('id, leave_type_id, start_date, end_date, days, status, reason').eq('employee_id', emp).order('start_date', { ascending: false }).limit(40),
      supabase.rpc('team_leave_calendar', { p_org: workplace.orgId, p_from: today, p_to: addDays(today, 14) }),
    ]);
    return {
      balances: (must(b) as Balance[]).map((x) => ({ ...x, balance: Number(x.balance), pending: Number(x.pending), available: Number(x.available) })),
      requests: (must(r) as Request[]).map((x) => ({ ...x, days: Number(x.days) })),
      away: ((team.data ?? []) as Away[]).filter((a) => a.employee_id !== emp && a.status === 'approved'),
    };
  }, [emp, workplace, today]);

  const name = (id: string) => data?.balances.find((b) => b.leave_type_id === id)?.name ?? 'Leave';
  const upcoming = data?.requests.filter((r) => r.end_date >= today && (r.status === 'pending' || r.status === 'approved')).reverse() ?? [];
  const past = data?.requests.filter((r) => !upcoming.includes(r)) ?? [];
  const list = view === 'upcoming' ? upcoming : past;
  const thisYear = Number(today.slice(0, 4));

  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    const { error: e } = await supabase.rpc('cancel_leave', { p_request: cancelling.id });
    setBusy(false);
    if (e) return setProblem(e.code === '22023' ? e.message : 'Couldn’t cancel. Try again.');
    setCancelling(null);
    toast('Leave cancelled.');
    await reload();
  };

  if (!emp) {
    return (
      <Page tab header={<TabHeader title="Leave" />}>
        <Card><EmptyState icon="id-card-outline" title="No employee profile yet" body="Your HR team links your sign-in to your employee profile. Then you can apply for leave here." /></Card>
      </Page>
    );
  }
  return (
    <Page tab onRefresh={reload} header={<TabHeader title="Leave" subtitle={`${thisYear} · ${workplace?.orgName ?? ''}`} />}>
      <Button label="Apply for leave" size="lg" icon="add-circle-outline" onPress={() => router.push('/apply-leave')} />

      {loading ? <SkeletonList rows={3} /> : error || !data ? <Card><ErrorState onRetry={() => void reload()} /></Card> : (
        <>
          <View>
            <SectionHeader title="Balances" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {data.balances.map((b) => (
                <Card key={b.leave_type_id} style={{ width: '47.8%' }} accessibilityLabel={`${b.name}: ${b.is_paid ? `${days(b.available)} available` : 'unpaid'}`}>
                  <Text variant="footnote" style={{ fontWeight: '600' }} numberOfLines={1}>{b.name}</Text>
                  {b.is_paid ? (
                    <>
                      <Text variant="figure" tone="primary" style={{ marginTop: 4 }}>{Number.isInteger(b.available) ? b.available : b.available.toFixed(1)}</Text>
                      <Text variant="caption" tone="muted">available{b.pending ? ` · ${b.pending} pending` : ''}</Text>
                    </>
                  ) : (
                    <>
                      <Text variant="figure" tone="muted" style={{ marginTop: 4 }}>—</Text>
                      <Text variant="caption" tone="muted">Unpaid, no balance</Text>
                    </>
                  )}
                </Card>
              ))}
            </View>
          </View>

          <View style={{ gap: space.md }}>
            <SectionHeader title="My leave" style={{ marginBottom: 0 }} />
            <Segmented value={view} onChange={setView} options={[{ value: 'upcoming', label: 'Upcoming', count: upcoming.length }, { value: 'past', label: 'History' }]} />
            {list.length === 0 ? (
              <Card>
                <EmptyState compact icon={view === 'upcoming' ? 'airplane-outline' : 'time-outline'}
                  title={view === 'upcoming' ? 'No leave coming up' : 'No past requests'}
                  body={view === 'upcoming' ? 'Planning time off? Apply and your manager is asked to approve it.' : undefined}
                  action={view === 'upcoming' ? 'Apply for leave' : undefined} onAction={() => router.push('/apply-leave')} />
              </Card>
            ) : (
              <ListGroup>
                {list.map((r) => (
                  <ListRow key={r.id} icon="calendar-outline" tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'neutral'}
                    title={`${name(r.leave_type_id)} · ${days(r.days)}`} subtitle={`${dateRange(r.start_date, r.end_date, thisYear)}${r.reason ? ` · ${r.reason}` : ''}`}
                    right={<StatusPill status={r.status} />}
                    onPress={view === 'upcoming' ? () => { setProblem(null); setCancelling(r); } : undefined}
                    accessibilityLabel={`${name(r.leave_type_id)}, ${dateRange(r.start_date, r.end_date, thisYear)}, ${r.status}${view === 'upcoming' ? '. Opens cancel' : ''}`} />
                ))}
              </ListGroup>
            )}
          </View>

          {data.away.length > 0 && (
            <View>
              <SectionHeader title="Who’s away · next 2 weeks" />
              <ListGroup>
                {data.away.slice(0, 8).map((a) => (
                  <ListRow key={a.employee_id + a.start_date} leading={<Avatar name={a.name} size={34} />} title={a.name} subtitle={dateRange(a.start_date, a.end_date, thisYear)} />
                ))}
              </ListGroup>
            </View>
          )}

          <ListGroup>
            <ListRow icon="sunny-outline" tone="accent" title="Holiday calendar" onPress={() => router.push('/holidays')} />
          </ListGroup>
        </>
      )}

      <Sheet visible={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this leave?">
        {cancelling && (
          <>
            <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>
              {name(cancelling.leave_type_id)} · {dateRange(cancelling.start_date, cancelling.end_date, thisYear)} · {days(cancelling.days)}.
              {cancelling.status === 'approved' ? ' It was approved; the days go back to your balance.' : ' Your manager won’t be asked any more.'}
            </Text>
            {problem && <Banner tone="danger" text={problem} style={{ marginBottom: space.md }} />}
            <View style={{ gap: space.sm }}>
              <Button label="Cancel leave" variant="danger" busy={busy} onPress={() => void cancel()} />
              <Button label="Keep it" variant="ghost" onPress={() => setCancelling(null)} />
            </View>
          </>
        )}
      </Sheet>
    </Page>
  );
}
