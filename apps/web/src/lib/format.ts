/** Date-only values (YYYY-MM-DD) are formatted in UTC so they never shift by a day. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

export function humanize(key: string): string {
  const s = key.replace(/_id$/, '').replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
