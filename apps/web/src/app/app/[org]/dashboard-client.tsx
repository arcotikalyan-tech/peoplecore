'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';

const YEAR = 60 * 60 * 24 * 365;
const setCookie = (name: string, value: string, maxAge: number) => { document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`; };

/** Hides today's summary banner until tomorrow (per browser). */
export function DismissInsight({ today }: { today: string }) {
  const router = useRouter();
  return (
    <button type="button" className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium hover:border-line-strong"
      onClick={() => { setCookie('pc-insight', today, 60 * 60 * 36); router.refresh(); }}>
      Dismiss
    </button>
  );
}

export interface QuickTile { key: string; href: string; label: string; emoji: string; isNew?: boolean }

/** Quick access tiles; "Customisable" lets the person choose which ones show (kept per browser). */
export function QuickAccess({ tiles, chosen }: { tiles: QuickTile[]; chosen: string[] | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState<string[]>(chosen ?? tiles.slice(0, 10).map((t) => t.key));
  const shown = tiles.filter((t) => pick.includes(t.key));
  const save = (next: string[]) => {
    setPick(next);
    setCookie('pc-quick', next.join('.'), YEAR);
  };
  return (
    <section aria-label="Quick access" className="lift-soft rounded-2xl border border-line bg-surface p-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">⚡ Quick Access</h2>
        <button type="button" onClick={() => { if (editing) router.refresh(); setEditing((e) => !e); }} aria-expanded={editing}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          {editing ? 'Done' : 'Customisable'} <Settings2 className="size-3.5" aria-hidden="true" />
        </button>
      </header>
      {editing && (
        <fieldset className="mb-4 rounded-xl border border-dashed border-line p-3">
          <legend className="px-1 text-xs text-muted">Choose the shortcuts you want</legend>
          <div className="flex flex-wrap gap-2">
            {tiles.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs">
                <input type="checkbox" className="accent-primary" checked={pick.includes(t.key)}
                  onChange={(e) => save(e.target.checked ? [...pick, t.key] : pick.filter((k) => k !== t.key))} />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((t) => (
          <li key={t.key}>
            <Link href={t.href} className="lift relative flex flex-col items-center gap-2.5 rounded-xl border border-line bg-subtle/40 px-3 py-4 text-sm font-medium">
              {t.isNew && <span className="absolute right-2 top-2 rounded bg-danger px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">New</span>}
              <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-primary-soft text-xl">{t.emoji}</span>
              {t.label}
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="col-span-full text-sm text-muted">No shortcuts chosen. Use “Customisable” to add some.</li>}
      </ul>
    </section>
  );
}
