import Link from 'next/link';
import { PROFILE_ITEMS, profileProgress, type Completeness } from '@/lib/profile-checklist';

/** The employee's profile checklist: a progress bar and each part, linked to where it's filled in. */
export function ProfileChecklist({ base, c }: { base: string; c: Completeness }) {
  const p = profileProgress(c);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Profile complete" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${p.percent}%` }} />
        </div>
        <span className="text-sm font-medium tabular-nums">{p.percent}%</span>
      </div>
      <ul className="divide-y divide-line text-sm" aria-label="Profile checklist">
        {PROFILE_ITEMS.map(([key, label, note, tab]) => (
          <li key={key} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-start gap-2">
              <span aria-hidden className={c[key] ? 'text-success' : 'text-muted'}>{c[key] ? '✓' : '○'}</span>
              <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{note}</span></span>
            </span>
            {c[key] ? <span className="text-xs text-success">Done</span>
              : <Link className="shrink-0 text-xs font-medium text-primary hover:underline" href={`${base}/employees/${c.employee_id}?tab=${tab}`}>Add →</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
