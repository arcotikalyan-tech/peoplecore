import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';
import { clock, duration } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useToday } from '@/lib/today';
import { punchButton, shiftTime } from '@/lib/worked';
import { Banner, Button, Card, EmptyState, IconTile, Pill, ProgressBar, Sheet, space, Text, useTheme, type Tone } from '@/ui';
import { PUNCH_ACTIONS, type PauseKind, type PunchKind } from '@peoplecore/shared/punches';

const STATE: Record<'not_in' | 'in' | 'out', [string, Tone]> = {
  not_in: ['Not checked in', 'neutral'], in: ['Checked in', 'success'], out: ['Checked out', 'info'],
};
const PAUSED: Record<PauseKind, [string, Tone]> = { lunch: ['On lunch', 'warning'], break: ['On a break', 'warning'] };

/**
 * Today's attendance: the shift, the check-in, lunch and breaks, time at work against a full day (the rule's day of
 * work plus its break: 8 hours and an hour is 9 hours at work), and buttons for what can come next: check in; start
 * lunch, start a break or check out; end the lunch or break that's on. Each punch records the location, and a selfie
 * when the rule asks.
 */
export function AttendanceCard() {
  const { workplace, refreshWorkplace } = useSession();
  const { colors } = useTheme();
  const { day, ready, shift, pending, refused, needsSelfie, punching, message, punch, dismiss } = useToday();
  const button = (kind: PunchKind) => punchButton(kind, punching, ready);
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  // Checking out is asked first: a stray tap shouldn't end the day.
  const [confirming, setConfirming] = useState(false);

  if (!workplace?.employeeId) {
    return (
      <Card>
        <EmptyState compact icon="id-card-outline" title="No employee profile yet"
          body="Your HR team hasn’t linked an employee profile to your sign-in. Once they do, you can check in, apply for leave and see your pay."
          action="Check again" onAction={() => void refreshWorkplace()} />
      </Card>
    );
  }
  const [label, tone] = !ready ? ['Loading…', 'neutral' as Tone] : pending.length ? ['Waiting to send', 'warning' as Tone]
    : day.paused ? PAUSED[day.paused] : STATE[day.state];
  const { atWorkMinutes: atWork, fullDayMinutes: fullDay } = day;
  const short = Math.max(0, fullDay - atWork);
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
        <Figure label="Breaks" value={day.breakMinutes ? duration(day.breakMinutes) : '—'} />
        <Figure label={day.lastOut ? 'At work' : 'At work so far'} value={duration(atWork)} />
      </View>
      <ProgressBar value={(atWork / fullDay) * 100} tone={short === 0 ? 'success' : 'primary'}
        label={`${duration(atWork)} of a ${duration(fullDay)} day at work`} />
      <Text variant="caption" tone="muted" style={{ marginTop: 6, marginBottom: space.lg }}>
        {short === 0 ? 'Full day done' : `${duration(short)} to a full day`}
        {day.lastOut ? ` · checked out ${clock(day.lastOut, tz)}` : ''}
      </Text>

      {day.next.includes('out') ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button variant="tonal" {...button('lunch_start')} icon="restaurant-outline" label={PUNCH_ACTIONS.lunch_start}
              onPress={() => void punch('lunch_start')} style={{ flex: 1 }} />
            <Button variant="tonal" {...button('break_start')} icon="cafe-outline" label={PUNCH_ACTIONS.break_start}
              onPress={() => void punch('break_start')} style={{ flex: 1 }} />
          </View>
          <Button size="lg" {...button('out')} icon="log-out-outline" label={PUNCH_ACTIONS.out} onPress={() => setConfirming(true)} />
        </View>
      ) : day.paused ? (
        <Button size="lg" {...button(day.paused === 'lunch' ? 'lunch_end' : 'break_end')} icon={day.paused === 'lunch' ? 'restaurant-outline' : 'cafe-outline'}
          label={PUNCH_ACTIONS[day.paused === 'lunch' ? 'lunch_end' : 'break_end']}
          onPress={() => void punch(day.paused === 'lunch' ? 'lunch_end' : 'break_end')} />
      ) : (
        <Button size="lg" {...button('in')} icon="log-in-outline" label={day.state === 'out' ? 'Check in again' : PUNCH_ACTIONS.in}
          onPress={() => void punch('in')} />
      )}
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
          {`You’ve been at work ${duration(atWork)} today${short > 0 ? `, ${duration(short)} short of a full day` : ''}. You can check in again later.`}
        </Text>
        <View style={{ gap: space.sm }}>
          <Button label="Check out" icon="log-out-outline" onPress={() => { setConfirming(false); void punch('out'); }} />
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
