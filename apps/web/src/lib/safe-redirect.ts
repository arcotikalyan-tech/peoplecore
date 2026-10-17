/** Only allow same-origin relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(next: unknown, fallback = '/app'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  return next;
}
