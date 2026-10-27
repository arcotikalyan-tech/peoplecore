'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/lib/action-state';
import { passwordErrorMessage, passwordProblem } from '@/lib/password';
import { safeNextPath } from '@/lib/safe-redirect';
import { isRecoverySession } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/**
 * Sets the signed-in person's password (after an invitation or a reset link), then carries on where they were going.
 * Anyone who already has one needs a session from a reset link; other sessions are then signed out.
 */
export async function setPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const problem = passwordProblem(password);
  if (problem) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { password: problem } };
  if (confirm !== password) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { confirm: 'The two passwords don’t match' } };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/login');
  const { data: needsPassword } = await supabase.rpc('my_needs_password');
  const recovery = !needsPassword && (await isRecoverySession());
  if (!needsPassword && !recovery) {
    return { ok: false, message: 'To change your password, use Change password in Preferences (it asks for your current one), or use a reset link.' };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: passwordErrorMessage(error.code, error.message) };
  await supabase.rpc('mark_password_chosen');
  // A reset is often because someone else may know the old password: end every other session.
  if (recovery) await supabase.auth.signOut({ scope: 'others' });
  await flash('Password saved. Use it with your email the next time you sign in.');
  redirect(safeNextPath(formData.get('next')));
}
