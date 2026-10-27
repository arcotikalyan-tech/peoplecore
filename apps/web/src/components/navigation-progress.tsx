'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * A thin bar across the top while the app is waiting on the server, so a click never looks ignored. It starts on
 * in-app link clicks, forms the browser submits itself (filters) and every server action (forms and buttons alike,
 * seen by their `next-action` request header), and finishes when the URL changes or the actions have answered. The
 * button that submitted a form is marked `data-busy` meanwhile (dimmed, no second click).
 */

type Listener = (busy: boolean) => void;
const listeners = new Set<Listener>();
let navigating = false;
let actions = 0;
let graceTimer: ReturnType<typeof setTimeout> | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
const busyButtons = new Set<HTMLElement>();

function emit() {
  const busy = navigating || actions > 0 || graceTimer !== undefined;
  if (!busy) {
    for (const b of busyButtons) b.removeAttribute('data-busy');
    busyButtons.clear();
    clearTimeout(safetyTimer);
    safetyTimer = undefined;
  } else if (!safetyTimer) {
    // Never spin forever (an aborted navigation, a link back to the same page).
    safetyTimer = setTimeout(() => { navigating = false; actions = 0; clearGrace(); safetyTimer = undefined; emit(); }, 20_000);
  }
  document.documentElement.toggleAttribute('data-navigating', busy);
  for (const l of listeners) l(busy);
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
    actions += 1;
    clearGrace();
    emit();
    return original.call(this, input, init).finally(() => { actions = Math.max(0, actions - 1); emit(); });
  };

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
    navigating = false;
    actions = 0;
    clearGrace();
    emit();
  });
}

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    install();
    listeners.add(setBusy);
    return () => { listeners.delete(setBusy); };
  }, []);

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

  if (!shown) return null;
  return (
    <div role="progressbar" aria-label="Loading" aria-busy={busy} className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden">
      <div className={busy ? 'pc-progress h-full bg-primary' : 'h-full w-full bg-primary opacity-0 transition-opacity duration-200'} />
    </div>
  );
}
