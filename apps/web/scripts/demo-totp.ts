/**
 * Prints the current two-factor code for a demo account (for signing in as it in the browser).
 *
 *   corepack pnpm --filter @peoplecore/web demo:totp demo.hr
 */
import { readMfaSecrets } from './lib/demo-mfa.ts';
import { totp } from './lib/totp.ts';

const account = process.argv[2];
const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'example.test';
const secrets = await readMfaSecrets();
const email = account?.includes('@') ? account : `${account}@${domain}`;
const entry = account ? secrets[email] : undefined;
if (!entry) {
  console.error(`✗ No two-factor secret for "${account ?? ''}". Known: ${Object.keys(secrets).join(', ') || 'none (run demo:mfa)'}`);
  process.exit(1);
}
const left = 30 - Math.floor(Date.now() / 1000) % 30;
console.log(`${totp(entry.secret)}  (${email}, valid for ${left} more second${left === 1 ? '' : 's'})`);
