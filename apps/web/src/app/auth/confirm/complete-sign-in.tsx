'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { publicEnv } from '@/lib/env';
import { emailInToken } from '@/lib/token-email';

/**
 * Finishes a sign-in link, once the person has seen whose account it opens. Without that step anyone could send a link
 * that silently signs someone into the sender's account, and whatever they then typed would land there.
 */
export function CompleteSignIn({ next }: { next: string }) {
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    // Drop the tokens from the address bar (and history) straight away.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (!access_token || !refresh_token) {
      window.location.replace('/login?error=link');
      return;
    }
    // Read from the address bar, which only exists in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokens({ access_token, refresh_token });
  }, []);

  function signIn() {
    if (!tokens) return;
    setBusy(true);
    const { url, publishableKey } = publicEnv();
    // setSession validates the access token with Supabase before storing the session cookies.
    createBrowserClient(url, publishableKey).auth.setSession(tokens).then(({ error }) => {
      if (error) {
        setBusy(false);
        setFailed(true);
      } else window.location.replace(next);
    });
  }

  const email = tokens && emailInToken(tokens.access_token);
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-sm">
      {failed ? <a className="text-primary" href="/login?error=link">That sign-in link is invalid or has expired. Back to sign in</a>
        : !tokens ? <p role="status" className="text-muted">Signing you in…</p>
          : (
            <section aria-labelledby="confirm-h" className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 text-center">
              <h1 id="confirm-h" className="text-lg font-semibold">Continue to PeopleCore</h1>
              <p className="text-muted">This link signs you in as <strong className="break-all text-fg">{email ?? 'the account it was sent to'}</strong>. If that isn’t you, don’t continue.</p>
              <Button className="w-full" onClick={signIn} disabled={busy}>{busy ? 'Signing you in…' : 'Continue'}</Button>
              <a className="block text-primary hover:underline" href="/login">Not you? Back to sign in</a>
            </section>
          )}
    </main>
  );
}
