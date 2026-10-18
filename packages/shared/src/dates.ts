/**
 * Date-only helpers. HR dates (joining, probation end, date of birth) are calendar dates with no time
 * zone, represented as ISO `YYYY-MM-DD` strings end to end to avoid off-by-one errors from UTC shifts.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseIsoDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function formatIsoDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function mustParse(value: string): CalendarDate {
  const date = parseIsoDate(value);
  if (!date) throw new RangeError(`Invalid ISO date: ${value}`);
  return date;
}

/** Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(value: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError('months must be an integer');
  const { year, month, day } = mustParse(value);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  return formatIsoDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}

export function addDays(value: string, days: number): string {
  const { year, month, day } = mustParse(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

/** Negative if a < b, 0 if equal, positive if a > b. ISO strings compare lexicographically. */
export function compareIsoDates(a: string, b: string): number {
  mustParse(a);
  mustParse(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Completed years between `birthDate` and `onDate`. A 29 Feb birthday is reached on 28 Feb in non-leap years. */
export function ageOn(birthDate: string, onDate: string): number {
  const birth = mustParse(birthDate);
  const on = mustParse(onDate);
  let age = on.year - birth.year;
  const birthdayDay = Math.min(birth.day, daysInMonth(on.year, birth.month));
  if (on.month < birth.month || (on.month === birth.month && on.day < birthdayDay)) age -= 1;
  return age;
}

/** Today's calendar date in an IANA time zone (organizations default to Asia/Kolkata). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The instant a calendar date begins in an IANA time zone (e.g. "visible until the end of 30 Nov in India"). */
export function startOfDayIn(date: string, timeZone: string): Date {
  const { year, month, day } = mustParse(date);
  const guess = Date.UTC(year, month - 1, day);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(instant));
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - instant;
  };
  // Two passes settle the offset across a daylight-saving change.
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}
