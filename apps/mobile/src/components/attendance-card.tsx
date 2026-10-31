import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';
import { clock, duration } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useToday } from '@/lib/today';
import { shiftTime } from '@/lib/worked';
import { Banner, Button, Card, EmptyState, IconTile, Pill, ProgressBar, Sheet, space, Text, useTheme, type Tone } from '@/ui';

const STATE: Record<'not_in' | 'in' | 'out', [string, Tone]> = {
  not_in: ['Not checked in', 'neutral'], in: ['Checked in', 'success'], out: ['Checked out', 'info'],
};

/**
 * Today's attendance: the shift, check-in and check-out times, hours worked against a full day, and the one button
 * that checks in or out (with location, and a selfie when the rule asks).
 */
export function AttendanceCard() {
  const { workplace } = useSession();
  const { colors } = useTheme();
  const { day, ready, shift, pending, refused, needsSelfie, busy, message, punch, dismiss } = useToday();
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  // Checking out is asked first: a stray tap shouldn't end the day.
  const [confirming, setConfirming] = useState(false);

  if (!workplace?.employeeId) {
    return (
      <Card>
        <EmptyState compact icon="id-card-outline" title="No employee profile yet"
          body="Your HR team hasn’t linked an employee profile to your sign-in. Once they do, you can check in, apply for leave and see your pay." />
      </Card>
    );
  }
  const [label, tone] = !ready ? ['Loading…', 'neutral' as Tone] : pending.length ? ['Waiting to send', 'warning' as Tone] : STATE[day.state];
  const fullDay = shift?.full_day_minutes || 480;
  return (
    <Card accessibilityLabel="Today’s attendance">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconTile icon="finger-print" tone="primary" size={40} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <Text variant="headline">Today</Text>
            <Pill label={label} tone={tone} />
          </View>
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {shift ? `${shift.name} · ${shiftTime(shift.start_time)} – ${shiftTime(shift.end_time)}` : 'Your shift'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginTop: space.lg, marginBottom: space.md }}>
        <Figure label="Check in" value={day.firstIn ? clock(day.firstIn, tz) : '—'} />
        <Figure label="Check out" value={day.lastOut ? clock(day.lastOut, tz) : '—'} />
        <Figure label="Worked" value={duration(day.workedMinutes)} />
      </View>
      <ProgressBar value={(day.workedMinutes / fullDay) * 100} tone={day.workedMinutes >= fullDay ? 'success' : 'primary'}
        label={`${duration(day.workedMinutes)} of a ${duration(fullDay)} day`} />
      <Text variant="caption" tone="muted" style={{ marginTop: 6, marginBottom: space.lg }}>
        {day.workedMinutes >= fullDay ? 'Full day done' : `${duration(fullDay - day.workedMinutes)} to a full day`}
      </Text>

      <Button size="lg" busy={busy || !ready} onPress={() => (day.state === 'in' ? setConfirming(true) : void punch())}
        icon={day.state === 'in' ? 'log-out-outline' : 'log-in-outline'}
        label={day.state === 'in' ? 'Check out' : day.state === 'out' ? 'Check in again' : 'Check in'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm, justifyContent: 'center' }}>
        <Ionicons name={needsSelfie ? 'camera-outline' : 'location-outline'} size={14} color={colors.muted} />
        <Text variant="caption" tone="muted">{needsSelfie ? 'Location and a selfie are recorded with each punch' : 'Your location is recorded with each punch'}</Text>
      </View>
      {message && <Banner tone={message.tone} text={message.text} style={{ marginTop: space.md }} />}
      {refused.map((p) => (
        <View key={p.clientId} style={{ marginTop: space.md, gap: space.sm }}>
          <Banner tone="danger" title={`Not recorded · ${clock(p.punchedAt, tz)}`} text={p.refused ?? ''} />
          <Button label="Dismiss" variant="outline" size="sm" onPress={() => void dismiss(p.clientId)} />
        </View>
      ))}
      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Check out now?">
        <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>
          {`You’ve worked ${duration(day.workedMinutes)} today${day.workedMinutes < fullDay ? `, ${duration(fullDay - day.workedMinutes)} short of a full day` : ''}. You can check in again later.`}
        </Text>
        <View style={{ gap: space.sm }}>
          <Button label="Check out" icon="log-out-outline" onPress={() => { setConfirming(false); void punch(); }} />
          <Button label="Not yet" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="title3" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}
