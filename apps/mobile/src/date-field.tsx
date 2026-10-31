import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { isoDate, longDate, monthGrid, monthTitle, shiftMonth } from '@/lib/calendar';
import { radius, space, Text, useTheme } from '@/ui';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A date chosen from a month calendar (no typing); value, min and max are YYYY-MM-DD. */
export function DateField({ label, value, onChange, min, max, placeholder = 'Choose a date', clearable }: {
  label: string; value: string; onChange: (iso: string) => void; min?: string; max?: string; placeholder?: string; clearable?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [[year, month], setMonth] = useState<[number, number]>([0, 0]);
  // Opens on the chosen date, else today (or the nearest allowed day when today is out of range).
  const toggle = () => {
    if (!open) {
      const today = new Date().toISOString().slice(0, 10);
      const start = value || (min && today < min ? min : max && today > max ? max : today);
      setMonth([Number(start.slice(0, 4)), Number(start.slice(5, 7))]);
    }
    setOpen((o) => !o);
  };
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text variant="footnote" style={{ fontWeight: '600', marginBottom: 6 }}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ? longDate(value) : placeholder}`} onPress={toggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: open ? 1.5 : 1, borderColor: open ? colors.primary : colors.lineStrong,
          borderRadius: radius.md, paddingHorizontal: 14, minHeight: 48, backgroundColor: colors.surface }}>
        <Ionicons name="calendar-outline" size={18} color={value ? colors.primary : colors.muted} />
        <Text variant="body" style={{ flex: 1, color: value ? colors.fg : colors.faint }}>{value ? longDate(value) : placeholder}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <View accessibilityLabel={`${label} calendar`} style={{ marginTop: space.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.md, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => setMonth(shiftMonth(year, month, -1))} style={{ padding: 4 }}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </Pressable>
            <Text variant="headline">{monthTitle(year, month)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} onPress={() => setMonth(shiftMonth(year, month, 1))} style={{ padding: 4 }}>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row' }}>{WEEKDAYS.map((d) => <Text key={d} variant="caption" tone="muted" style={{ flex: 1, textAlign: 'center', fontWeight: '600' }}>{d}</Text>)}</View>
          {monthGrid(year, month).map((week, w) => (
            <View key={w} style={{ flexDirection: 'row' }}>
              {week.map((day, i) => {
                if (!day) return <View key={i} style={{ flex: 1, height: 40 }} />;
                const iso = isoDate(year, month, day);
                const off = (!!min && iso < min) || (!!max && iso > max);
                const chosen = iso === value;
                return (
                  <Pressable key={i} accessibilityRole="button" accessibilityLabel={longDate(iso)} accessibilityState={{ disabled: off, selected: chosen }} disabled={off}
                    onPress={() => { onChange(iso); setOpen(false); }} style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: chosen ? colors.primary : 'transparent' }}>
                      <Text variant="callout" style={{ color: chosen ? colors.primaryFg : off ? colors.lineStrong : colors.fg, fontWeight: chosen ? '700' : '500' }}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {clearable && value ? (
            <Pressable accessibilityRole="button" onPress={() => { onChange(''); setOpen(false); }} style={{ alignItems: 'center', paddingTop: space.sm }}>
              <Text variant="footnote" tone="primary" style={{ fontWeight: '600' }}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
