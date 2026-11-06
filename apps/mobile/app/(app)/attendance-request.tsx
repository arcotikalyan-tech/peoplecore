import { todayIn } from '@peoplecore/shared/dates';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DateField } from '@/date-field';
import { addDays } from '@/lib/calendar';
import { useCounts } from '@/lib/counts';
import { attendanceRequestProblem, correctionProblem, typedTime } from '@/lib/requests';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { Banner, Button, Field, Page, Segmented, space, Text, useToast } from '@/ui';

type Kind = 'correct' | 'wfh' | 'on_duty';
const KINDS: Array<{ value: Kind; label: string }> = [{ value: 'correct', label: 'Correct a day' }, { value: 'wfh', label: 'Work from home' }, { value: 'on_duty', label: 'On duty' }];

/**
 * Attendance requests (the website's Attendance › Requests): correct a day (a missed or wrong punch) and ask for work
 * from home or on duty. Each goes to the manager for approval; the database applies the organization's limits (how
 * far back, how many a month).
 */
export default function AttendanceRequest() {
  const { workplace } = useSession();
  const toast = useToast();
  const counts = useCounts();
  const params = useLocalSearchParams<{ kind?: string; date?: string }>();
  const today = todayIn(workplace?.timezone ?? 'Asia/Kolkata');
  const emp = workplace?.employeeId;
  const [kind, setKind] = useState<Kind>(params.kind === 'wfh' || params.kind === 'on_duty' ? params.kind : 'correct');
  const [form, setForm] = useState({ date: params.date ?? '', checkIn: '', checkOut: '', start: '', end: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data: daysBack } = useLoad(async () => {
    if (!workplace) return 60;
    const { data } = await supabase.from('attendance_settings').select('regularize_days_back').eq('organization_id', workplace.orgId).maybeSingle();
    return (data as { regularize_days_back?: number } | null)?.regularize_days_back ?? 60;
  }, [workplace]);
  const back = daysBack ?? 60;

  const submit = async () => {
    if (!emp) return;
    setProblem(null);
    if (kind === 'correct') {
      const r = { date: form.date, checkIn: form.checkIn, checkOut: form.checkOut, reason: form.reason };
      const p = correctionProblem(r, today);
      if (p) return setProblem(p);
      setBusy(true);
      const { error } = await supabase.rpc('request_regularization', { p_employee: emp, p_date: r.date, p_in: r.checkIn || undefined, p_out: r.checkOut || undefined, p_reason: r.reason.trim() });
      setBusy(false);
      if (error) return setProblem(error.code === '22023' ? error.message : 'That didn’t work. Try again.');
      toast('Correction requested. Your manager has been asked to approve it.');
    } else {
      const p = attendanceRequestProblem({ start: form.start, end: form.end, reason: form.reason });
      if (p) return setProblem(p);
      setBusy(true);
      const { error } = await supabase.rpc('request_attendance', { p_employee: emp, p_kind: kind, p_start: form.start, p_end: form.end || form.start, p_reason: form.reason.trim() });
      setBusy(false);
      if (error) return setProblem(error.code === '22023' ? error.message : 'That didn’t work. Try again.');
      toast(`${kind === 'wfh' ? 'Work from home' : 'On duty'} requested. Your manager has been asked to approve it.`);
    }
    void counts.refresh();
    if (router.canGoBack()) router.back();
    else router.replace('/attendance');
  };

  if (!emp) return <Page><Banner tone="info" text="Your sign-in isn’t linked to an employee profile yet." /></Page>;
  return (
    <Page keyboard>
      <Segmented value={kind} onChange={(k) => { setKind(k); setProblem(null); }} options={KINDS} />
      {kind === 'correct' ? (
        <View>
          <Text variant="footnote" tone="muted" style={{ marginBottom: space.lg }}>A missed or wrong check-in or check-out, up to {back} days back. Leave a time empty to keep what was recorded. Times are 24-hour: 6:30 pm is 18:30.</Text>
          <DateField label="Day" value={form.date} onChange={(d) => setForm({ ...form, date: d })} min={addDays(today, -back)} max={addDays(today, -1)} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}><Field label="Check-in" value={form.checkIn} onChangeText={(v) => setForm({ ...form, checkIn: typedTime(v) })} placeholder="09:30" keyboardType="number-pad" maxLength={5} /></View>
            <View style={{ flex: 1 }}><Field label="Check-out" value={form.checkOut} onChangeText={(v) => setForm({ ...form, checkOut: typedTime(v) })} placeholder="18:30" keyboardType="number-pad" maxLength={5} /></View>
          </View>
        </View>
      ) : (
        <View>
          <Text variant="footnote" tone="muted" style={{ marginBottom: space.lg }}>
            {kind === 'wfh' ? 'Days you work from home count as present once approved.' : 'Days out for work (a client visit, travel) count as present once approved.'}
          </Text>
          <DateField label="From" value={form.start} onChange={(d) => setForm({ ...form, start: d, end: form.end && form.end < d ? '' : form.end })} />
          <DateField label="To" value={form.end} onChange={(d) => setForm({ ...form, end: d })} min={form.start || undefined} placeholder="Same day" clearable />
        </View>
      )}
      <Field label="Reason" value={form.reason} onChangeText={(v) => setForm({ ...form, reason: v })} placeholder="Shown to your manager" multiline />
      {problem && <Banner tone="danger" text={problem} />}
      <Button label="Send for approval" size="lg" icon="paper-plane-outline" busy={busy} onPress={() => void submit()} />
    </Page>
  );
}
