import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, toneColors, useStyles, useTheme, type Colors, type Tone } from '../theme';
import { LinkButton } from './button';
import { Text, type IconName } from './typography';

/** A surface on the canvas. Pressable when given onPress. */
export function Card({ children, onPress, padded = true, style, accessibilityLabel }: {
  children: ReactNode; onPress?: () => void; padded?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const st = useStyles(make);
  const { colors } = useTheme();
  if (!onPress) return <View accessibilityLabel={accessibilityLabel} style={[st.card, padded && st.padded, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} android_ripple={{ color: colors.line }}
      style={({ pressed }) => [st.card, padded && st.padded, pressed && { opacity: 0.92 }, style]}>
      {children}
    </Pressable>
  );
}

/** A section's heading above its card: the title, and an action such as "View all" on the right. */
export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm, marginBottom: space.sm, paddingHorizontal: 2 }, style]}>
      <Text variant="headline" accessibilityRole="header">{title}</Text>
      {action && onAction && <LinkButton label={action} onPress={onAction} />}
    </View>
  );
}

/** A rounded square with an icon in a tone's soft color (list rows, quick actions, cards). */
export function IconTile({ icon, tone = 'primary', size = 36 }: { icon: IconName; tone?: Tone; size?: number }) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.52} color={t.fg} />
    </View>
  );
}

/** Rows inside one card, with hairlines between them (settings, profile, lists). */
export function ListGroup({ title, footer, children, style }: { title?: string; footer?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const st = useStyles(make);
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={style}>
      {title && <Text variant="overline" tone="muted" accessibilityRole="header" style={st.groupTitle}>{title}</Text>}
      <View style={st.card}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 && <View style={st.separator} />}
            {row}
          </Fragment>
        ))}
      </View>
      {footer && <Text variant="footnote" tone="muted" style={st.groupFooter}>{footer}</Text>}
    </View>
  );
}

/**
 * One row: an icon, a title with an optional line under it, and on the right a value, a control or a chevron
 * (shown when the row opens something). `external` marks rows that open the website.
 */
export function ListRow({ icon, tone = 'primary', title, subtitle, value, right, onPress, destructive, external, accessibilityLabel, leading }: {
  icon?: IconName; tone?: Tone; title: string; subtitle?: string | null; value?: string | null; right?: ReactNode; onPress?: () => void;
  destructive?: boolean; external?: boolean; accessibilityLabel?: string; leading?: ReactNode;
}) {
  const st = useStyles(make);
  const { colors } = useTheme();
  const body = (
    <>
      {leading ?? (icon && <IconTile icon={icon} tone={destructive ? 'danger' : tone} size={34} />)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" style={destructive ? { color: colors.danger, fontWeight: '600' } : { fontWeight: '500' }} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text variant="footnote" tone="muted" numberOfLines={3}>{subtitle}</Text> : null}
      </View>
      {value ? <Text variant="callout" tone="muted" numberOfLines={1} style={{ maxWidth: '45%', textAlign: 'right' }}>{value}</Text> : null}
      {right}
      {onPress && !right && !destructive && <Ionicons name={external ? 'open-outline' : 'chevron-forward'} size={external ? 16 : 18} color={colors.faint} />}
    </>
  );
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel} style={st.row}>{body}</View>;
  return (
    <Pressable accessibilityRole={external ? 'link' : 'button'} accessibilityLabel={accessibilityLabel ?? title} onPress={onPress}
      android_ripple={{ color: colors.line }} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.subtle }]}>
      {body}
    </Pressable>
  );
}

/** A label and its value side by side, for read-only details. */
export function DetailRow({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  const st = useStyles(make);
  return (
    <View style={[st.detail, last && { borderBottomWidth: 0 }]}>
      <Text variant="callout" tone="muted" style={{ flexShrink: 0 }}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number'
        ? <Text variant="callout" selectable style={{ flex: 1, textAlign: 'right', fontWeight: '500' }}>{value}</Text>
        : <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View>}
    </View>
  );
}

const make = (c: Colors) => ({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: 'hidden' },
  padded: { padding: space.lg },
  groupTitle: { marginBottom: space.sm, marginLeft: space.xs },
  groupFooter: { marginTop: space.sm, marginHorizontal: space.xs },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: 62 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  detail: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line },
} as const);
