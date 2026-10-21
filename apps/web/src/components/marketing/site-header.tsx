import Link from 'next/link';
import { Brand } from '@/components/brand';
import { buttonClass } from '@/components/ui/button';
import { isSupabaseConfigured } from '@/lib/env';
import { getSessionUser } from '@/server/context';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/security', label: 'Security' },
  { href: '/about', label: 'About' },
];

/** The public website's header: sign in and sign up at the top right (or straight back into the app). */
export async function SiteHeader() {
  const signedIn = isSupabaseConfigured() && Boolean(await getSessionUser());
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="PeopleCore home" className="shrink-0">
          <Brand />
        </Link>
        <nav aria-label="Website" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-subtle hover:text-fg">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/app" className={buttonClass('primary', 'sm')}>Open PeopleCore →</Link>
          ) : (
            <>
              <Link href="/login" className={buttonClass('ghost', 'sm')}>Sign in</Link>
              <Link href="/signup" className={buttonClass('primary', 'sm')}>Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
