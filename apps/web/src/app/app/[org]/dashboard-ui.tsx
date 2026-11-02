import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

/** Building blocks shared by the dashboard and the role desks on it. */

export const shortDay = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const shortMonth = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export function monthName(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}
export const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `₹${Math.round(n / 1e3)}K` : `₹${n.toLocaleString('en-IN')}`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const KPI_TONES = { primary: 'text-primary', success: 'text-success', info: 'text-info', warning: 'text-warning', danger: 'text-danger' } as const;
export type KpiTone = keyof typeof KPI_TONES;

export function Kpi({ label, value, note, tone, href }: { label: string; value: string; note: string; tone: KpiTone; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('mt-2 text-[26px] font-bold leading-none tabular-nums tracking-tight', KPI_TONES[tone])}>{value}</p>
      <p className="mt-2 truncate text-xs text-muted">{note}</p>
    </>
  );
  const cls = 'lift block rounded-2xl border border-line bg-surface p-4';
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Card({ title, meta, badge, action, flush, children }: { title: string; meta?: string; badge?: string; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title.replace(/^\W+\s*/u, '')} className="lift-soft rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">{title}
          {badge && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success">{badge}</span>}
        </h2>
        {action ?? (meta && <span className="text-xs text-muted">{meta}</span>)}
      </header>
      <div className={flush ? 'pb-2 pt-2' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}

export const CardLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-sm font-medium text-primary hover:underline">{children}</Link>
);

const TODO_TONES = { warning: 'text-warning', danger: 'text-danger', primary: 'text-primary', muted: 'text-muted' } as const;

/**
 * One line of a desk's to-do list: what, how many, and where to act. Lines with nothing to do are dimmed, not hidden,
 * so the list reads the same every day.
 */
export function TodoRow({ label, count, href, note, tone = 'warning' }: { label: string; count: number; href: string; note?: string; tone?: keyof typeof TODO_TONES }) {
  return (
    <li>
      <Link href={href} className={cn('flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle', !count && 'text-muted')}>
        <span className="min-w-0"><span className="block truncate">{label}</span>{note && <span className="block truncate text-xs text-muted">{note}</span>}</span>
        <span className={cn('shrink-0 font-semibold tabular-nums', count ? TODO_TONES[tone] : 'text-muted')}>{count}</span>
      </Link>
    </li>
  );
}
