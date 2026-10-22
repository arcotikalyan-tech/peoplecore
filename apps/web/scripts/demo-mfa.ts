/**
 * Sets up two-step sign-in for the demo accounts that use it (owner, HR, payroll, platform), as anyone may for
 * themselves in Account settings; with an authenticator, sign-in always asks for the code.
 *
 *   corepack pnpm --filter @peoplecore/web demo:mfa
 */
import { ensureDemoMfa } from './lib/demo-mfa.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'example.test';
if (!url || !publishableKey || !secretKey || !password) {
  console.error('✗ Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and DEMO_USER_PASSWORD.');
  process.exit(1);
}

export const DEMO_MFA_ACCOUNTS = ['demo.owner', 'demo.hr', 'demo.payroll', 'demo.platform'];

try {
  const emails = DEMO_MFA_ACCOUNTS.map((a) => `${a}@${domain}`);
  const enrolled = await ensureDemoMfa({ url, publishableKey, secretKey, password }, emails);
  console.log(`✓ Two-factor ready for ${emails.length} demo accounts (${enrolled.length} newly enrolled).`);
  console.log('  Secrets: apps/web/.demo-mfa.json (gitignored). Current code: corepack pnpm --filter @peoplecore/web demo:totp demo.hr');
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
