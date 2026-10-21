'use client';

import { BrandMark } from '@/components/brand';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, Search, ShieldCheck, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import type { PersonHit } from '@/app/app/[org]/search-actions';
import { NAV_ICONS } from './icons';
import type { NavGroup, NavItem, ViewMode } from './nav-model';
import { ThemeMenu, type Appearance } from './theme-menu';

const YEAR = 60 * 60 * 24 * 365;
const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
};

export interface ShellProps {
  base: string;
  nav: NavGroup[];
  org: { name: string; isDemo: boolean };
  user: { name: string; email: string | null; profileHref: string | null };
  unread: number;
  view: ViewMode;
  canSwitchView: boolean;
  platformAdmin: boolean;
  railInitially: boolean;
  appearance: Appearance;
  search: (q: string) => Promise<PersonHit[]>;
  children: ReactNode;
}

export function AppShell(props: ShellProps) {
  const { base, nav, org, user, unread, view, canSwitchView, platformAdmin, railInitially, appearance, search, children } = props;
  const [rail, setRail] = useState(railInitially);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleRail = () => {
    setRail((r) => {
      setCookie('pc-nav', r ? 'full' : 'rail');
      return !r;
    });
  };

  return (
    <div className={cn('min-h-dvh lg:grid print:block', rail ? 'lg:grid-cols-[68px_minmax(0,1fr)]' : 'lg:grid-cols-[244px_minmax(0,1fr)]')}>
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-sidebar lg:flex print:hidden">
        <Sidebar base={base} nav={nav} rail={rail} org={org} user={user} platformAdmin={platformAdmin} onToggleRail={toggleRail} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="relative flex h-full w-72 flex-col border-r border-line bg-sidebar" onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) setDrawer(false); }}>
            <Sidebar base={base} nav={nav} rail={false} org={org} user={user} platformAdmin={platformAdmin} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-sidebar px-3 sm:px-5 print:hidden">
          <button aria-label="Open menu" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg lg:hidden" onClick={() => setDrawer(true)}>
            <Menu className="size-5" />
          </button>
          <button aria-label={rail ? 'Expand menu' : 'Collapse menu'} aria-expanded={!rail} onClick={toggleRail}
            className="hidden size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg lg:grid">
            <Menu className="size-5" />
          </button>
          <button
            onClick={() => setPalette(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-muted hover:border-line-strong sm:max-w-sm"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">Search people and pages…</span>
            <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] font-medium sm:inline">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {canSwitchView && <ViewSwitch view={view} />}
            <ThemeMenu initial={appearance} />
            <Link href={`${base}/inbox`} aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'} className="relative grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-fg">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            {user.profileHref ? (
              <Link href={user.profileHref} aria-label="My profile" className="rounded-full"><Avatar name={user.name} size="sm" /></Link>
            ) : (
              <Avatar name={user.name} size="sm" />
            )}
          </div>
        </header>

        {org.isDemo && (
          <div role="note" className="border-b border-warning/25 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning print:hidden">
            Demo organization — every person and record here is synthetic.
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      {palette && <CommandPalette base={base} nav={nav} search={search} onClose={() => setPalette(false)} />}
    </div>
  );
}

