import { ButtonLink } from '@/components/ui/button';

/** Deliberately the same for "doesn't exist" and "not allowed", so URLs can't probe other tenants. */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted">This page doesn’t exist, or you don’t have access to it.</p>
        <ButtonLink href="/app" variant="secondary" className="mt-6">
          Back to PeopleCore
        </ButtonLink>
      </div>
    </main>
  );
}
