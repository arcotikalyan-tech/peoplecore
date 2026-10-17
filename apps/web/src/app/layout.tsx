import type { Metadata } from 'next';
// Self-hosted (no build-time or runtime requests to Google Fonts).
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PeopleCore', template: '%s · PeopleCore' },
  description: 'Human resource management for the complete employee lifecycle.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
