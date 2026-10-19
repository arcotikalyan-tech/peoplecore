import { cn } from './cn';

/**
 * Small, dependency-free charts drawn as HTML and SVG on the server. Each has a text alternative (the values
 * are in the accessible name), so nothing depends on seeing the picture.
 */

export function BarChart({ data, format = (n) => n.toLocaleString('en-IN'), label, height = 132, empty = 'No data yet.' }: {
  data: Array<{ label: string; value: number | null }>;
  format?: (n: number) => string;
  label: string;
  height?: number;
  empty?: string;
}) {
  const values = data.map((d) => d.value ?? 0);
  const max = Math.max(...values, 0);
  if (max === 0) return <p className="grid place-items-center text-sm text-muted" style={{ height }}>{empty}</p>;
  const summary = data.map((d) => `${d.label}: ${d.value === null ? 'unknown' : format(d.value)}`).join(', ');
  return (
    <figure aria-label={`${label}. ${summary}`} className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => {
        const last = i === data.length - 1;
        const pct = d.value ? Math.max(4, (d.value / max) * 100) : 0;
        return (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5" aria-hidden="true">
            <span className={cn('truncate text-center text-[11px] tabular-nums', last ? 'font-semibold text-fg' : 'text-muted')}>
              {d.value === null ? '—' : format(d.value)}
            </span>
            <div className="relative flex-1">
              <div className={cn('absolute inset-x-0 bottom-0 rounded-md', last ? 'bg-primary' : 'bg-primary/35')} style={{ height: `${pct}%` }} />
            </div>
            <span className={cn('text-center text-[11px]', last ? 'font-semibold text-primary' : 'text-muted')}>{d.label}</span>
          </div>
        );
      })}
    </figure>
  );
}

/** A thin bar split into labelled parts (e.g. present / on leave / absent), with a legend. */
export function SplitBar({ parts, label }: { parts: Array<{ label: string; value: number; tone: 'success' | 'info' | 'danger' | 'warning' | 'muted' }>; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const tones = { success: 'bg-success', info: 'bg-info', danger: 'bg-danger', warning: 'bg-warning', muted: 'bg-line-strong' };
  return (
    <figure aria-label={`${label}. ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
        {total > 0 && parts.map((p) => p.value > 0 && <div key={p.label} className={tones[p.tone]} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', tones[p.tone])} />{p.label} <span className="font-semibold tabular-nums text-fg">{p.value}</span></li>
        ))}
      </ul>
    </figure>
  );
}

/** A small trend line (e.g. the last 7 days under a figure). Decorative: the figure itself carries the value. */
export function Sparkline({ values, tone = 'primary', className }: { values: number[]; tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent'; className?: string }) {
  const stroke = { primary: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)', accent: 'var(--accent)' }[tone];
  const w = 160;
  const h = 26;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${values.length > 1 ? (i / (values.length - 1)) * w : 0},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" className={cn('h-6 w-full', className)}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A ring gauge with a percentage in the middle and a label below. */
export function Ring({ pct, label, tone = 'primary' }: { pct: number; label: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const color = { primary: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)' }[tone];
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <figure className="flex flex-col items-center gap-1.5" aria-label={`${label} ${p}%`}>
      <span className="grid size-[68px] place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${p}%, var(--subtle) 0)` }} aria-hidden="true">
        <span className="grid size-[54px] place-items-center rounded-full bg-surface text-base font-bold tabular-nums">{p}%</span>
      </span>
      <figcaption className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</figcaption>
    </figure>
  );
}
