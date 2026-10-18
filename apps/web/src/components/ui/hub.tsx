import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Module hubs: a header (title, one line on what the module covers, actions) and a row of tabs. Tabs are links
 * (`?tab=…`), so every tab has its own URL, works without JavaScript and keeps the browser's back button.
 */

export function HubHeader({ title, subtitle, badge, actions }: { title: string; subtitle?: string; badge?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badge && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">{badge}</span>}
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export interface HubTab {
  key: string;
  label: string;
  count?: number | null;
}

export function HubTabs({ base, tabs, current, label, param = 'tab', extra }: {
  base: string; tabs: HubTab[]; current: string; label: string; param?: string; extra?: Record<string, string>;
}) {
  const href = (key: string) => `${base}?${new URLSearchParams({ ...extra, [param]: key }).toString()}`;
  return (
    <nav aria-label={label} className="scroll-thin mb-5 overflow-x-auto">
      <ul className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface p-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link href={href(t.key)} aria-current={active ? 'page' : undefined}
                className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active ? 'bg-subtle text-fg' : 'text-muted hover:text-fg')}>
                {t.label}
                {t.count ? <span className={cn('rounded-full px-1.5 text-[10px] font-semibold tabular-nums', active ? 'bg-primary text-primary-fg' : 'bg-primary-soft text-primary')}>{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Secondary tabs inside a tab (e.g. Logs → Daily / Penalty / Comp-off / Overtime): plain underline style. */
export function SubTabs({ base, tabs, current, label, param = 'view', extra }: {
  base: string; tabs: HubTab[]; current: string; label: string; param?: string; extra?: Record<string, string>;
}) {
  const href = (key: string) => `${base}?${new URLSearchParams({ ...extra, [param]: key }).toString()}`;
  return (
    <nav aria-label={label} className="scroll-thin mb-4 overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-5">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link href={href(t.key)} aria-current={active ? 'page' : undefined}
                className={cn('-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-sm font-medium',
                  active ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')}>
                {t.label}
                {t.count ? <span className="rounded-full bg-subtle px-1.5 text-[10px] font-semibold tabular-nums text-muted">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const STAT_TONES = {
  primary: 'text-primary', success: 'text-success', info: 'text-info', warning: 'text-warning', danger: 'text-danger', accent: 'text-accent', muted: 'text-fg',
} as const;

/** A headline figure card used across hubs. */
export function StatCard({ label, value, note, tone = 'muted', href }: {
  label: string; value: ReactNode; note?: ReactNode; tone?: keyof typeof STAT_TONES; href?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', STAT_TONES[tone])}>{value}</p>
      {note && <p className="mt-1 truncate text-xs text-muted">{note}</p>}
    </>
  );
  const cls = 'block rounded-xl border border-line bg-surface p-4';
  return href ? <Link href={href} className={cn(cls, 'transition-colors hover:border-line-strong')}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A titled panel (the hubs' card). */
export function Panel({ title, meta, action, flush, children, className }: {
  title: string; meta?: ReactNode; action?: ReactNode; flush?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-line bg-surface', className)} aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 className="text-sm font-semibold">{title}{meta && <span className="ml-2 font-normal text-muted">{meta}</span>}</h2>
        {action}
      </header>
      <div className={flush ? 'pb-2 pt-2' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}
