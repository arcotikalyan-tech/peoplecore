'use client';

import { Button } from '@/components/ui/button';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          PeopleCore couldn’t load this page. Try again; if it keeps happening, contact support
          {error.digest ? <> with reference <code className="text-fg">{error.digest}</code></> : null}.
        </p>
        {/* No reference means it failed in the browser (a browser extension rewriting the page, for example); its message
            says what, and is safe to show: server errors carry a reference instead and their details stay on the server. */}
        {!error.digest && error.message ? (
          <details className="mt-4 text-left text-xs text-muted">
            <summary className="cursor-pointer">Details for support</summary>
            <code className="mt-2 block break-words text-fg">{error.message.slice(0, 300)}</code>
          </details>
        ) : null}
        <Button className="mt-6" variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
