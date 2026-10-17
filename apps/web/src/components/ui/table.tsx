import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';

export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('border-b border-line bg-subtle/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted', className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('border-b border-line px-4 py-3 align-middle text-fg', className)}>{children}</td>;
}

/** Page links that preserve the current filters. Server-rendered: works without JavaScript. */
export function Pagination({ page, pageCount, total, hrefFor }: { page: number; pageCount: number; total: number; hrefFor: (page: number) => string }) {
  const linkClass = 'rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-subtle';
  const disabledClass = 'rounded-md border border-line px-3 py-1.5 text-sm text-muted opacity-50';
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
      <span>
        {total.toLocaleString('en-IN')} result{total === 1 ? '' : 's'} · page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link className={linkClass} href={hrefFor(page - 1)} rel="prev">Previous</Link> : <span className={disabledClass}>Previous</span>}
        {page < pageCount ? <Link className={linkClass} href={hrefFor(page + 1)} rel="next">Next</Link> : <span className={disabledClass}>Next</span>}
      </div>
    </nav>
  );
}
