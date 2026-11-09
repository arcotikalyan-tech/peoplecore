/** Attendance requests from the phone: the same checks as the website before anything is sent. */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a time field holds as someone types: digits only, the colon added for them, and nothing that can't become a
 * time. A first digit no hour starts with means 0x ("9" is 09), a separator after one digit closes the hour ("1.30" is
 * 01:30; Android's number pad has a few symbols on it), and a digit that can't follow ("25", "09:7") isn't taken.
 */
export function typedTime(raw: string): string {
  let d = raw.replace(/^\D+/, '').replace(/^(\d)\D/, '0$1').replace(/\D/g, '');
  if (/^[3-9]/.test(d)) d = `0${d}`;
  if (Number(d.slice(0, 2)) > 23) d = d.slice(0, 1);
  else if (Number(d[2]) > 5) d = d.slice(0, 2);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2, 4)}` : d;
}

/** What's wrong with a correction for one day, or null. */
export function correctionProblem(r: { date: string; checkIn: string; checkOut: string; reason: string }, today: string): string | null {
  if (!r.date) return 'Choose the day to correct.';
  // Today too (a check-in or check-out missed earlier today); the server refuses times later than now.
  if (r.date > today) return 'You can’t correct a day that hasn’t started yet.';
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
