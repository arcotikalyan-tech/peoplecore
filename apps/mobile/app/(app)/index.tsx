import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { QueuedPunch } from '@/lib/punch-queue';
import { currentPosition, newClientId, queue, sendPunch } from '@/lib/punches';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, Message, s, Screen } from '@/ui';

const time = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

export default function Today() {
  const { workplace, signOut } = useSession();
  const [punches, setPunches] = useState<Array<{ id: string; punched_at: string; method: string }>>([]);
  const [queued, setQueued] = useState<QueuedPunch[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success' | 'muted'; text: string } | null>(null);
  const tz = workplace?.timezone ?? 'Asia/Kolkata';

  const load = useCallback(async () => {
    setQueued(await queue.all());
    if (!workplace?.employeeId) return;
    const start = new Date(`${todayIn(tz)}T00:00:00`).toISOString(); // device-local midnight is close enough for a list
    const { data } = await supabase.from('attendance_punches').select('id, punched_at, method')
      .eq('employee_id', workplace.employeeId).gte('punched_at', start).order('punched_at');
    setPunches(data ?? []);
  }, [workplace, tz]);

  const sync = useCallback(async () => {
    const r = await queue.sync(sendPunch);
    if (r.sent) setMessage({ tone: 'success', text: r.sent === 1 ? 'Recorded.' : `${r.sent} punches recorded.` });
    else if (r.waiting) setMessage({ tone: 'muted', text: 'Saved on this phone. It will be sent when you’re back online.' });
    await load();
  }, [load]);

  useEffect(() => {
    void sync();
    return NetInfo.addEventListener((state) => { if (state.isConnected) void sync(); });
  }, [sync]);

  const punch = async () => {
    if (!workplace) return;
    setBusy(true);
    setMessage(null);
    const where = await currentPosition();
    if ('error' in where) setMessage({ tone: 'danger', text: where.error });
    else {
      await queue.add({ clientId: newClientId(), orgId: workplace.orgId, ...where });
      await sync();
    }
    setBusy(false);
  };

  const pending = queued.filter((q) => !q.refused);
  const refused = queued.filter((q) => q.refused);
  const checkedIn = (punches.length + pending.length) % 2 === 1;

  return (
    <ScrollView refreshControl={<RefreshControl refreshing={false} onRefresh={() => void sync()} />}>
      <Screen>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700' }}>{workplace?.employeeName ? `Hello, ${workplace.employeeName.split(' ')[0]}` : 'Today'}</Text>
        <Text style={s.muted}>{workplace?.orgName ?? 'No organization'}</Text>
        {!workplace?.employeeId ? (
          <Card><Text style={s.muted}>Your HR team hasn’t linked an employee profile to your account yet.</Text></Card>
        ) : (
          <Card title="Attendance">
            <Button label={checkedIn ? 'Check out' : 'Check in'} busy={busy} onPress={() => void punch()} />
            {message && <Message tone={message.tone} text={message.text} />}
            <View accessibilityLabel="Today's punches" style={{ marginTop: 8 }}>
              {punches.map((p) => <View key={p.id} style={s.row}><Text>{time(p.punched_at, tz)}</Text><Text style={s.muted}>{p.method}</Text></View>)}
              {pending.map((p) => <View key={p.clientId} style={s.row}><Text>{time(p.punchedAt, tz)}</Text><Text style={s.muted}>Waiting to send</Text></View>)}
              {punches.length === 0 && pending.length === 0 && <Text style={s.muted}>No punches yet today.</Text>}
            </View>
          </Card>
        )}
        {refused.length > 0 && (
          <Card title="Not recorded">
            {refused.map((p) => (
              <View key={p.clientId} style={{ marginBottom: 8 }}>
                <Text>{time(p.punchedAt, tz)}: {p.refused}</Text>
                <Button label="Dismiss" variant="secondary" onPress={() => void queue.dismiss(p.clientId).then(load)} />
              </View>
            ))}
          </Card>
        )}
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Screen>
    </ScrollView>
  );
}
