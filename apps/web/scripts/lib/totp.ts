import { createHmac } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords (what authenticator apps show). Used only by scripts and tests
 * to complete two-factor sign-in for synthetic demo accounts; the app itself never generates codes.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 30-second window number a code belongs to. */
export const totpWindow = (at = Date.now(), step = 30) => Math.floor(at / 1000 / step);

export function totp(secret: string, at = Date.now(), { step = 30, digits = 6 } = {}): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(totpWindow(at, step)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