function Sidebar({ base, nav, rail, org, user, platformAdmin, onToggleRail }: {
  base: string; nav: NavGroup[]; rail: boolean; org: ShellProps['org']; user: ShellProps['user']; platformAdmin: boolean; onToggleRail?: () => void;
}) {
  return (
    <>
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-line', rail ? 'justify-center px-2' : 'px-4')}>
        <BrandMark />
        {!rail && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">People<span className="text-brand">Core</span></p>
            <p className="truncate text-xs text-muted" title={org.name}>{org.name}</p>
          </div>
        )}
      </div>
      <nav aria-label="Main" className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3">
        {nav.map((group, i) => (
          <div key={group.label ?? i} className={cn(i > 0 && 'mt-4')}>
            {group.label && !rail && <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted/70">{group.label}</p>}
            {group.label && rail && i > 0 && <div className="mx-3 mb-2 border-t border-line" />}
            <ul className="space-y-0.5">
              {group.items.map((item) => <li key={item.href}><SideLink item={item} rail={rail} /></li>)}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cn('shrink-0 space-y-1 border-t border-line p-2.5 text-sm', rail && 'flex flex-col items-center')}>
        {!rail && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted" title={user.email ?? undefined}>{user.email}</p>
            </div>
          </div>
        )}
        <div className={cn('flex items-center gap-1', rail ? 'flex-col' : 'justify-between px-1')}>
          <div className={cn('flex items-center gap-3 text-muted', rail && 'flex-col gap-1')}>
            <Link href="/app" className="hover:text-fg" title="Switch organization">{rail ? '⇄' : 'Switch'}</Link>
            <Link href={`${base}/preferences`} className="hover:text-fg" title="My preferences" aria-label="My preferences">{rail ? '⚙' : 'Preferences'}</Link>
            {platformAdmin && <Link href="/platform" className="hover:text-fg" title="Platform console" aria-label="Platform console">{rail ? <ShieldCheck className="size-4" /> : 'Platform'}</Link>}
            <form action="/auth/signout" method="post">
              <button className="hover:text-fg" aria-label="Sign out" title={rail ? 'Sign out' : undefined}>{rail ? <LogOut className="size-4" /> : 'Sign out'}</button>
            </form>
          </div>
          {onToggleRail && (
            <button onClick={onToggleRail} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">
              {rail ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function SideLink({ item, rail }: { item: NavItem; rail: boolean }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = NAV_ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={rail ? item.label : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors',
        rail ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2',
        active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-subtle hover:text-fg',
      )}
    >
      <Icon aria-hidden="true" className="size-[18px] shrink-0" />
      <span className={cn(rail ? 'sr-only' : 'truncate')}>{item.label}</span>
      {item.count ? (
        <span className={cn('rounded-full bg-primary text-[10px] font-semibold tabular-nums text-primary-fg', rail ? 'absolute right-1.5 top-1 px-1' : 'ml-auto px-1.5')} aria-label={`${item.count} unread`}>
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}

function ViewSwitch({ view }: { view: ViewMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (v: ViewMode) => {
    if (v === view) return;
    setCookie('pc-view', v);
    start(() => router.refresh());
  };
  return (
    <div role="group" aria-label="View" className={cn('hidden items-center rounded-lg border border-line bg-surface p-0.5 text-xs font-medium sm:flex', pending && 'opacity-60')}>
      {(['admin', 'self'] as const).map((v) => (
        <button key={v} aria-pressed={view === v} onClick={() => choose(v)}
          className={cn('rounded-md px-2.5 py-1 transition-colors', view === v ? 'bg-subtle text-fg' : 'text-muted hover:text-fg')}>
          {v === 'admin' ? 'Admin' : 'Me'}
        </button>
      ))}
    </div>
  );
}

function CommandPalette({ base, nav, search, onClose }: { base: string; nav: NavGroup[]; search: ShellProps['search']; onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(() => { void search(term).then((hits) => { if (live) setPeople(hits); }); }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [q, search]);

  const pages = useMemo(() => {
    const all = nav.flatMap((g) => g.items);
    const term = q.trim().toLowerCase();
    return (term ? all.filter((i) => i.label.toLowerCase().includes(term)) : all).slice(0, 8);
  }, [nav, q]);
  const results = useMemo<Array<{ key: string; href: string; label: string; meta: string; icon?: NavItem['icon'] }>>(() => [
    ...(q.trim().length < 2 ? [] : people).map((p) => ({ key: `p-${p.id}`, href: `${base}/employees/${p.id}`, label: p.name, meta: p.code })),
    ...pages.map((p) => ({ key: `n-${p.href}`, href: p.href, label: p.label, meta: 'Page', icon: p.icon })),
  ], [people, pages, base, q]);

  const go = useCallback((href: string) => { onClose(); router.push(href); }, [onClose, router]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[index]) go(results[index].href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIndex(0); }} placeholder="Search people by name, code or email, or jump to a page"
            aria-label="Search" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
          <button onClick={onClose} aria-label="Close search" className="grid size-7 place-items-center rounded-md text-muted hover:bg-subtle"><X className="size-4" /></button>
        </div>
        <ul className="scroll-thin max-h-[50vh] overflow-y-auto p-2" role="listbox" aria-label="Results">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{q.trim().length < 2 ? 'Type to search.' : 'Nothing found.'}</li>}
          {results.map((r, i) => {
            const Icon = r.icon ? NAV_ICONS[r.icon] : null;
            return (
              <li key={r.key} role="option" aria-selected={i === index}>
                <button onMouseEnter={() => setIndex(i)} onClick={() => go(r.href)}
                  className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', i === index ? 'bg-subtle' : '')}>
                  {!Icon ? <Avatar name={r.label} size="sm" /> : <span className="grid size-7 place-items-center rounded-full bg-subtle"><Icon className="size-4 text-muted" /></span>}
                  <span className="flex-1 truncate font-medium">{r.label}</span>
                  <span className="text-xs text-muted">{r.meta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
