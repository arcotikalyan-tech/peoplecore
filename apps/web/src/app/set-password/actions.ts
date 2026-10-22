'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/lib/action-state';
import { passwordErrorMessage, passwordProblem } from '@/lib/password';
import { safeNextPath } from '@/lib/safe-redirect';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Sets the signed-in person's password (after an invitation or a reset link), then carries on where they were going. */
export async function setPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const problem = passwordProblem(password);
  if (problem) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { password: problem } };
  if (confirm !== password) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { confirm: 'The two passwords don’t match' } };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/login');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: passwordErrorMessage(error.code, error.message) };
  await flash('Password saved. Use it with your email the next time you sign in.');
  redirect(safeNextPath(formData.get('next')));
}
