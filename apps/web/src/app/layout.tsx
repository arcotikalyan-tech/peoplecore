import type { Metadata } from 'next';
import { cookies } from 'next/headers';
// Self-hosted (no build-time or runtime requests to Google Fonts).
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PeopleCore', template: '%s · PeopleCore' },
  description: 'Human resource management for the complete employee lifecycle.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark unless the person chose light (ThemeToggle writes this cookie), set here so the first paint is right.
  const theme = (await cookies()).get('pc-theme')?.value === 'light' ? 'light' : 'dark';
  return (
    <html lang="en" data-theme={theme}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
