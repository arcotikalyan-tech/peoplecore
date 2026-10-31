import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { FlashMessage } from '@/components/flash-message';
import { NavLink } from '@/components/nav-link';
import { Badge } from '@/components/ui/surface';
import { readFlash } from '@/server/flash';
import { newRequestCount, requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = { title: { template: '%s · Platform console', default: 'Platform console' } };

const NAV = [
  { href: '/platform', label: 'Overview', exact: true },
  { href: '/platform/organizations', label: 'Organizations' },
  { href: '/platform/plans', label: 'Plans' },
  { href: '/platform/requests', label: 'Sign-up requests', requests: true },
  { href: '/platform/activity', label: 'Activity' },
  { href: '/platform/settings', label: 'Settings' },
] as const;

/** The platform console: tenants, plans and subscriptions, sign-ups, the platform's own activity and settings. */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformAdmin();
  const [requests, flashed] = await Promise.all([newRequestCount(), readFlash()]);
  const links = (compact: boolean) => NAV.map((n) => (
    <NavLink key={n.href} href={n.href} label={n.label} exact={'exact' in n} compact={compact} count={'requests' in n ? requests : undefined} />
  ));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-sidebar lg:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <Brand />
          <Badge tone="primary">Platform</Badge>
        </div>
        <nav aria-label="Platform" className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2">{links(false)}</nav>
        <div className="space-y-2 border-t border-line px-4 py-3 text-sm">
          <p className="truncate text-xs text-muted" title={user.email ?? undefined}>Signed in as {user.email}</p>
          <div className="flex items-center gap-4 text-muted">
            <Link href="/app" className="hover:text-fg">Workspaces</Link>
            <form action="/auth/signout" method="post"><button className="hover:text-fg">Sign out</button></form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-sidebar lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="flex items-center gap-2"><Brand /><Badge tone="primary">Platform</Badge></span>
            <form action="/auth/signout" method="post"><button className="text-sm text-muted hover:text-fg">Sign out</button></form>
          </div>
          <nav aria-label="Platform sections" className="scroll-thin flex gap-1 overflow-x-auto px-3 pb-2">{links(true)}</nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <FlashMessage message={flashed} />
          {children}
        </main>
      </div>
    </div>
  );
}
