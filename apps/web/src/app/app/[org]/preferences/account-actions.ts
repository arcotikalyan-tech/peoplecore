'use server';

import { createClient as createPlainClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/action-state';
import { publicEnv } from '@/lib/env';
import { passwordErrorMessage, passwordProblem } from '@/lib/password';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/**
 * Changes the signed-in person's password. The current password is checked first, with a separate client that keeps
 * nothing (this session is untouched); afterwards every other session is signed out.
 */
export async function changePasswordAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const current = String(formData.get('current') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const fix = (field: string, message: string): ActionState => ({ ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { [field]: message } });
  if (!current) return fix('current', 'Enter your current password');
  const problem = passwordProblem(password);
  if (problem) return fix('password', problem);
  if (confirm !== password) return fix('confirm', 'The two passwords don’t match');
  if (password === current) return fix('password', 'Choose a password different from the current one');
  if (!ctx.user.email) return { ok: false, message: 'Your account has no email address to check the password against.' };

  const { url, publishableKey } = publicEnv();
  const check = createPlainClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
  const { error: wrong } = await check.signInWithPassword({ email: ctx.user.email, password: current });
  if (wrong) return fix('current', 'That isn’t your current password');
  await check.signOut({ scope: 'local' }); // end the check's own session

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: passwordErrorMessage(error.code, error.message) };
  await supabase.rpc('mark_password_chosen');
  await supabase.auth.signOut({ scope: 'others' });
  return { ok: true, message: 'Password changed. You’ve been signed out on your other devices.' };
}

/** Ends every session except this one (a lost phone, a shared computer). */
export async function signOutOtherDevicesAction(slug: string): Promise<ActionState> {
  await getOrgContext(slug);
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) return { ok: false, message: 'That didn’t work. Try again.' };
  return { ok: true, message: 'Signed out on your other devices.' };
}

/**
 * Turns off the person's own two-step sign-in (removes their authenticator), unless their organization (or the
 * platform, for administrators) requires it. Removing a verified authenticator needs a two-step session.
 */
export async function turnOffTwoStepAction(slug: string): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: required, error: checkFailed } = await supabase.rpc('my_mfa_requirement');
  if (checkFailed) return { ok: false, message: 'That didn’t work. Try again.' };
  if (required) return { ok: false, message: 'Your organization requires two-step sign-in for everyone, so it stays on.' };
  if (ctx.user.aal !== 'aal2') return { ok: false, message: 'Sign in with your code first, then turn it off.' };
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { ok: false, message: 'That didn’t work. Try again.' };
  for (const factor of data.totp) {
    const { error: failed } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (failed) return { ok: false, message: 'That didn’t work. Try again.' };
  }
  await supabase.auth.refreshSession(); // the session's tokens still list the authenticator until refreshed
  await flash('Two-step sign-in is off. Your password alone opens your account.');
  revalidatePath(`/app/${slug}/preferences`);
  return { ok: true, message: 'Two-step sign-in is off. Your password alone opens your account.' };
}
