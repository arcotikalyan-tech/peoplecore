import type { ReactNode } from 'react';
import type { StructureCalc } from '@peoplecore/payroll/structure';
import type { getOrgContext } from '@/server/context';
import type { monthRun } from '@/server/payroll-suite';

export type Run = Awaited<ReturnType<typeof monthRun>>;

/** What every payroll tab receives from the page. */
export interface TabProps {
  ctx: Awaited<ReturnType<typeof getOrgContext>>;
  slug: string;
  base: string;
  month: string;   // YYYY-MM-01
  today: string;
  run: Run;
  prepares: boolean;
  approves: boolean;
  sp: Record<string, string | undefined>;
}

export const STEPS = ['Pre-check', 'Inputs', 'Calculate', 'Approve', 'Disburse'] as const;

/** Where a month's cycle stands: Kredily's 5 steps. */
export function cycleState(run: Run) {
  if (!run) return { step: 1, label: 'Not started', title: 'Payroll not started' };
  switch (run.status) {
    case 'draft': return { step: 2, label: 'In Progress', title: 'Payroll in progress' };
    case 'computed': return { step: 3, label: 'In Progress', title: 'Payroll in progress' };
    case 'approved': return { step: 4, label: 'Approved', title: 'Payroll approved' };
    case 'locked': return { step: 5, label: 'Completed', title: 'Payroll completed' };
    default: return { step: 1, label: 'Not started', title: 'Payroll not started' };
  }
}

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
/** ₹2.56 L / ₹1.2 Cr, as Kredily shows big figures. */
export function lakhs(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return inr.format(n);
}

export function Figure({ label, value, note, tone = 'fg' }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'fg' | 'primary' | 'success' | 'warning' | 'danger' }) {
  const t = { fg: 'text-fg', primary: 'text-primary', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }[tone];
  return (
    <div className="lift rounded-2xl border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${t}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`lift-soft rounded-2xl border border-line bg-surface p-5 ${className}`} aria-label={title}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ tone = 'muted', children }: { tone?: 'muted' | 'success' | 'warning' | 'danger' | 'primary' | 'info'; children: ReactNode }) {
  const t = { muted: 'bg-subtle text-muted', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', primary: 'bg-primary-soft text-primary', info: 'bg-info-soft text-info' }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

export const qs = (base: string, params: Record<string, string | undefined>) =>
  `${base}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as Array<[string, string]>).toString()}`;

/** A structure line's formula, as Kredily shows it (GROSS × 0.4, BASIC × 0.4, BALANCING AMOUNT OF GROSS). */
export const calcText = (calc: StructureCalc, value: number) =>
  calc === 'percent_of_gross' ? `GROSS × ${value / 100}` : calc === 'percent_of_basic' ? `BASIC × ${value / 100}` : calc === 'fixed' ? (value ? inr.format(value) : '0') : 'BALANCING AMOUNT OF GROSS';
