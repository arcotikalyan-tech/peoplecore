import Link from 'next/link';
import { Brand } from '@/components/brand';

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-2">
          <Brand />
          <p>HR, payroll and compliance for Indian teams, in one place.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/features" className="hover:text-fg">Features</Link>
          <Link href="/compliance" className="hover:text-fg">Compliance</Link>
          <Link href="/security" className="hover:text-fg">Security</Link>
          <Link href="/about" className="hover:text-fg">About</Link>
          <Link href="/login" className="hover:text-fg">Sign in</Link>
          <Link href="/signup" className="hover:text-fg">Sign up</Link>
        </nav>
        <p>© {new Date().getFullYear()} PeopleCore</p>
      </div>
    </footer>
  );
}
