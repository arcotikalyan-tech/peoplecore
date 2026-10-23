import 'server-only';
import { headers } from 'next/headers';
import { AttemptLimiter, minutesText } from '@/lib/attempt-limiter';

const WINDOW = 15 * 60_000;

/**
 * Limits on guessing passwords and two-step codes through the website (15 minutes):
 * - five wrong passwords for one account from one address;
 * - thirty for one account from anywhere (high enough that a stranger can't lock someone out with a few tries);
 * - a hundred from one address across accounts (an office often shares one address);
 * - five wrong two-step codes, or current passwords when changing it, per signed-in person.
 * Supabase Auth's own limit per address (30 sign-ins in 5 minutes) also covers the phone app, which signs in directly.
 * One set per server process (kept on globalThis so every route shares it).
 */
const limits = ((globalThis as { __peoplecoreSignInLimits?: Record<'pair' | 'account' | 'address' | 'person', AttemptLimiter> })
  .__peoplecoreSignInLimits ??= {
    pair: new AttemptLimiter(5, WINDOW),
    account: new AttemptLimiter(30, WINDOW),
    address: new AttemptLimiter(100, WINDOW),
    person: new AttemptLimiter(5, WINDOW),
  });

/** The caller's network address. Caddy, in front of the website, replaces X-Forwarded-For with it. */
async function clientAddress(): Promise<string> {
  return (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
}

export interface Gate {
  /** Set when the caller must wait: the message to show instead of trying. */
  blocked: string | null;
  failed(): void;
  succeeded(): void;
}

/** Password sign-in for an email (the same answer whether or not the account exists). */
export async function signInGate(email: string): Promise<Gate> {
  const account = email.trim().toLowerCase();
  const address = await clientAddress();
  const pair = `${account}|${address}`;
  const wait = Math.max(limits.pair.waitFor(pair), limits.account.waitFor(account), limits.address.waitFor(address));
  return {
    blocked: wait > 0 ? `Too many sign-in attempts. Try again in ${minutesText(wait)}, or choose a new password with “Forgot password?”.` : null,
    failed() {
      limits.pair.fail(pair);
      limits.account.fail(account);
      limits.address.fail(address);
    },
    succeeded() {
      limits.pair.clear(pair);
    },
  };
}

/** Two-step codes and current-password checks by a signed-in person. */
export function personGate(userId: string, what: 'codes' | 'passwords'): Gate {
  const key = `${what}:${userId}`;
  const wait = limits.person.waitFor(key);
  return {
    blocked: wait > 0 ? `Too many wrong ${what === 'codes' ? 'codes' : 'passwords'}. Try again in ${minutesText(wait)}.` : null,
    failed: () => limits.person.fail(key),
    succeeded: () => limits.person.clear(key),
  };
}
