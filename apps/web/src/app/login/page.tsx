import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AuthLayout } from '@/components/marketing/auth-layout';
import { Alert } from '@/components/ui/surface';
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
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your PeopleCore workspace."
      footer={<>New to PeopleCore? <Link href="/signup" className="font-medium text-primary hover:underline">Sign up</Link></>}
    >
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
    </AuthLayout>
  );
}
