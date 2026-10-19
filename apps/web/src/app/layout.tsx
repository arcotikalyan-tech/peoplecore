import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { asTheme, asWeather, COOKIE, themeBootScript } from '@/lib/theme';
// Self-hosted (no build-time or runtime requests to Google Fonts).
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PeopleCore', template: '%s · PeopleCore' },
  description: 'Human resource management for the complete employee lifecycle.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // An explicit light/dark choice renders on the server; "auto" (light by day, dark at night) and the time-of-day
  // scene need the browser's clock, so a tiny script applies them in <head> before the first paint.
  const jar = await cookies();
  const pref = asTheme(jar.get(COOKIE.theme)?.value);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" data-theme={pref === 'auto' ? 'dark' : pref} data-weather={asWeather(jar.get(COOKIE.weather)?.value)} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
