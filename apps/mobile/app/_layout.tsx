import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { ThemeProvider, useTheme } from '@/theme';
import { ToastProvider } from '@/ui';

/** Headers, tab bars and screen backgrounds in the app's own colors, light or dark. */
function Themed({ children }: { children: ReactNode }) {
  const { colors, scheme } = useTheme();
  const nav = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, dark: scheme === 'dark', colors: { ...base.colors, primary: colors.primary, background: colors.canvas, card: colors.surface, text: colors.fg, border: colors.line, notification: colors.danger } };
  }, [colors, scheme]);
  return (
    <NavigationTheme value={nav}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </NavigationTheme>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Themed>
        <SessionProvider>
          <ToastProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </SessionProvider>
      </Themed>
    </ThemeProvider>
  );
}
