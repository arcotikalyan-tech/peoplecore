/** Only allow same-origin relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(next: unknown, fallback = '/app'): string {
  // Control characters too: browsers drop a tab or newline, so "/\t/evil.example" would become "//evil.example".
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')
      || [...next].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return fallback;
  }
  // Whatever a browser makes of it, it must stay on this site.
  try {
    if (new URL(next, 'https://peoplecore.invalid').origin !== 'https://peoplecore.invalid') return fallback;
  } catch {
    return fallback;
  }
  return next;
}
