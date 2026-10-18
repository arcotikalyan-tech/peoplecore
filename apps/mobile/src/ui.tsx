import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});
