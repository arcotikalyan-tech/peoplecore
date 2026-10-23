'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { safeNextPath } from '@/lib/safe-redirect';
import { requireUser } from '@/server/context';
import { personGate } from '@/server/sign-in-limits';
import { createClient } from '@/server/supabase';

const codeSchema = z.object({
  factorId: z.uuid(),
  code: z.string().trim().regex(/^\d{6}$/),
  next: z.string().optional(),
});

/** Completes the second step (also used to confirm a new authenticator). Upgrades the session to aal2. */
export async function verifyMfaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = codeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: { code: 'Enter the 6-digit code from your authenticator app.' } };

  const gate = personGate((await requireUser()).id, 'codes');
  if (gate.blocked) return { ok: false, fieldErrors: { code: gate.blocked } };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) {
    gate.failed();
    return { ok: false, fieldErrors: { code: 'That code didn’t work. Codes change every 30 seconds; enter the one shown now.' } };
  }
  gate.succeeded();
  redirect(safeNextPath(parsed.data.next));
}

export interface EnrollState extends ActionState {
  factorId?: string;
  qrCode?: string;
  secret?: string;
}

/** Starts authenticator setup and returns the QR code and manual-entry key for this user only. */
export async function startEnrollmentAction(_prev: EnrollState, _formData: FormData): Promise<EnrollState> {
  await requireUser();
  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { ok: false, message: 'Could not start setup. Please try again.' };
  if (factors.totp.length > 0) return { ok: false, message: 'Two-step verification is already set up. Reload this page.' };

  // Clear abandoned, never-verified setups so a fresh one can be created.
  for (const factor of factors.all.filter((f) => f.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PeopleCore' });
  if (error || !data) return { ok: false, message: 'Could not start setup. Please try again.' };
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}
