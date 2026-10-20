'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useEffect, useState } from 'react';
import { publicEnv } from '@/lib/env';

export function CompleteSignIn({ next }: { next: string }) {
  const [failed, setFailed] = useState(false);
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
    const { url, publishableKey } = publicEnv();
    // setSession validates the access token with Supabase before storing the session cookies.
    createBrowserClient(url, publishableKey).auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setFailed(true);
      else window.location.replace(next);
    });
  }, [next]);
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted">
      {failed ? <a className="text-primary" href="/login?error=link">That sign-in link is invalid or has expired. Back to sign in</a> : <p role="status">Signing you in…</p>}
    </main>
  );
}
