'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { safeNextPath } from '@/lib/safe-redirect';
import { signInGate } from '@/server/sign-in-limits';
import { createClient } from '@/server/supabase';

const passwordSchema = z.object({ email: z.email(), password: z.string().min(1), next: z.string().optional() });

export async function signInWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Enter your email and password.', values: { email: String(formData.get('email') ?? '') } };

  const gate = await signInGate(parsed.data.email);
  if (gate.blocked) return { ok: false, message: gate.blocked, values: { email: parsed.data.email } };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    gate.failed();
    // One generic message: never reveal whether the account exists.
    return { ok: false, message: 'Incorrect email or password.', values: { email: parsed.data.email } };
  }
  gate.succeeded();
  const next = safeNextPath(parsed.data.next);
  // Roles that need two-factor go straight to the second step.
  const [{ data: needsMfa }, { data: aal }] = await Promise.all([supabase.rpc('my_mfa_requirement'), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
  // Required by a role, or turned on by the person themselves (a verified authenticator).
  redirect(needsMfa || aal?.nextLevel === 'aal2' ? `/mfa?next=${encodeURIComponent(next)}` : next);
}

const linkSchema = z.object({ email: z.email(), next: z.string().optional() });

export async function sendMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Enter a valid email address.' };

  const origin = (await headers()).get('origin') ?? '';
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    // Accounts are provisioned by invitation only; a sign-in link must never create a user.
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(parsed.data.next))}` },
  });
  // Same response whether or not the address has an account.
  return { ok: true, message: 'If that email has a PeopleCore account, a sign-in link is on its way.' };
}
