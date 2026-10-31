import { Pressable, View } from 'react-native';
import { IconTile, space, Text, useTheme, type IconName, type Tone } from '@/ui';

export interface QuickAction { key: string; label: string; icon: IconName; tone: Tone; onPress: () => void }

/** Shortcuts as a grid of four across: an icon tile with its name under it. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg }}>
      {actions.map((a) => (
        <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.onPress}
          style={({ pressed }) => ({ width: '25%', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ borderRadius: 16, backgroundColor: colors.surface }}><IconTile icon={a.icon} tone={a.tone} size={50} /></View>
          <Text variant="caption" style={{ textAlign: 'center', fontWeight: '500', paddingHorizontal: 2 }} numberOfLines={2}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A date as a small calendar leaf: the month over the day number. */
export function DateLeaf({ month, day, tone = 'primary' }: { month: string; day: string; tone?: 'primary' | 'accent' | 'success' }) {
  const { colors } = useTheme();
  const fg = tone === 'accent' ? colors.accent : tone === 'success' ? colors.success : colors.primary;
  const bg = tone === 'accent' ? colors.accentSoft : tone === 'success' ? colors.successSoft : colors.primarySoft;
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ width: 44, borderRadius: 10, overflow: 'hidden', backgroundColor: bg, alignItems: 'center', paddingBottom: 4 }}>
      <View style={{ alignSelf: 'stretch', backgroundColor: fg, paddingVertical: 1 }}>
        <Text variant="caption" style={{ color: colors.primaryFg, textAlign: 'center', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>{month}</Text>
      </View>
      <Text variant="title3" style={{ color: fg, fontWeight: '700' }}>{day}</Text>
    </View>
  );
}

/** A figure with its label, for a row of month totals. */
export function Stat({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: Tone }) {
  const { colors } = useTheme();
  const color = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'info' ? colors.info : colors.fg;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, alignItems: 'center', paddingVertical: space.sm }}>
      <Text variant="figure" style={{ color }}>{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
    </View>
  );
}
