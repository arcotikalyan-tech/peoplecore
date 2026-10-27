import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import logoMark from '../assets/logo-mark.png';
import { Text } from './text';

export { Text };

/** A few accessible building blocks, matching the web app's tokens (primary, muted, danger). */
export const colors = { bg: '#f8fafc', surface: '#ffffff', fg: '#0f172a', muted: '#64748b', line: '#e2e8f0', primary: '#4f46e5', danger: '#b91c1c', success: '#047857', warning: '#b45309' };

export function Screen({ children }: { children: ReactNode }) {
  return <View style={s.screen}>{children}</View>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {title && <Text style={s.cardTitle} accessibilityRole="header">{title}</Text>}
      {children}
    </View>
  );
}

export function Button({ label, onPress, busy, variant = 'primary', disabled }: { label: string; onPress: () => void; busy?: boolean; variant?: 'primary' | 'secondary'; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.button, variant === 'secondary' && s.buttonSecondary, (pressed || disabled) && { opacity: 0.7 }]}>
      {busy ? <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.primary} /> : <Text style={[s.buttonText, variant === 'secondary' && { color: colors.primary }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...input }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={[s.input, error ? { borderColor: colors.danger } : null]} {...input} />
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

/** A password input with a show / hide button. */
export function PasswordField({ label, error, ...input }: Omit<TextInputProps, 'secureTextEntry'> & { label: string; error?: string | null }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput accessibilityLabel={label} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.muted}
          style={[s.input, { paddingRight: 44 }, error ? { borderColor: colors.danger } : null]} {...input} />
        <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={() => setVisible((v) => !v)}
          hitSlop={8} style={{ position: 'absolute', right: 10, padding: 4 }}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
        </Pressable>
      </View>
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

/** The logo with an arc in its purple, blue and teal turning round it, as on the website. Slower when the phone asks
 * for less motion. */
export function LogoLoader({ label = 'Loading…' }: { label?: string }) {
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
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={s.loader}>
      <View style={s.loaderRing}>
        <View style={[StyleSheet.absoluteFill, s.loaderTrack]} />
        <Animated.View style={[StyleSheet.absoluteFill, s.loaderArc, { transform: [{ rotate }] }]} />
        <Image source={logoMark} style={{ width: 44, height: 44 }} />
      </View>
      <Text style={[s.muted, { fontWeight: '500' }]}>{label}</Text>
    </View>
  );
}

export function Message({ tone, text }: { tone: 'danger' | 'success' | 'muted'; text: string }) {
  return <Text accessibilityLiveRegion="polite" style={{ color: tone === 'danger' ? colors.danger : tone === 'success' ? colors.success : colors.muted, marginVertical: 8 }}>{text}</Text>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 16 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.fg, marginBottom: 8 },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  label: { color: colors.fg, fontSize: 14, fontWeight: '500', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.fg, backgroundColor: '#fff' },
  error: { color: colors.danger, fontSize: 12, marginTop: 4 },
  muted: { color: colors.muted, fontSize: 13 },
  loader: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderRing: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  loaderTrack: { borderRadius: 44, borderWidth: 4, borderColor: colors.line },
  loaderArc: { borderRadius: 44, borderWidth: 4, borderTopColor: '#8b5cf6', borderRightColor: '#1a6dff', borderBottomColor: '#12c9b0', borderLeftColor: 'transparent' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});
