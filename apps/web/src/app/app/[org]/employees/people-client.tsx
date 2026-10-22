'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { ExternalLink, Mail, Phone } from 'lucide-react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Avatar } from '@/components/ui/avatar';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface Card {
  id: string; name: string; code: string | null; designation: string | null; department: string | null; location: string | null;
  email: string | null; phone: string | null; tenureYears: number; status: string; href: string | null; badge?: string | null;
  birthday?: string | null; maritalStatus?: string | null; social?: Array<[string, string]>;
  /** A link to their profile photo, when they have one. */
  photo?: string | null;
}
export interface Option { value: string; label: string }

/** People as cards or a list, with selection and bulk actions (HR). */
export function PeopleBoard({ cards, view, bulk, options, today }: {
  cards: Card[]; view: 'grid' | 'list'; today: string;
  bulk: Action | null; options: { department: Option[]; location: Option[]; designation: Option[]; manager: Option[] };
}) {
  const [state, formAction] = useActionState(bulk ?? (async () => initialActionState), initialActionState);
  const [picked, setPicked] = useState<string[]>([]);
  const [field, setField] = useState<'department' | 'location' | 'designation' | 'manager'>('department');
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  const check = (c: Card) => bulk && (
    <input type="checkbox" name="employeeId" value={c.id} checked={picked.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)}
      aria-label={`Select ${c.name}`} className="size-4 accent-primary" />
  );
  const actions = (c: Card) => (
    <div className="flex items-center justify-center gap-2">
      {c.email && <a href={`mailto:${c.email}`} aria-label={`Email ${c.name}`} className="grid size-8 place-items-center rounded-full border border-line text-muted hover:text-primary"><Mail className="size-3.5" /></a>}
      {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} aria-label={`Call ${c.name}`} className="grid size-8 place-items-center rounded-full border border-line text-muted hover:text-primary"><Phone className="size-3.5" /></a>}
      {c.href && <Link href={c.href} aria-label={`Open ${c.name}`} className="grid size-8 place-items-center rounded-full border border-line text-muted hover:text-primary"><ExternalLink className="size-3.5" /></Link>}
    </div>
  );
  return (
    <form action={formAction} aria-label="Employees" className="space-y-4">
      <FormMessage state={state} />
      {bulk && picked.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-primary/30 bg-primary-soft/50 p-3 text-sm">
          <span className="self-center font-semibold">{picked.length} selected</span>
          <button name="op" value="confirm" className="h-8 rounded-md border border-line bg-surface px-3 text-xs font-medium">✓ Confirm probation</button>
          <span className="self-center text-muted">or move to</span>
          <select name="field" value={field} onChange={(e) => setField(e.target.value as typeof field)} aria-label="What to change" className="h-8 rounded-md border border-line-strong bg-surface px-2 text-xs">
            <option value="department">Department</option><option value="location">Location</option><option value="designation">Designation</option><option value="manager">Manager</option>
          </select>
          <select name="target" aria-label="New value" className="h-8 max-w-56 rounded-md border border-line-strong bg-surface px-2 text-xs">
            {options[field].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="date" name="effectiveFrom" defaultValue={today} aria-label="Effective from" className="h-8 rounded-md border border-line-strong bg-surface px-2 text-xs" />
          <button name="op" value="move" className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-fg">Apply</button>
          <button type="button" onClick={() => setPicked([])} className="h-8 px-2 text-xs text-muted">Clear</button>
        </div>
      )}
      {view === 'grid' ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {cards.map((c) => (
            <li key={c.id} className="lift relative overflow-hidden rounded-2xl border border-line bg-surface text-center">
              <div className="h-12 bg-primary-soft/60" aria-hidden="true" />
              {bulk && <span className="absolute left-3 top-3">{check(c)}</span>}
              {c.badge && <span className="absolute right-3 top-3 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">{c.badge}</span>}
              <div className="-mt-8 flex justify-center"><Avatar name={c.name} src={c.photo} size="lg" className="size-16 border-4 border-surface text-lg" /></div>
              <div className="px-4 pb-4 pt-2">
                <p className="truncate font-semibold">{c.href ? <Link href={c.href} className="hover:text-primary">{c.name}</Link> : c.name}</p>
                <p className="truncate text-xs text-muted">{[c.designation, c.department].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-1 truncate text-xs text-muted">{[c.location, `${c.tenureYears.toFixed(1)}y`, c.birthday && `🎂 ${c.birthday}`, c.maritalStatus && c.maritalStatus[0]!.toUpperCase() + c.maritalStatus.slice(1)].filter(Boolean).join(' • ')}</p>
                {c.social && c.social.length > 0 && (
                  <p className="mt-1 flex justify-center gap-2 text-xs">{c.social.map(([label, url]) => <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{label}</a>)}</p>
                )}
                <div className="mt-3">{actions(c)}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="lift-soft scroll-thin overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Employees</caption>
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              {bulk && <th className="w-10 px-4 py-2"><input type="checkbox" aria-label="Select all" className="size-4 accent-primary" checked={picked.length === cards.length && cards.length > 0}
                onChange={(e) => setPicked(e.target.checked ? cards.map((c) => c.id) : [])} /></th>}
              <th className="px-4 py-2">Person</th><th>Designation</th><th>Department</th><th>Location</th><th>Tenure</th><th>Status</th><th />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {cards.map((c) => (
                <tr key={c.id} className="hover:bg-subtle/40">
                  {bulk && <td className="px-4">{check(c)}</td>}
                  <td className="px-4 py-2"><span className="flex items-center gap-2.5"><Avatar name={c.name} src={c.photo} size="sm" /><span><span className="block font-medium">{c.href ? <Link href={c.href} className="hover:text-primary">{c.name}</Link> : c.name}</span>{c.code && <span className="text-xs text-muted">{c.code}</span>}</span></span></td>
                  <td>{c.designation ?? '—'}</td><td>{c.department ?? '—'}</td><td>{c.location ?? '—'}</td>
                  <td className="tabular-nums">{c.tenureYears.toFixed(1)}y</td>
                  <td className="text-xs capitalize text-muted">{c.status.replace('_', ' ')}{c.badge ? ` · ${c.badge}` : ''}</td>
                  <td className="pr-4">{actions(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cards.length === 0 && <p className="py-8 text-center text-sm text-muted">No one matches.</p>}
      {bulk && picked.length === 0 && cards.length > 0 && <p className="text-xs text-muted">Select people to confirm probation or move them together.</p>}
    </form>
  );
}

export interface DirectorySettings {
  access: string; show_department: boolean; show_designation: boolean; show_email: boolean; show_phone: boolean; show_location: boolean;
  show_birthday: boolean; show_marital_status: boolean; show_social: boolean;
}

/** Kredily's privacy switches for the directory: who can browse it, and which fields colleagues see. */
export function DirectorySettingsForm({ action, s, canEdit }: { action: Action; canEdit: boolean; s: DirectorySettings }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const rows: Array<[string, string, string, boolean]> = [
    ['department', 'Department', 'Show department in the directory', s.show_department],
    ['designation', 'Designation / role', 'Show job title in the directory', s.show_designation],
    ['email', 'Work email', 'Show official email to employees', s.show_email],
    ['phone', 'Phone number', 'Show phone number to employees', s.show_phone],
    ['location', 'Work location', 'Show office / location in the directory', s.show_location],
    ['birthday', 'Birthday', 'Show day and month of birth on colleagues’ cards, never the year', s.show_birthday],
    ['marital', 'Marital status', 'Show marital status to colleagues', s.show_marital_status],
    ['social', 'Social info', 'Show the LinkedIn, X and website links people add to their profile', s.show_social],
  ];
  return (
    <form action={formAction} aria-label="Privacy & Visibility" className="space-y-1">
      <FormMessage state={state} />
      <fieldset disabled={!canEdit} className="divide-y divide-line">
        <label className="flex items-center justify-between gap-4 py-3">
          <span><span className="block text-sm font-medium">Who can browse the directory</span><span className="block text-xs text-muted">Others see only their own card. HR always sees everyone.</span></span>
          <select name="access" defaultValue={s.access} aria-label="Who can browse the directory" className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
            <option value="everyone">Everyone</option><option value="managers">Managers and HR</option><option value="hr">HR only</option>
          </select>
        </label>
        {rows.map(([name, label, hint, value]) => (
          <label key={name} className="flex cursor-pointer items-center justify-between gap-4 py-3">
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
            <span className="relative inline-flex">
              <input type="checkbox" name={name} defaultChecked={value} className="peer sr-only" role="switch" aria-label={label} />
              <span aria-hidden="true" className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40" />
              <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        ))}
      </fieldset>
      {canEdit ? <div className="pt-3"><SubmitButton size="sm">Save</SubmitButton></div> : <p className="pt-3 text-xs text-muted">Only organization admins can change this.</p>}
    </form>
  );
}

/** Zoom controls around the org chart (−, Fit, +). */
export function ZoomFrame({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2" role="group" aria-label="Zoom">
        <button type="button" onClick={() => setScale((s) => Math.max(0.4, s - 0.1))} aria-label="Zoom out" className="grid size-8 place-items-center rounded-full border border-line bg-surface text-sm">−</button>
        <button type="button" onClick={() => setScale(1)} className="h-8 rounded-full border border-line bg-surface px-3 text-xs font-medium">Fit</button>
        <button type="button" onClick={() => setScale((s) => Math.min(1.6, s + 0.1))} aria-label="Zoom in" className="grid size-8 place-items-center rounded-full border border-line bg-surface text-sm">+</button>
      </div>
      <div className="lift-soft scroll-thin overflow-auto rounded-2xl border border-line bg-surface p-8">
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }} className="transition-transform">{children}</div>
      </div>
    </div>
  );
}
