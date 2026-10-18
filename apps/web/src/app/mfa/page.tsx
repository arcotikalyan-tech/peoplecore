import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/surface';
import { safeNextPath } from '@/lib/safe-redirect';
import { requireUser } from '@/server/context';
import { createClient } from '@/server/supabase';
import { EnrollPanel, VerifyForm } from './mfa-forms';

export const metadata: Metadata = { title: 'Two-step verification' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await requireUser();
  const nextPath = safeNextPath((await searchParams).next);
  if (user.aal === 'aal2') redirect(nextPath);

  const supabase = await createClient();
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  // The browser's token is still valid but the sign-in was ended on the server (signed out elsewhere, or revoked):
  // offer a fresh sign-in instead of an error. Redirecting to /login would loop, since it trusts the token too.
  const ended = error && (error.status === 401 || error.status === 403 || error.name === 'AuthSessionMissingError');
  if (error && !ended) {
    console.error('mfa.listFactors failed', { name: error.name, status: error.status, code: error.code });
    throw new Error('Failed to load two-step verification settings');
  }
  const factor = factors?.totp[0]; // verified authenticator, if any

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Brand />
          <h1 className="mt-6 text-xl font-semibold tracking-tight">
            {ended ? 'Your sign-in has ended' : factor ? 'Two-step verification' : 'Set up two-step verification'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {ended
              ? 'Please sign in again.'
              : factor
                ? 'Enter the 6-digit code from your authenticator app.'
                : 'Your role in PeopleCore can see sensitive records, so it needs a second sign-in step. Setup takes a minute.'}
          </p>
        </div>
        {!ended && <Card className="p-6">{factor ? <VerifyForm factorId={factor.id} next={nextPath} /> : <EnrollPanel next={nextPath} />}</Card>}
        <form action="/auth/signout" method="post" className="mt-6 text-center">
          <button className={ended ? buttonClass('primary') : 'text-sm text-muted hover:text-fg'}>{ended ? 'Sign in again' : 'Sign out'}</button>
        </form>
      </div>
    </main>
  );
}
