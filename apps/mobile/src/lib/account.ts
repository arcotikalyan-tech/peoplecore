import { passwordErrorMessage, passwordProblem } from '@peoplecore/shared/password';
import { SITE_URL } from './site';
import { passwordIsRight, supabase } from './supabase';

/** The signed-in person's account on the phone: the same rules and messages as the website. */

export type FieldErrors = Partial<Record<'current' | 'password' | 'confirm' | 'email', string>>;

/** Changes the password after checking the current one; every other device is signed out. */
export async function changePassword(email: string, current: string, password: string, confirm: string): Promise<{ ok: boolean; message: string; fields?: FieldErrors }> {
  const fix = (fields: FieldErrors) => ({ ok: false, message: 'Please fix the highlighted fields.', fields });
  if (!current) return fix({ current: 'Enter your current password' });
  const problem = passwordProblem(password);
  if (problem) return fix({ password: problem });
  if (confirm !== password) return fix({ confirm: 'The two passwords don’t match' });
  if (password === current) return fix({ password: 'Choose a password different from the current one' });
  if (!(await passwordIsRight(email, current))) return fix({ current: 'That isn’t your current password' });
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: passwordErrorMessage(error.code, error.message) };
  await supabase.rpc('mark_password_chosen');
  await supabase.auth.signOut({ scope: 'others' });
  return { ok: true, message: 'Password changed. You’ve been signed out on your other devices.' };
}

/**
 * Emails a link to choose a new password. The link opens the website (on this phone or a computer), which sets the
 * new password; then the person signs in here with it. The same answer whether or not the address has an account.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message: string }> {
  const address = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return { ok: false, message: 'Enter a valid email address.' };
  await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent('/set-password?reason=reset')}` });
  return { ok: true, message: 'If that email has a PeopleCore account, a link to choose a new password is on its way. Open it on this phone or a computer, then sign in here with the new password.' };
}
