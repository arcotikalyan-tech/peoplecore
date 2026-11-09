'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/surface';

export default function OrgError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        We couldn’t load this page. Try again; if the problem continues, contact support
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
      <Button className="mt-6" onClick={reset} variant="secondary">
        Try again
      </Button>
    </Card>
  );
}
