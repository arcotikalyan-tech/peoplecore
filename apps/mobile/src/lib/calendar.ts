/** Dates for the phone's date picker: plain YYYY-MM-DD strings, worked out in UTC so the device's zone never shifts a day. */

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The weeks of a month, Monday first; null for the days of the neighbouring months. */
export function monthGrid(year: number, month: number): Array<Array<number | null>> {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** The month before or after, as [year, month]. */
export function shiftMonth(year: number, month: number, by: number): [number, number] {
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Tue, 3 Nov 2026" for a YYYY-MM-DD date (by hand, so every phone shows it the same way). */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCFullYear()}`;
}

export function monthTitle(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}
