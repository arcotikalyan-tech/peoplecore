import type { ReactNode } from 'react';
import { cn } from './cn';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border border-line bg-surface', className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-muted">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div aria-hidden="true" className="mb-3 grid size-10 place-items-center rounded-full bg-subtle text-muted">
        ∅
      </div>
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'danger';
const alertTones: Record<Tone, string> = {
  info: 'border-primary/30 bg-primary-soft text-fg',
  success: 'border-success/30 bg-success-soft text-fg',
  warning: 'border-warning/30 bg-warning-soft text-fg',
  danger: 'border-danger/30 bg-danger-soft text-fg',
};

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-md border px-4 py-3 text-sm', alertTones[tone])}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-1', 'text-muted')}>{children}</div>}
    </div>
  );
}

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'ai';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-subtle text-muted ring-line',
  primary: 'bg-info-soft text-info ring-info/20',
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  ai: 'bg-ai-soft text-ai ring-ai/20',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', badgeTones[tone])}>
      {children}
    </span>
  );
}

/** Key/value list for record details. */
export function DetailList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-1 truncate text-sm text-fg">{item.value ?? <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
