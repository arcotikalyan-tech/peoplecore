/** Formatting shared by the screens. No React Native imports: tested in Node. */
import { plainSpaces } from './text-weight';

/** "₹1,23,456" (whole rupees, Indian grouping). */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "09:32 am" in the workplace's time zone. */
export const clock = (iso: string | Date, tz: string) =>
  plainSpaces(new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso));

/** "7h 32m", "45m", "0m". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "Good morning" / "Good afternoon" / "Good evening" by the hour in the workplace's zone. */
export function greeting(now: Date, tz: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

/** "Sat, 31 Oct" for a YYYY-MM-DD date. */
export function dayMonth(iso: string): string {
  const d = utc(iso);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The parts of a date tile: "31", "Oct", "Sat". */
export function dateParts(iso: string): { day: string; month: string; weekday: string } {
  const d = utc(iso);
  return { day: String(d.getUTCDate()), month: MONTHS[d.getUTCMonth()]!, weekday: DAYS[d.getUTCDay()]! };
}

/** "3 Nov" or "3 – 5 Nov" or "30 Oct – 2 Nov" (the year only when it isn't this one). */
export function dateRange(start: string, end: string, thisYear: number): string {
  const a = utc(start);
  const b = utc(end);
  const year = (d: Date) => (d.getUTCFullYear() !== thisYear ? ` ${d.getUTCFullYear()}` : '');
  const one = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year(d)}`;
  if (start.slice(0, 10) === end.slice(0, 10)) return one(a);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${a.getUTCDate()} – ${one(b)}`;
  return `${one(a)} – ${one(b)}`;
}

/** "October 2026" for a YYYY-MM-DD (or YYYY-MM) date. */
export function monthYear(iso: string): string {
  const d = utc(iso.length === 7 ? `${iso}-01` : iso);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** "Just now", "5m ago", "3h ago", "Yesterday", "4 Oct". */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return `${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]}${then.getUTCFullYear() !== now.getUTCFullYear() ? ` ${then.getUTCFullYear()}` : ''}`;
}

/** "Today", "Tomorrow" or "Tue, 3 Nov" for a date counted from `today` (both YYYY-MM-DD). */
export function relativeDay(iso: string, today: string): string {
  const days = Math.round((utc(iso).getTime() - utc(today).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return dayMonth(iso);
}

/** Days as people say them: "1 day", "1.5 days", "2 days". */
export const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;

/** The first name, for greetings. */
export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Strips the announcement formatting (**bold**, *italics*, "## ", "- ", [text](link)) for a plain preview. */
export function plainText(body: string): string {
  return body
    .replace(/\[([^\]]+)\]\((https?:[^)]+|mailto:[^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '• ')
    .trim();
}
