import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useStyles, useTheme, type Colors } from '../theme';
import { Text, type IconName } from './typography';

export type ButtonVariant = 'primary' | 'tonal' | 'outline' | 'ghost' | 'danger';

/**
 * A button 48 points tall (the touch target guidelines ask for), 52 for a screen's main action and 36 for one
 * inside a row. It never accepts a second press while busy.
 */
export function Button({ label, onPress, busy, disabled, variant = 'primary', size = 'md', icon, style, accessibilityLabel }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg';
  icon?: IconName; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const st = useStyles(make);
  const { colors } = useTheme();
  const fg = variant === 'primary' || variant === 'danger' ? colors.primaryFg : variant === 'tonal' ? colors.primary : variant === 'outline' ? colors.fg : colors.primary;
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: off, busy }}
      onPress={onPress} disabled={off} android_ripple={{ color: colors.line, foreground: true }}
      style={({ pressed }) => [st.base, st[size], st[variant], pressed && st.pressed, disabled && !busy && st.disabled, style]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={st.inner}>
          {icon && <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={fg} />}
          <Text variant={size === 'sm' ? 'footnote' : 'headline'} style={[{ color: fg }, size === 'sm' && { fontWeight: '600' }]} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** A round icon button, with a count on it when there's something new (the bell). */
export function IconButton({ icon, label, onPress, badge, size = 40 }: { icon: IconName; label: string; onPress: () => void; badge?: number; size?: number }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge} new` : label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? colors.line : colors.subtle })}>
      <Ionicons name={icon} size={size * 0.52} color={colors.fg} />
      {!!badge && <CountBadge count={badge} style={{ position: 'absolute', top: -2, right: -2 }} />}
    </Pressable>
  );
}

/** A small red count, capped at 99+. */
export function CountBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View importantForAccessibility="no-hide-descendants" style={[{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.danger,
      alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface }, style]}>
      <Text variant="caption" style={{ color: '#fff', fontSize: 10, lineHeight: 12, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** A text link styled as an action ("View all"). */
export function LinkButton({ label, onPress, tone = 'primary' }: { label: string; onPress: () => void; tone?: 'primary' | 'danger' | 'muted' }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      <Text variant="footnote" tone={tone} style={{ fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const make = (c: Colors) => ({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, overflow: 'hidden' },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sm: { minHeight: 36, paddingHorizontal: 12, borderRadius: radius.sm },
  md: { minHeight: 48 },
  lg: { minHeight: 52 },
  primary: { backgroundColor: c.primary },
  danger: { backgroundColor: c.danger },
  tonal: { backgroundColor: c.primarySoft },
  outline: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.lineStrong },
  ghost: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
} as const);
