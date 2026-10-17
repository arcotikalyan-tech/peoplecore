import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { Alert, Card } from '@/components/ui/surface';
import { isSupabaseConfigured } from '@/lib/env';
import { safeNextPath } from '@/lib/safe-redirect';
import { getSessionUser } from '@/server/context';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  const configured = isSupabaseConfigured();
  if (configured && (await getSessionUser())) redirect(nextPath);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Brand />
          <h1 className="mt-6 text-xl font-semibold tracking-tight">Sign in to your workspace</h1>
          <p className="mt-1 text-sm text-muted">Accounts are created by your organization’s administrator.</p>
        </div>
        <Card className="p-6">
          {!configured ? (
            <Alert tone="warning" title="Supabase isn’t configured yet">
              Copy <code>.env.example</code> to <code>apps/web/.env.local</code> and add your PeopleCore Supabase project URL and anon
              key. See the README for setup steps.
            </Alert>
          ) : (
            <div className="space-y-4">
              {error && <Alert tone="danger" title="That sign-in link is invalid or has expired." />}
              <LoginForm next={nextPath} />
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
