import { Pressable, View } from 'react-native';
import { isoDate, monthGrid } from '@/lib/calendar';
import { space, Text, toneColors, useTheme, type Tone } from '@/ui';

export const DAY_STATUS: Record<string, { label: string; tone: Tone }> = {
  present: { label: 'Present', tone: 'success' }, wfh: { label: 'Work from home', tone: 'success' }, on_duty: { label: 'On duty', tone: 'success' },
  half_day: { label: 'Half day', tone: 'warning' }, absent: { label: 'Absent', tone: 'danger' }, on_leave: { label: 'On leave', tone: 'info' },
  holiday: { label: 'Holiday', tone: 'accent' }, weekly_off: { label: 'Weekly off', tone: 'neutral' }, not_marked: { label: 'Not marked', tone: 'neutral' },
};
const LEGEND: Array<[string, Tone]> = [['Present', 'success'], ['Half day', 'warning'], ['Absent', 'danger'], ['Leave', 'info'], ['Holiday', 'accent']];
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * A month of days, each tinted by its attendance status, today ringed and the chosen day filled. Status is also in
 * each day's spoken label, never color alone.
 */
export function MonthCalendar({ year, month, statuses, today, selected, onSelect }: {
  year: number; month: number; statuses: Record<string, string>; today: string; selected: string | null; onSelect: (iso: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', marginBottom: space.xs }}>
        {WEEKDAYS.map((d, i) => <Text key={i} variant="caption" tone="muted" style={{ flex: 1, textAlign: 'center', fontWeight: '600' }}>{d}</Text>)}
      </View>
      {monthGrid(year, month).map((week, w) => (
        <View key={w} style={{ flexDirection: 'row' }}>
          {week.map((day, i) => {
            if (!day) return <View key={i} style={{ flex: 1, height: 44 }} />;
            const iso = isoDate(year, month, day);
            const status = statuses[iso];
            const info = status && iso <= today ? DAY_STATUS[status] : undefined;
            const t = info && info.tone !== 'neutral' ? toneColors(colors, info.tone) : null;
            const chosen = iso === selected;
            const future = iso > today;
            return (
              <Pressable key={i} accessibilityRole="button" accessibilityState={{ selected: chosen }}
                accessibilityLabel={`${day}${info ? `, ${info.label}` : ''}${iso === today ? ', today' : ''}`} onPress={() => onSelect(iso)}
                style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: chosen ? colors.fg : t ? t.bg : 'transparent',
                  borderWidth: iso === today && !chosen ? 1.5 : 0, borderColor: colors.primary }}>
                  <Text variant="callout" style={{ fontWeight: iso === today || chosen ? '700' : '500',
                    color: chosen ? colors.canvas : t ? t.fg : future ? colors.faint : status === 'weekly_off' ? colors.muted : colors.fg }}>{day}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md, justifyContent: 'center' }}>
        {LEGEND.map(([label, tone]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: toneColors(colors, tone).fg }} />
            <Text variant="caption" tone="muted">{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
