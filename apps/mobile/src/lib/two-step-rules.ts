/**
 * When the app asks for a two-step code (the same rule as the website): the session hasn't done the second step yet,
 * and either the organization (or the platform) requires two-step, or the person turned it on for themselves.
 */
export function codeNeeded(s: { currentLevel: string | null | undefined; required: boolean; hasAuthenticator: boolean }): boolean {
  return s.currentLevel !== 'aal2' && (s.required || s.hasAuthenticator);
}

/** A setup key in groups of four, easier to type into an authenticator app by hand. */
export function groupKey(secret: string): string {
  return secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? '';
}
