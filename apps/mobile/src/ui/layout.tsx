import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, toneColors, useTheme } from '../theme';
import { Text, type IconName } from './typography';

/**
 * A screen's scrolling body on the canvas. `tab` screens draw their own large header under the status bar; screens
 * opened from them have the stack's header. Pull to refresh shows the spinner until `onRefresh` finishes.
 */
export function Page({ children, onRefresh, tab, header, keyboard, contentStyle, scroll = true }: {
  children: ReactNode; onRefresh?: () => Promise<unknown>; tab?: boolean; header?: ReactNode; keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>; scroll?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);
  const padding = [{ paddingHorizontal: space.lg, paddingTop: tab ? insets.top + space.sm : space.lg, paddingBottom: space.xxxl + (tab ? 0 : insets.bottom), gap: space.lg }, contentStyle];
  const body = scroll ? (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={padding} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]}
          progressBackgroundColor={colors.surface} progressViewOffset={tab ? insets.top : 0} />
      ) : undefined}>
      {header}
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1, backgroundColor: colors.canvas }, padding]}>{header}{children}</View>;
  if (!keyboard) return body;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.canvas }}>{body}</KeyboardAvoidingView>;
}

/** A tab's large title, a line under it, and actions on the right (the bell, your avatar). */
export function TabHeader({ title, subtitle, right }: { title: string; subtitle?: string | null; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="largeTitle" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{title}</Text>
        {subtitle ? <Text variant="footnote" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right && <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{right}</View>}
    </View>
  );
}

/** Two to four views of one screen ("Approvals · Notifications"), with a count on each when it has one. */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={o.count ? `${o.label}, ${o.count}` : o.label} onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 38, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
              backgroundColor: on ? colors.surface : 'transparent', ...(on ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null) }}>
            <Text variant="footnote" style={{ fontWeight: '600', color: on ? colors.fg : colors.muted }}>{o.label}</Text>
            {!!o.count && (
              <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.primary : colors.lineStrong }}>
                <Text variant="caption" style={{ fontWeight: '700', fontSize: 11, color: on ? colors.primaryFg : colors.fg }}>{o.count > 99 ? '99+' : o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A panel that rises from the bottom (a reason to reject, a confirmation); the back button and a tap outside close it. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay }} />
        <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
          paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: insets.bottom + space.xl }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: space.lg }} />
          <Text variant="title3" accessibilityRole="header" style={{ marginBottom: space.md }}>{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type ToastTone = 'success' | 'danger' | 'info';
const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);
const TOAST_ICON: Record<ToastTone, IconName> = { success: 'checkmark-circle', danger: 'alert-circle', info: 'information-circle' };

/** Short confirmations that slide up and fade ("Leave requested"), read out to screen readers too. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ text: string; tone: ToastTone } | null>(null);
  const shown = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, tone });
    AccessibilityInfo.announceForAccessibility(text);
    Animated.timing(shown, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(shown, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
    }, 3200);
  }, [shown]);
  const value = useMemo(() => show, [show]);
  const t = toast ? toneColors(colors, toast.tone) : null;
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toast && t && (
        <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + 84, opacity: shown,
            transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: scheme === 'dark' ? colors.raised : '#1f1f26',
            borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
            <Ionicons name={TOAST_ICON[toast.tone]} size={20} color={toast.tone === 'success' ? '#3fd68b' : toast.tone === 'danger' ? '#ff6b6b' : '#5aa9ff'} />
            <Text variant="callout" style={{ color: '#f4f4f6', flex: 1, fontWeight: '500' }}>{toast.text}</Text>
          </View>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
