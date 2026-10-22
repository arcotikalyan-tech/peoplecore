import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/marketing/auth-layout';
import { safeNextPath } from '@/lib/safe-redirect';
import { getSessionUser } from '@/server/context';
import { createClient } from '@/server/supabase';
import { SetPasswordForm } from './set-password-form';

export const metadata: Metadata = { title: 'Set your password' };

/**
 * Choosing a password: the first step after accepting an invitation (and for anyone who still has none), or after a
 * "Forgot password" link. Nobody without a password gets into the app until they set one.
 */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const next = safeNextPath(sp.next);
  const supabase = await createClient();
  const { data: needsPassword } = await supabase.rpc('my_needs_password');
  const reset = sp.reason === 'reset';
  if (!needsPassword && !reset) redirect(next);
  return (
    <AuthLayout title={reset ? 'Choose a new password' : 'Welcome to PeopleCore'}
      subtitle={reset ? 'Pick a new password for your account. It replaces the old one straight away.' : 'Set a password for your account. You’ll use it with your email to sign in from now on.'}>
      <SetPasswordForm email={user.email ?? ''} next={next} submit={reset ? 'Save new password' : 'Set password and continue'} />
    </AuthLayout>
  );
}
