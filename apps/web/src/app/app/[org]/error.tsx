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
      <Button className="mt-6" onClick={reset} variant="secondary">
        Try again
      </Button>
    </Card>
  );
}
