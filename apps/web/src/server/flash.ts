import 'server-only';
import { cookies } from 'next/headers';
import { isProduction } from '@/lib/env';

/**
 * A one-time confirmation that survives the form it came from. Use it in actions whose success removes their own
 * form from the page (an approval leaves the queue, a stage changes, a run is locked): the layout shows the
 * message and clears it. Short-lived and HTTP-only; carries only the message text.
 */
const NAME = 'pc_flash';

export async function flash(message: string) {
  (await cookies()).set(NAME, encodeURIComponent(message.slice(0, 300)), {
    path: '/', maxAge: 30, httpOnly: true, sameSite: 'lax', secure: isProduction(),
  });
}

export async function readFlash(): Promise<string | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export async function clearFlashCookie() {
  (await cookies()).delete(NAME);
}
