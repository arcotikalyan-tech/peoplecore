import type { ReactNode } from 'react';
import type { PermissionKey } from '@peoplecore/shared';
import type { OrgContext } from '@/server/context';
import type { getEmployee } from '@/server/employees';
import type { getStructure } from '@/server/structure';

export type Employee = NonNullable<Awaited<ReturnType<typeof getEmployee>>>;

/** What every profile tab gets from the page. */
export interface ProfileProps {
  ctx: OrgContext;
  slug: string;
  /** /app/<org> */
  base: string;
  id: string;
  employee: Employee;
  isSelf: boolean;
  allowed: (key: PermissionKey) => boolean;
  today: string;
  sp: Record<string, string | undefined>;
  /** This profile's URL for a tab (and extra query values). */
  href: (tab: string, extra?: Record<string, string>) => string;
  structure: Awaited<ReturnType<typeof getStructure>>;
  names: Map<string, string>;
}

/** Kredily's profile card: an uppercase title, an optional action, content. */
export function Panel({ title, actions, children, className, label }: { title: string; actions?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label ?? title} className={`lift-soft rounded-2xl border border-line bg-surface ${className ?? ''}`}>
      <header className="flex items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
        {actions}
      </header>
      <div className="pb-2">{children}</div>
    </section>
  );
}

/** Label-over-value grid, Kredily style. */
export function Fields({ items, cols = 3 }: { items: Array<{ label: string; value: ReactNode }>; cols?: 2 | 3 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-4 px-5 py-4 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{i.label}</dt>
          <dd className="mt-1 break-words text-sm">{i.value === null || i.value === undefined || i.value === '' ? '—' : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const tenure = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12, total: months };
};

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
