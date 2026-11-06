/** The email a sign-in token is for, to show the person before it's used. Only for display: Supabase checks the token. */
export function emailInToken(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const email = (JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown }).email;
    return typeof email === 'string' && email ? email : null;
  } catch {
    return null;
  }
}
