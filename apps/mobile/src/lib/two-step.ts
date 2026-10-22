import { supabase } from './supabase';

/** Two-step sign-in on the phone: setting up an authenticator, confirming it, and turning it off. */

export interface Setup { factorId: string; secret: string; uri: string }

/** Starts authenticator setup: a key for the authenticator app (or an otpauth:// link that opens it). */
export async function startTwoStepSetup(): Promise<Setup | { error: string }> {
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) return { error: 'Couldn’t start setup. Try again.' };
  if (factors.totp.length > 0) return { error: 'Two-step sign-in is already on.' };
  // Clear abandoned, never-confirmed setups so a fresh one can start.
  for (const factor of factors.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: factor.id });
  const { data, error: failed } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PeopleCore' });
  if (failed || !data) return { error: 'Couldn’t start setup. Try again.' };
  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
}

/** Confirms the authenticator with its current code; the session then counts as two-step. */
export async function confirmCode(factorId: string, code: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code.trim())) return 'Enter the 6-digit code from your authenticator app.';
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  return error ? 'That code didn’t work. Codes change every 30 seconds; enter the one shown now.' : null;
}

/** Turns off the person's own two-step sign-in, unless their organization requires it. */
export async function turnOffTwoStep(): Promise<string | null> {
  const { data: required, error: checkFailed } = await supabase.rpc('my_mfa_requirement');
  if (checkFailed) return 'That didn’t work. Try again.';
  if (required) return 'Your organization requires two-step sign-in for everyone, so it stays on.';
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return 'That didn’t work. Try again.';
  for (const factor of data.totp) {
    const { error: failed } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (failed) return 'Enter your code again first (sign out and back in), then turn it off.';
  }
  await supabase.auth.refreshSession();
  return null;
}
