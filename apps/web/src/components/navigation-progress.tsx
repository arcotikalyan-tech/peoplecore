'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';
import { LogoLoader } from './logo-loader';

/**
 * A thin bar across the top while the app is waiting on the server, so a click never looks ignored. It starts on
 * in-app link clicks, forms the browser submits itself (filters) and every server action (forms and buttons alike,
 * seen by their `next-action` request header), and finishes when the URL changes or the actions have answered. The
 * button that submitted a form is marked `data-busy` meanwhile (dimmed, no second click).
 *
 * When the wait comes from something the person did (a link, a form, a button press) and lasts more than a moment,
 * the page area is also covered by the logo loader. Background calls (search as you type) keep to the bar.
 */

type State = { busy: boolean; cover: boolean };
type Listener = (state: State) => void;
const listeners = new Set<Listener>();
let navigating = false;
let actions = 0;
/** Server actions started by a press rather than by typing or a timer. */
let pressedActions = 0;
let pressedAt = -Infinity;
let graceTimer: ReturnType<typeof setTimeout> | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
const busyButtons = new Set<HTMLElement>();

function reset() {
  navigating = false;
  actions = 0;
  pressedActions = 0;
  clearGrace();
}

function emit() {
  const busy = navigating || actions > 0 || graceTimer !== undefined;
  if (!busy) {
    for (const b of busyButtons) b.removeAttribute('data-busy');
    busyButtons.clear();
    clearTimeout(safetyTimer);
    safetyTimer = undefined;
  } else if (!safetyTimer) {
    // Never spin forever (an aborted navigation, a link back to the same page).
    safetyTimer = setTimeout(() => { reset(); safetyTimer = undefined; emit(); }, 20_000);
  }
  document.documentElement.toggleAttribute('data-navigating', busy);
  const state = { busy, cover: navigating || pressedActions > 0 };
  for (const l of listeners) l(state);
}

function clearGrace() {
  clearTimeout(graceTimer);
  graceTimer = undefined;
}

/** For code that navigates with router.push (no link click to see). */
export function startNavigationProgress() {
  navigating = true;
  emit();
}

function finishNavigation() {
  navigating = false;
  emit();
}

function isAction(input: RequestInfo | URL, init?: RequestInit) {
  const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  return headers ? new Headers(headers).has('next-action') : false;
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;

  const original = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (!isAction(input, init)) return original.call(this, input, init);
    const pressed = performance.now() - pressedAt < 1000;
    actions += 1;
    if (pressed) pressedActions += 1;
    clearGrace();
    emit();
    return original.call(this, input, init).finally(() => {
      actions = Math.max(0, actions - 1);
      if (pressed) pressedActions = Math.max(0, pressedActions - 1);
      emit();
    });
  };

  // A press (button, link, menu item) is what the person waits on; typing is not.
  window.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('button, a[href], [role="button"], [role="menuitem"], [role="option"], input[type="submit"], input[type="checkbox"], input[type="radio"]')) pressedAt = performance.now();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) pressedAt = -Infinity;
  }, true);

  // Window, bubble phase: after React's own handlers, so a Next <Link> has already claimed the click (preventDefault).
  // A plain <a> (a file download, another site) is left to the browser.
  window.addEventListener('click', (e) => {
    if (!e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self')) return;
    const url = new URL(a.href, location.href);
    // Same page (or only the #hash changed): nothing to wait for.
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
    startNavigationProgress();
  });

  window.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    const submitter = e.submitter as HTMLElement | null;
    if (form.target && form.target !== '_self') return;
    pressedAt = performance.now();
    if (submitter) {
      submitter.setAttribute('data-busy', '');
      busyButtons.add(submitter);
    }
    // A form the browser submits itself (filters) loads a new page, unless it is a file (`data-download`). A
    // server-action form shows up as a fetch a moment later. Anything else (a client-only handler) gets a short
    // grace period and then clears.
    if (!e.defaultPrevented && !submitter?.closest('[data-download]') && !form.hasAttribute('data-download')) {
      startNavigationProgress();
      return;
    }
    clearGrace();
    graceTimer = setTimeout(() => { graceTimer = undefined; emit(); }, 600);
    emit();
  });

  // Back to a page the browser kept in memory: it still shows the moment it was left.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    reset();
    emit();
  });
}

/** The page area to cover: the column beside the sidebar, below the header; the whole window elsewhere. */
function coverBox(): CSSProperties {
  const main = document.getElementById('main');
  if (!main) return { inset: 0 };
  const column = (main.parentElement ?? main).getBoundingClientRect();
  return { left: Math.max(0, column.left), right: 0, top: Math.max(0, main.getBoundingClientRect().top), bottom: 0 };
}

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [{ busy, cover }, setState] = useState<State>({ busy: false, cover: false });
  const [shown, setShown] = useState(false);
  const [covered, setCovered] = useState<CSSProperties | null>(null);

  useEffect(() => {
    install();
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);

  // The logo over the page only once a wait is noticeable, so quick clicks never flash it.
  useEffect(() => {
    if (!cover) return;
    const t = setTimeout(() => setCovered(coverBox()), 300);
    return () => { clearTimeout(t); setCovered(null); };
  }, [cover]);

  // The new page is on screen.
  useEffect(() => { finishNavigation(); }, [pathname, search]);

  // Wait a beat before showing, so instant (prefetched) navigations don't flash; linger briefly at 100% on finish.
  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => setShown(true), 120);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown(false), 250);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <>
      {shown && (
        <div role="progressbar" aria-label="Loading" aria-busy={busy} className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden">
          <div className={busy ? 'pc-progress h-full bg-primary' : 'h-full w-full bg-primary opacity-0 transition-opacity duration-200'} />
        </div>
      )}
      {covered && <div data-testid="loading-cover" className="pc-cover" style={covered}><LogoLoader /></div>}
    </>
  );
}
