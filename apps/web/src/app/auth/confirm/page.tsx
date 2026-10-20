import { safeNextPath } from '@/lib/safe-redirect';
import { CompleteSignIn } from './complete-sign-in';

/**
 * Landing for email links that carry the session in the URL fragment (Supabase's default invitation template
 * uses the implicit flow). The server can't see a fragment, so /auth/callback forwards here and the browser
 * finishes the sign-in. Links from our own templates (token_hash) and PKCE links never come here.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <CompleteSignIn next={safeNextPath(next)} />;
}
