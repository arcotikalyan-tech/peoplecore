import { View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, toneColors, useTheme, type Tone } from '../theme';
import { Text } from './typography';

const AVATAR_TONES: Tone[] = ['primary', 'info', 'success', 'warning', 'accent', 'danger'];

/** Initials on a color picked from the name, so a person keeps their color everywhere. */
export function Avatar({ name, size = 40, style }: { name: string | null | undefined; size?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1]![0] : '')).toUpperCase() || '?';
  let hash = 0;
  for (const ch of name ?? '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const t = toneColors(colors, AVATAR_TONES[hash % AVATAR_TONES.length]!);
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: t.fg, fontSize: size * 0.38, lineHeight: size * 0.48, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}

/** A small rounded label in a tone (a request's status, "Optional", "Today"). */
export function Pill({ label, tone = 'neutral', style }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  return (
    <View style={[{ alignSelf: 'flex-start', backgroundColor: t.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }, style]}>
      <Text variant="caption" style={{ color: t.fg, fontWeight: '600' }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const STATUS: Record<string, [string, Tone]> = {
  pending: ['Pending', 'warning'], approved: ['Approved', 'success'], rejected: ['Rejected', 'danger'], cancelled: ['Cancelled', 'neutral'],
  draft: ['Draft', 'neutral'], submitted: ['Submitted', 'info'], paid: ['Paid', 'success'], withdrawn: ['Withdrawn', 'neutral'],
};

/** The status of a request as a pill: pending amber, approved green, rejected red. */
export function StatusPill({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '), 'neutral' as Tone];
  return <Pill label={label} tone={tone} />;
}
