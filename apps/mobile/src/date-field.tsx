import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { isoDate, longDate, monthGrid, monthTitle, shiftMonth } from '@/lib/calendar';
import { colors, s } from '@/ui';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A date chosen from a month calendar (no typing); value, min and max are YYYY-MM-DD. */
export function DateField({ label, value, onChange, min, max, placeholder = 'Choose a date', clearable }: {
  label: string; value: string; onChange: (iso: string) => void; min?: string; max?: string; placeholder?: string; clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [[year, month], setMonth] = useState<[number, number]>([0, 0]);
  // Opens on the chosen date, else the earliest allowed one, else this month.
  const toggle = () => {
    if (!open) {
      const start = value || min || max || new Date().toISOString().slice(0, 10);
      setMonth([Number(start.slice(0, 4)), Number(start.slice(5, 7))]);
    }
    setOpen((o) => !o);
  };
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ? longDate(value) : placeholder}`} onPress={toggle}
        style={[s.input, { justifyContent: 'center' }]}>
        <Text style={{ color: value ? colors.fg : colors.muted, fontSize: 15 }}>{value ? longDate(value) : placeholder}</Text>
      </Pressable>
      {open && (
        <View accessibilityLabel={`${label} calendar`} style={{ marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 8, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} onPress={() => setMonth(shiftMonth(year, month, -1))}><Text style={{ fontSize: 18, color: colors.primary }}>‹</Text></Pressable>
            <Text style={{ fontWeight: '600', color: colors.fg }}>{monthTitle(year, month)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" hitSlop={8} onPress={() => setMonth(shiftMonth(year, month, 1))}><Text style={{ fontSize: 18, color: colors.primary }}>›</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row' }}>{WEEKDAYS.map((d) => <Text key={d} style={[s.muted, { flex: 1, textAlign: 'center' }]}>{d}</Text>)}</View>
          {monthGrid(year, month).map((week, w) => (
            <View key={w} style={{ flexDirection: 'row' }}>
              {week.map((day, i) => {
                if (!day) return <View key={i} style={{ flex: 1, height: 36 }} />;
                const iso = isoDate(year, month, day);
                const off = (!!min && iso < min) || (!!max && iso > max);
                const chosen = iso === value;
                return (
                  <Pressable key={i} accessibilityRole="button" accessibilityLabel={longDate(iso)} accessibilityState={{ disabled: off, selected: chosen }} disabled={off}
                    onPress={() => { onChange(iso); setOpen(false); }}
                    style={{ flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: chosen ? colors.primary : 'transparent' }}>
                    <Text style={{ color: chosen ? '#fff' : off ? colors.line : colors.fg }}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {clearable && value ? <Pressable accessibilityRole="button" onPress={() => { onChange(''); setOpen(false); }} style={{ alignItems: 'center', paddingTop: 6 }}><Text style={{ color: colors.primary }}>Clear</Text></Pressable> : null}
        </View>
      )}
    </View>
  );
}
