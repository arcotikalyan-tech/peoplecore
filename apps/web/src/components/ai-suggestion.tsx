import type { ReactNode } from 'react';
import { cn } from './ui/cn';

/**
 * AI output always renders inside this container (ADR-011) and never looks like a confirmed record: a dashed
 * AI-tinted border and a label saying it is a suggestion to check.
 */
export function AiSuggestion({ title = 'Suggested by AI', note = 'Check it before you rely on it.', className, children, actions }: {
  title?: string;
  note?: string;
  className?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-label={title} className={cn('rounded-lg border border-dashed border-ai/50 bg-ai-soft/40', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ai">
          <span aria-hidden="true">✦</span>{title}
        </p>
        <p className="text-xs text-muted">{note}</p>
      </header>
      <div className="px-4 py-3 text-sm">{children}</div>
      {actions && <footer className="flex flex-wrap items-center gap-2 border-t border-dashed border-ai/30 px-4 py-2">{actions}</footer>}
    </section>
  );
}
