import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { DateField } from '@/date-field';
import { longDate } from '@/lib/calendar';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, colors, Field, LogoLoader, Message, s, Screen, Text } from '@/ui';

interface Balance { leave_type_id: string; name: string; available: number; is_paid: boolean }
interface Request { id: string; leave_type_id: string; start_date: string; end_date: string; days: number; status: string }

const STATUS: Record<string, string> = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

export default function Leave() {
  const { workplace } = useSession();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [type, setType] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const emp = workplace?.employeeId;

  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!emp) { setLoaded(true); return; }
    const [b, r] = await Promise.all([
      supabase.rpc('leave_balances', { p_employee: emp }),
      supabase.from('leave_requests').select('id, leave_type_id, start_date, end_date, days, status').eq('employee_id', emp).order('start_date', { ascending: false }).limit(20),
    ]);
    setBalances(((b.data ?? []) as Balance[]).map((x) => ({ ...x, available: Number(x.available) })));
    setRequests(((r.data ?? []) as Request[]).map((x) => ({ ...x, days: Number(x.days) })));
    setLoaded(true);
  }, [emp]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!emp || !type) return setMessage({ tone: 'danger', text: 'Choose a leave type.' });
    if (!from) return setMessage({ tone: 'danger', text: 'Choose the first day of your leave.' });
    if (to && to < from) return setMessage({ tone: 'danger', text: 'The last day can’t be before the first.' });
    setBusy(true);
    const { error } = await supabase.rpc('apply_leave', { p_employee: emp, p_type: type, p_start: from, p_end: to || from, p_reason: reason || undefined } as never);
    setBusy(false);
    if (error) return setMessage({ tone: 'danger', text: error.code === '22023' ? error.message : 'That didn’t work. Try again.' });
    setMessage({ tone: 'success', text: 'Leave requested. Your manager has been asked to approve it.' });
    setFrom(''); setTo(''); setReason('');
    await load();
  };

  const cancel = async (id: string) => {
    const { error } = await supabase.rpc('cancel_leave', { p_request: id });
    setMessage(error ? { tone: 'danger', text: error.code === '22023' ? error.message : 'Couldn’t cancel.' } : { tone: 'success', text: 'Cancelled.' });
    await load();
  };
  const name = (id: string) => balances.find((b) => b.leave_type_id === id)?.name ?? 'Leave';

  if (!emp) return <Screen><Text style={s.muted}>No employee profile is linked to your account.</Text></Screen>;
  if (!loaded) return <LogoLoader />;
  return (
    <ScrollView>
      <Screen>
        <Card title="Balances">
          {balances.map((b) => (
            <View key={b.leave_type_id} style={s.row}><Text>{b.name}</Text><Text style={{ fontWeight: '600' }}>{b.is_paid ? `${b.available} available` : 'Unpaid'}</Text></View>
          ))}
        </Card>
        <Card title="Request leave">
          <Text style={s.label}>Leave type</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {balances.map((b) => (
              <Pressable key={b.leave_type_id} accessibilityRole="radio" accessibilityState={{ checked: type === b.leave_type_id }} onPress={() => setType(b.leave_type_id)}
                style={{ borderWidth: 1, borderColor: type === b.leave_type_id ? colors.primary : colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: type === b.leave_type_id ? colors.primary : colors.fg }}>{b.name}</Text>
              </Pressable>
            ))}
          </View>
          <DateField label="From" value={from} onChange={(d) => { setFrom(d); if (to && to < d) setTo(''); }} />
          <DateField label="To" value={to} onChange={setTo} min={from || undefined} placeholder="Same day" clearable />
          <Field label="Reason" value={reason} onChangeText={setReason} />
          <Button label="Request leave" busy={busy} onPress={() => void submit()} />
          {message && <Message tone={message.tone} text={message.text} />}
        </Card>
        <Card title="Your requests">
          {requests.length === 0 && <Text style={s.muted}>No requests yet.</Text>}
          {requests.map((r) => (
            <View key={r.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text>{name(r.leave_type_id)} · {r.start_date === r.end_date ? longDate(r.start_date) : `${longDate(r.start_date)} – ${longDate(r.end_date)}`}</Text>
                <Text style={s.muted}>{r.days} day{r.days === 1 ? '' : 's'} · {STATUS[r.status] ?? r.status}</Text>
              </View>
              {(r.status === 'pending' || r.status === 'approved') && <Pressable accessibilityRole="button" accessibilityLabel={`Cancel ${name(r.leave_type_id)} from ${r.start_date}`} onPress={() => void cancel(r.id)}><Text style={{ color: colors.primary }}>Cancel</Text></Pressable>}
            </View>
          ))}
        </Card>
      </Screen>
    </ScrollView>
  );
}
