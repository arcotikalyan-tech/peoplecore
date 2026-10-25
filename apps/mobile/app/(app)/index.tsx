import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { router } from 'expo-router';
import { evaluateSetup, type SetupFacts, type SetupProgress } from '@peoplecore/shared/org-setup';
import { useCallback, useEffect, useState } from 'react';
import { startOfDayIn, todayIn } from '@peoplecore/shared/dates';
import { AppState, Linking, RefreshControl, ScrollView, View } from 'react-native';
import type { QueuedPunch } from '@/lib/punch-queue';
import { currentPosition, newClientId, queue, sendPunch } from '@/lib/punches';
import { takeSelfie } from '@/lib/selfie';
import { selfieRequired } from '@/lib/selfie-rule';
import { plainSpaces } from '@/lib/text-weight';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { supabase } from '@/lib/supabase';
import { Button, Card, colors, Message, s, Screen, Text } from '@/ui';

const time = (iso: string, tz: string) => plainSpaces(new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)));

export default function Today() {
  const { workplace } = useSession();
  const [setup, setSetup] = useState<SetupProgress | null>(null);
  const [needsSelfie, setNeedsSelfie] = useState(false);
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name: string; is_optional: boolean }>>([]);
  const [punches, setPunches] = useState<Array<{ id: string; punched_at: string; method: string }>>([]);
  const [queued, setQueued] = useState<QueuedPunch[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success' | 'muted'; text: string } | null>(null);
  const tz = workplace?.timezone ?? 'Asia/Kolkata';

  // The rule is asked again before every check-in and check-out, and on each refresh, so HR switching the selfie on
  // takes effect at once.
  const checkSelfie = useCallback(async () => {
    const employeeId = workplace?.employeeId;
    if (!employeeId) return false;
    const required = await selfieRequired(AsyncStorage, employeeId, async () => {
      const { data, error } = await supabase.rpc('attendance_rule_for', { p_employee: employeeId, p_date: todayIn(tz) });
      return error ? null : Boolean((data as Array<{ verify_selfie?: boolean }> | null)?.[0]?.verify_selfie);
    });
    setNeedsSelfie(required);
    return required;
  }, [workplace, tz]);

  const load = useCallback(async () => {
    setQueued(await queue.all());
    if (!workplace?.employeeId) return;
    void checkSelfie();
    const start = startOfDayIn(todayIn(tz), tz).toISOString();
    const { data } = await supabase.from('attendance_punches').select('id, punched_at, method')
      .eq('employee_id', workplace.employeeId).gte('punched_at', start).order('punched_at');
    setPunches(data ?? []);
  }, [workplace, tz, checkSelfie]);

  const sync = useCallback(async () => {
    const r = await queue.sync(sendPunch);
    if (r.sent) setMessage({ tone: 'success', text: r.sent === 1 ? 'Recorded.' : `${r.sent} punches recorded.` });
    else if (r.waiting) setMessage({ tone: 'muted', text: 'Saved on this phone. It will be sent when you’re back online.' });
    await load();
  }, [load]);

  // Organization setup, for the owner and HR (org_setup_status is empty for everyone else).
  useEffect(() => {
    if (!workplace) return;
    void (async () => {
      const [{ data: facts }, { data: modules }] = await Promise.all([
        supabase.rpc('org_setup_status', { p_org: workplace.orgId }),
        supabase.from('org_modules').select('module, enabled').eq('organization_id', workplace.orgId),
      ]);
      const { data: next } = await supabase.from('holidays').select('holiday_date, name, is_optional').eq('organization_id', workplace.orgId)
        .gte('holiday_date', todayIn(workplace.timezone)).order('holiday_date').limit(8);
      const seen = new Set<string>();
      setHolidays(((next ?? []) as Array<{ holiday_date: string; name: string; is_optional: boolean }>).filter((h) => !seen.has(h.holiday_date + h.name) && seen.add(h.holiday_date + h.name)).slice(0, 4));
      const off = new Set(((modules ?? []) as Array<{ module: string; enabled: boolean }>).filter((m) => !m.enabled).map((m) => m.module));
      setSetup(facts ? evaluateSetup(facts as SetupFacts, off) : null);
    })();
  }, [workplace]);

  useEffect(() => {
    void sync();
    const net = NetInfo.addEventListener((state) => { if (state.isConnected) void sync(); });
    const front = AppState.addEventListener('change', (state) => { if (state === 'active') void sync(); });
    return () => { net(); front.remove(); };
  }, [sync]);

  const punch = async () => {
    if (!workplace) return;
    setBusy(true);
    setMessage(null);
    const selfie = await checkSelfie();
    const where = await currentPosition();
    if ('error' in where) {
      setMessage({ tone: 'danger', text: where.error });
      return setBusy(false);
    }
    // The rule asks for a selfie with each check-in and check-out: the front camera first.
    let photoUri: string | undefined;
    if (selfie) {
      const shot = await takeSelfie();
      if (!shot || 'error' in shot) {
        setMessage(shot ? { tone: 'danger', text: shot.error } : { tone: 'muted', text: 'Take a selfie to check in.' });
        return setBusy(false);
      }
      photoUri = shot.uri;
    }
    await queue.add({ clientId: newClientId(), orgId: workplace.orgId, ...where, ...(photoUri ? { photoUri } : {}) });
    await sync();
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
        {setup && setup.percent < 100 && workplace && (
          <Card title={`Organization setup · ${setup.percent}% done`}>
            <View accessibilityRole="progressbar" accessibilityLabel="Setup progress" accessibilityValue={{ min: 0, max: 100, now: setup.percent }}
              style={{ height: 8, borderRadius: 4, backgroundColor: colors.line, marginBottom: 8 }}>
              <View style={{ height: 8, borderRadius: 4, width: `${setup.percent}%`, backgroundColor: colors.primary }} />
            </View>
            <Text style={s.muted}>{setup.done} of {setup.total} steps done{setup.requiredLeft ? ` · ${setup.requiredLeft} required left` : ''}</Text>
            {setup.next[0] && <Text style={{ marginTop: 6 }}>Next: <Text style={{ fontWeight: '600' }}>{setup.next[0].title}</Text></Text>}
            <View style={{ marginTop: 10 }}><Button label="Continue on the website" variant="secondary" onPress={() => void Linking.openURL(`${SITE_URL}/app/${workplace.slug}/setup`)} /></View>
          </Card>
        )}
        {!workplace?.employeeId ? (
          <Card><Text style={s.muted}>Your HR team hasn’t linked an employee profile to your account yet.</Text></Card>
        ) : (
          <Card title="Attendance">
            <Button label={checkedIn ? 'Check out' : 'Check in'} busy={busy} onPress={() => void punch()} />
            {needsSelfie && <Text style={[s.muted, { marginTop: 6 }]}>📸 Your company asks for a selfie with each check-in and check-out.</Text>}
            <View style={{ height: 8 }} />
            <Button label="Correct a day · Work from home · On duty" variant="secondary" onPress={() => router.push('/(app)/requests')} />
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
        <Card title="Upcoming holidays">
          {holidays.length === 0 && <Text style={s.muted}>No upcoming holidays.</Text>}
          {holidays.map((h) => (
            <View key={h.holiday_date + h.name} style={s.row}>
              <Text>{h.name}{h.is_optional ? ' (optional)' : ''}</Text>
              <Text style={s.muted}>{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${h.holiday_date}T00:00:00Z`))}</Text>
            </View>
          ))}
        </Card>
      </Screen>
    </ScrollView>
  );
}
