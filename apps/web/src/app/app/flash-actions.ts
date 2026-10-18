'use server';

import { clearFlashCookie } from '@/server/flash';

/** Called once the flash message has been shown. */
export async function clearFlash() {
  await clearFlashCookie();
}
