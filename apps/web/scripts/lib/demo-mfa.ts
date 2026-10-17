import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { totp } from './totp.ts';

/**
 * Two-factor (TOTP) setup for the *synthetic demo accounts* only. Each account gets one verified factor;
 * its secret is stored in apps/web/.demo-mfa.json (gitignored, owner-readable only) so scripts and tests
 * can produce codes. Real users enroll their own authenticator app in the product.
 */

export const MFA_FILE = new URL('../../.demo-mfa.json', import.meta.url);

export type MfaSecrets = Record<string, { factorId: string; secret: string }>;

export async function readMfaSecrets(): Promise<MfaSecrets> {
  if (!existsSync(MFA_FILE)) return {};
  return JSON.parse(await readFile(MFA_FILE, 'utf8')) as MfaSecrets;
}

async function writeMfaSecrets(secrets: MfaSecrets) {
  await writeFile(MFA_FILE, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  await chmod(MFA_FILE, 0o600);
}

interface Env {
  url: string;
  publishableKey: string;
  secretKey: string;
  password: string;
}

/** Ensures every listed account has a verified TOTP factor whose secret we hold. Returns the ones (re)enrolled. */
export async function ensureDemoMfa(env: Env, emails: string[]): Promise<string[]> {
  const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const secrets = await readMfaSecrets();
  const enrolled: string[] = [];

  for (const email of emails) {
    const client = createClient(env.url, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password: env.password });
    if (signInError || !signedIn.user) throw new Error(`${email}: password sign-in failed (${signInError?.message})`);

    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) throw new Error(`${email}: could not list factors (${listError.message})`);
    const known = secrets[email];
    if (known && factors.totp.some((f) => f.id === known.factorId)) {
      await client.auth.signOut({ scope: 'local' });
      continue; // already set up and we hold its secret
    }

    // Unknown or stale factors (e.g. secret lost): remove them and enroll a fresh one.
    for (const factor of factors.all) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: signedIn.user.id, id: factor.id });
      if (error) throw new Error(`${email}: could not remove an old factor (${error.message})`);
    }
    const { data: factor, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PeopleCore demo' });
    if (enrollError || !factor) throw new Error(`${email}: enrollment failed (${enrollError?.message})`);
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) });
    if (verifyError) throw new Error(`${email}: verification failed (${verifyError.message})`);

    secrets[email] = { factorId: factor.id, secret: factor.totp.secret };
    await writeMfaSecrets(secrets);
    await client.auth.signOut({ scope: 'local' });
    enrolled.push(email);
  }
  return enrolled;
}
