/** Attendance requests from the phone: the same checks as the website before anything is sent. */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "9:5", "0930" or "09.30" → "09:30"; anything else stays as typed (and fails the check). */
export function normalizeTime(raw: string): string {
  const t = raw.trim().replace('.', ':');
  if (/^\d{4}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2)}`;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]!.padStart(2, '0')}` : t;
}

/** What's wrong with a correction for one day, or null. */
export function correctionProblem(r: { date: string; checkIn: string; checkOut: string; reason: string }, today: string): string | null {
  if (!r.date) return 'Choose the day to correct.';
  if (r.date >= today) return 'You can correct days before today.';
  if (!r.checkIn && !r.checkOut) return 'Give a check-in time, a check-out time, or both.';
  if (r.checkIn && !TIME.test(r.checkIn)) return 'Write the check-in time like 09:30.';
  if (r.checkOut && !TIME.test(r.checkOut)) return 'Write the check-out time like 18:30.';
  // Earlier than check-in is the next morning for a night shift; the server checks the shift.
  if (r.checkIn && r.checkOut && r.checkOut === r.checkIn) return 'Check-out can’t be the same as check-in.';
  if (r.reason.trim().length < 3) return 'Say why the day needs correcting.';
  return null;
}

/** What's wrong with a work from home or on duty request, or null. */
export function attendanceRequestProblem(r: { start: string; end: string; reason: string }): string | null {
  if (!r.start) return 'Choose the first day.';
  if (r.end && r.end < r.start) return 'The last day can’t be before the first.';
  if (r.reason.trim().length < 3) return 'Add a reason.';
  return null;
}
