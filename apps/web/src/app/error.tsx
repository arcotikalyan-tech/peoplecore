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
        <Button className="mt-6" variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
