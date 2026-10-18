'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from './ui/cn';

export function NavLink({ href, label, exact = false, compact = false, count }: { href: string; label: string; exact?: boolean; compact?: boolean; count?: number }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md text-sm font-medium transition-colors',
        compact ? 'whitespace-nowrap px-3 py-1.5' : 'flex items-center justify-between px-3 py-2',
        active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-subtle hover:text-fg',
      )}
    >
      {label}
      {count ? (
        <span className="ml-2 rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-fg" aria-label={`${count} unread`}>{count}</span>
      ) : null}
    </Link>
  );
}
