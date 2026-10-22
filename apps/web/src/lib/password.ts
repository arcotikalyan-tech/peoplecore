/** Password rules for every PeopleCore account: long enough to resist guessing, and within bcrypt's 72 bytes. */
export const PASSWORD_MIN = 8;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters, with letters and at least one number.`;

/** What's wrong with a new password, or null when it can be used. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > 72) return 'Use at most 72 characters.';
  if (!/\p{L}/u.test(password) || !/[0-9]/.test(password)) return 'Use letters and at least one number.';
  if (/^(.)\1+$/u.test(password)) return 'Don’t repeat one character.';
  return null;
}

/** Supabase Auth's refusals, in words for the person setting the password. */
export function passwordErrorMessage(code: string | undefined, message: string | undefined): string {
  if (code === 'same_password') return 'That’s your current password. Choose a new one.';
  if (code === 'weak_password') return message ? `Choose a stronger password: ${message}` : 'Choose a stronger password.';
  if (code === 'reauthentication_needed' || code === 'session_expired' || code === 'session_not_found') return 'For your security, sign in again and then set the password.';
  return 'The password couldn’t be saved. Try again.';
}
