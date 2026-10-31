import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

/**
 * The phone's design tokens, the website's (apps/web globals.css): indigo in the light theme, coral in the dark one.
 * Screens use these names, never raw colors, so both themes stay right.
 */
const light = {
  canvas: '#f7f6fb', surface: '#ffffff', subtle: '#f3f2f8', raised: '#ffffff', line: '#e9e7f2', lineStrong: '#d4d1e3',
  fg: '#16161b', muted: '#5f5f6c', faint: '#8e8e9a',
  primary: '#5652e8', primaryFg: '#ffffff', primarySoft: '#ecebff',
  accent: '#5b4ae6', accentSoft: '#eeebfe', brand: '#0a66f0',
  danger: '#c4282d', dangerSoft: '#fdecec', success: '#17803d', successSoft: '#e7f6ec',
  warning: '#a65c00', warningSoft: '#fdf3e2', info: '#1f63c7', infoSoft: '#e8f0fc',
  overlay: 'rgba(22,22,27,0.45)',
};
const dark: typeof light = {
  canvas: '#09090b', surface: '#131317', subtle: '#1b1b21', raised: '#1f1f26', line: '#26262e', lineStrong: '#383842',
  fg: '#f4f4f6', muted: '#9b9ba8', faint: '#6c6c78',
  primary: '#f26b55', primaryFg: '#ffffff', primarySoft: '#3a1a15',
  accent: '#7c6cff', accentSoft: '#221e45', brand: '#4c94ff',
  danger: '#ff6b6b', dangerSoft: '#3b1618', success: '#3fd68b', successSoft: '#11301f',
  warning: '#f6b445', warningSoft: '#352710', info: '#5aa9ff', infoSoft: '#132a45',
  overlay: 'rgba(0,0,0,0.6)',
};
export type Colors = typeof light;
export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';

/** The foreground and soft background of a tone (pills, icon tiles, banners). */
export function toneColors(c: Colors, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'primary': return { fg: c.primary, bg: c.primarySoft };
    case 'success': return { fg: c.success, bg: c.successSoft };
    case 'warning': return { fg: c.warning, bg: c.warningSoft };
    case 'danger': return { fg: c.danger, bg: c.dangerSoft };
    case 'info': return { fg: c.info, bg: c.infoSoft };
    case 'accent': return { fg: c.accent, bg: c.accentSoft };
    default: return { fg: c.muted, bg: c.subtle };
  }
}

/** A 4-point grid. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** The type scale (system font): large titles head a tab, headlines a card, footnotes explain. */
export const type = StyleSheet.create({
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.3 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  title3: { fontSize: 19, lineHeight: 24, fontWeight: '600' },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  figure: { fontSize: 24, lineHeight: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
export type TypeVariant = keyof typeof type;

export type Appearance = 'system' | 'light' | 'dark';
const APPEARANCE = 'appearance';

interface ThemeState {
  colors: Colors;
  scheme: 'light' | 'dark';
  /** What the person chose in Settings › Appearance; "system" follows the phone. */
  appearance: Appearance;
  setAppearance(a: Appearance): void;
}

const ThemeCtx = createContext<ThemeState>({ colors: light, scheme: 'light', appearance: 'system', setAppearance: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [appearance, setChoice] = useState<Appearance>('system');
  useEffect(() => {
    void AsyncStorage.getItem(APPEARANCE).catch(() => null).then((v) => { if (v === 'light' || v === 'dark') setChoice(v); });
  }, []);
  const scheme = appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance;
  const value = useMemo<ThemeState>(() => ({
    colors: scheme === 'dark' ? dark : light, scheme, appearance,
    setAppearance(a) {
      setChoice(a);
      void AsyncStorage.setItem(APPEARANCE, a).catch(() => undefined);
    },
  }), [scheme, appearance]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/** Styles built from the theme's colors, made again only when the theme changes. */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(make: (c: Colors) => T): T {
  const { colors } = useTheme();
  // `make` is a module-level function in every caller, so the colors are the only thing that changes.
  return useMemo(() => StyleSheet.create(make(colors)), [colors]);
}
