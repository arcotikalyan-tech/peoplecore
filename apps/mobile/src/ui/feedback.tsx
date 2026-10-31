import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import logoMark from '../../assets/logo-mark.png';
import { radius, space, toneColors, useTheme } from '../theme';
import { Button } from './button';
import { Text, type IconName } from './typography';

export type BannerTone = 'danger' | 'success' | 'warning' | 'info' | 'muted';
const BANNER_ICON: Record<BannerTone, IconName> = {
  danger: 'alert-circle', success: 'checkmark-circle', warning: 'warning', info: 'information-circle', muted: 'information-circle-outline',
};

/** A message in a tinted strip with its icon: what went wrong, what worked, what to know. Read out when it appears. */
export function Banner({ tone, text, title, style }: { tone: BannerTone; text: string; title?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone === 'muted' ? 'neutral' : tone);
  return (
    <View accessibilityLiveRegion="polite" accessible style={[{ flexDirection: 'row', gap: space.sm, backgroundColor: t.bg, borderRadius: radius.md, padding: space.md }, style]}>
      <Ionicons name={BANNER_ICON[tone]} size={18} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {title && <Text variant="callout" style={{ fontWeight: '600', color: tone === 'muted' ? colors.fg : t.fg }}>{title}</Text>}
        <Text variant="callout" style={{ color: tone === 'muted' ? colors.muted : t.fg }}>{text}</Text>
      </View>
    </View>
  );
}

/** What an empty list says: an icon, a line, an optional hint and action. */
export function EmptyState({ icon, title, body, action, onAction, compact }: {
  icon: IconName; title: string; body?: string; action?: string; onAction?: () => void; compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? space.lg : space.xxxl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ width: compact ? 44 : 64, height: compact ? 44 : 64, borderRadius: compact ? 22 : 32, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={compact ? 22 : 30} color={colors.faint} />
      </View>
      <Text variant={compact ? 'callout' : 'headline'} style={{ textAlign: 'center', fontWeight: '600' }}>{title}</Text>
      {body && <Text variant="footnote" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>{body}</Text>}
      {action && onAction && <Button label={action} variant="tonal" size="sm" onPress={onAction} style={{ marginTop: space.xs }} />}
    </View>
  );
}

/** When a screen couldn't load: say so and offer to try again. */
export function ErrorState({ onRetry, text = 'Check your connection and try again.' }: { onRetry: () => void; text?: string }) {
  return <EmptyState icon="cloud-offline-outline" title="Couldn’t load this" body={text} action="Try again" onAction={onRetry} />;
}

function usePulse() {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let stopped = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (stopped || reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => { stopped = true; loop?.stop(); };
  }, [pulse]);
  return pulse;
}

/** A grey placeholder in the shape of what's coming, gently pulsing (still when the phone asks for less motion). */
export function Skeleton({ width = '100%', height = 14, round = radius.sm, style }: { width?: DimensionValue; height?: number; round?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const pulse = usePulse();
  return <Animated.View style={[{ width, height, borderRadius: round, backgroundColor: colors.subtle, opacity: pulse }, style]} />;
}

/** Placeholder cards while a screen's first load is on its way. */
export function SkeletonList({ rows = 3, card = true }: { rows?: number; card?: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel="Loading" accessibilityRole="progressbar"
      style={card ? { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: space.lg, gap: space.lg } : { gap: space.lg }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <Skeleton width={36} height={36} round={10} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={i % 2 ? '55%' : '70%'} />
            <Skeleton width={i % 2 ? '35%' : '45%'} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The logo with an arc in its purple, blue and teal turning round it, as on the website. Slower when the phone asks
 * for less motion. Used while the app starts. */
export function LogoLoader({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let stopped = false;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (stopped) return;
      loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: reduce ? 3000 : 1000, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
    });
    return () => { stopped = true; loop?.stop(); };
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
      style={{ flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.canvas }}>
      <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: 44, borderWidth: 4, borderColor: colors.line }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 44, borderWidth: 4, borderTopColor: '#8b5cf6', borderRightColor: '#1a6dff',
          borderBottomColor: '#12c9b0', borderLeftColor: 'transparent', transform: [{ rotate }] }]} />
        <Image source={logoMark} style={{ width: 44, height: 44 }} />
      </View>
      <Text variant="footnote" tone="muted" style={{ fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

/** A thin bar showing how far along something is (worked hours, profile, setup). */
export function ProgressBar({ value, tone = 'primary', label, height = 6 }: { value: number; tone?: 'primary' | 'success' | 'warning'; label: string; height?: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height, borderRadius: height / 2, backgroundColor: colors.subtle, overflow: 'hidden' }}>
      <View style={{ height, width: `${pct}%`, borderRadius: height / 2, backgroundColor: toneColors(colors, tone).fg }} />
    </View>
  );
}
