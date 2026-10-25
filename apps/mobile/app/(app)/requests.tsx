import { useCallback, useEffect, useState } from 'react';
import { todayIn } from '@peoplecore/shared/dates';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { DateField } from '@/date-field';
import { longDate } from '@/lib/calendar';
import { attendanceRequestProblem, correctionProblem, normalizeTime } from '@/lib/requests';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, colors, Field, Message, s, Screen, Text } from '@/ui';

type Mode = 'correct' | 'wfh' | 'on_duty';
interface Correction { id: string; work_date: string; status: string }
interface Away { id: string; kind: string; start_date: string; end_date: string; status: string }

const STATUS: Record<string, string> = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Attendance requests from the phone (the website's Attendance › Requests): correct a day (a missed or wrong punch)
 * and ask for work from home or on duty. Each goes to the manager for approval, as on the website; the database
 * applies the organization's limits (how far back, how many a month).
 */
export default function Requests() {
  const { workplace } = useSession();
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const emp = workplace?.employeeId;
  const [mode, setMode] = useState<Mode>('correct');
  const [form, setForm] = useState({ date: '', checkIn: '', checkOut: '', start: '', end: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [daysBack, setDaysBack] = useState(60);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [away, setAway] = useState<Away[]>([]);

  const load = useCallback(async () => {
    if (!emp || !workplace) return;
    const [settings, regs, reqs] = await Promise.all([
      supabase.from('attendance_settings').select('regularize_days_back').eq('organization_id', workplace.orgId).maybeSingle(),
      supabase.from('regularization_requests').select('id, work_date, status').eq('employee_id', emp).order('created_at', { ascending: false }).limit(10),
      supabase.from('attendance_requests').select('id, kind, start_date, end_date, status').eq('employee_id', emp).order('created_at', { ascending: false }).limit(10),
    ]);
    setDaysBack((settings.data as { regularize_days_back?: number } | null)?.regularize_days_back ?? 60);
    setCorrections((regs.data ?? []) as Correction[]);
    setAway((reqs.data ?? []) as Away[]);
  }, [emp, workplace]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!emp) return;
    setMessage(null);
    if (mode === 'correct') {
      const r = { date: form.date, checkIn: normalizeTime(form.checkIn), checkOut: normalizeTime(form.checkOut), reason: form.reason };
      const problem = correctionProblem(r, today);
      if (problem) return setMessage({ tone: 'danger', text: problem });
      setBusy(true);
      const { error } = await supabase.rpc('request_regularization', { p_employee: emp, p_date: r.date, p_in: r.checkIn || null, p_out: r.checkOut || null, p_reason: r.reason.trim() } as never);
      setBusy(false);
      if (error) return setMessage({ tone: 'danger', text: error.code === '22023' ? error.message : 'That didn’t work. Try again.' });
      setMessage({ tone: 'success', text: 'Correction requested. Your manager has been asked to approve it.' });
    } else {
      const problem = attendanceRequestProblem({ start: form.start, end: form.end, reason: form.reason });
      if (problem) return setMessage({ tone: 'danger', text: problem });
      setBusy(true);
      const { error } = await supabase.rpc('request_attendance', { p_employee: emp, p_kind: mode, p_start: form.start, p_end: form.end || form.start, p_reason: form.reason.trim() } as never);
      setBusy(false);
      if (error) return setMessage({ tone: 'danger', text: error.code === '22023' ? error.message : 'That didn’t work. Try again.' });
      setMessage({ tone: 'success', text: `${mode === 'wfh' ? 'Work from home' : 'On duty'} requested. Your manager has been asked to approve it.` });
    }
    setForm({ date: '', checkIn: '', checkOut: '', start: '', end: '', reason: '' });
    await load();
  };

  if (!emp) return <Screen><Text style={s.muted}>No employee profile is linked to your account.</Text></Screen>;
  const modes: Array<[Mode, string]> = [['correct', 'Correct a day'], ['wfh', 'Work from home'], ['on_duty', 'On duty']];
  return (
    <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
      <Screen>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {modes.map(([m, label]) => (
            <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: mode === m }} onPress={() => { setMode(m); setMessage(null); }}
              style={{ borderWidth: 1, borderColor: mode === m ? colors.primary : colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: mode === m ? colors.primary : colors.fg }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Card title={mode === 'correct' ? 'Correct a day' : mode === 'wfh' ? 'Work from home' : 'On duty'}>
          {mode === 'correct' ? (
            <>
              <Text style={[s.muted, { marginBottom: 8 }]}>A missed or wrong check-in or check-out, up to {daysBack} days back.</Text>
              <DateField label="Day" value={form.date} onChange={(d) => setForm({ ...form, date: d })} min={addDays(today, -daysBack)} max={addDays(today, -1)} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Check-in" value={form.checkIn} onChangeText={(v) => setForm({ ...form, checkIn: v })} placeholder="09:30" keyboardType="numbers-and-punctuation" /></View>
                <View style={{ flex: 1 }}><Field label="Check-out" value={form.checkOut} onChangeText={(v) => setForm({ ...form, checkOut: v })} placeholder="18:30" keyboardType="numbers-and-punctuation" /></View>
              </View>
            </>
          ) : (
            <>
              <DateField label="From" value={form.start} onChange={(d) => setForm({ ...form, start: d, end: form.end && form.end < d ? '' : form.end })} />
              <DateField label="To" value={form.end} onChange={(d) => setForm({ ...form, end: d })} min={form.start || undefined} placeholder="Same day" clearable />
            </>
          )}
          <Field label="Reason" value={form.reason} onChangeText={(v) => setForm({ ...form, reason: v })} />
          <Button label="Send for approval" busy={busy} onPress={() => void submit()} />
          {message && <Message tone={message.tone} text={message.text} />}
        </Card>
        <Card title="Your requests">
          {corrections.length === 0 && away.length === 0 && <Text style={s.muted}>No requests yet.</Text>}
          {corrections.map((r) => (
            <View key={r.id} style={s.row}><Text>Correction · {longDate(r.work_date)}</Text><Text style={s.muted}>{STATUS[r.status] ?? r.status}</Text></View>
          ))}
          {away.map((r) => (
            <View key={r.id} style={s.row}>
              <Text>{r.kind === 'wfh' ? 'Work from home' : 'On duty'} · {r.start_date === r.end_date ? longDate(r.start_date) : `${longDate(r.start_date)} – ${longDate(r.end_date)}`}</Text>
              <Text style={s.muted}>{STATUS[r.status] ?? r.status}</Text>
            </View>
          ))}
        </Card>
      </Screen>
    </ScrollView>
  );
}
