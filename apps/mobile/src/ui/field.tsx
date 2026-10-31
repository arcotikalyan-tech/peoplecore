import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { radius, space, useStyles, useTheme, type Colors } from '../theme';
import { Text } from './typography';

/** A labelled text input; its error shows under it and is read out. */
export function Field({ label, error, hint, multiline, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const st = useStyles(make);
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={st.wrap}>
      <Text variant="footnote" style={st.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.faint} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'}
        onFocus={(e) => { setFocused(true); input.onFocus?.(e); }} onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
        {...input}
        style={[st.input, multiline && { minHeight: 96, paddingTop: 12 }, focused && st.focused, error ? { borderColor: colors.danger } : null, input.style]} />
      {error ? <Text variant="caption" tone="danger" style={st.below} accessibilityLiveRegion="polite">{error}</Text>
        : hint ? <Text variant="caption" tone="muted" style={st.below}>{hint}</Text> : null}
    </View>
  );
}

/** A password input with a show / hide button. */
export function PasswordField({ label, error, hint, ...input }: Omit<TextInputProps, 'secureTextEntry'> & { label: string; error?: string | null; hint?: string }) {
  const st = useStyles(make);
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={st.wrap}>
      <Text variant="footnote" style={st.label}>{label}</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput accessibilityLabel={label} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.faint}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} {...input}
          style={[st.input, { paddingRight: 48 }, focused && st.focused, error ? { borderColor: colors.danger } : null]} />
        <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={() => setVisible((v) => !v)}
          hitSlop={8} style={{ position: 'absolute', right: 12, padding: 4 }}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
        </Pressable>
      </View>
      {error ? <Text variant="caption" tone="danger" style={st.below} accessibilityLiveRegion="polite">{error}</Text>
        : hint ? <Text variant="caption" tone="muted" style={st.below}>{hint}</Text> : null}
    </View>
  );
}

/** One choice out of a few, as chips that wrap (leave type, request kind). */
export function Chips<T extends string>({ label, options, value, onChange }: {
  label?: string; options: Array<{ value: T; label: string; note?: string }>; value: T | null; onChange: (v: T) => void;
}) {
  const st = useStyles(make);
  const { colors } = useTheme();
  return (
    <View style={st.wrap}>
      {label && <Text variant="footnote" style={st.label}>{label}</Text>}
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.note ? `${o.label}, ${o.note}` : o.label}
              onPress={() => onChange(o.value)}
              style={{ borderWidth: 1, borderColor: on ? colors.primary : colors.lineStrong, backgroundColor: on ? colors.primarySoft : colors.surface,
                borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' }}>
              <Text variant="callout" style={{ color: on ? colors.primary : colors.fg, fontWeight: on ? '600' : '500' }}>
                {o.label}{o.note ? <Text variant="caption" tone="muted">{`  ${o.note}`}</Text> : null}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const make = (c: Colors) => ({
  wrap: { marginBottom: space.lg },
  label: { fontWeight: '600', marginBottom: 6, color: c.fg },
  input: { borderWidth: 1, borderColor: c.lineStrong, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 48, fontSize: 15, color: c.fg, backgroundColor: c.surface },
  focused: { borderColor: c.primary, borderWidth: 1.5 },
  below: { marginTop: 4 },
} as const);
