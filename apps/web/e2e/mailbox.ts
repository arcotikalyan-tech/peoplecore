import { expect } from '@playwright/test';

/**
 * The local Supabase test inbox (Mailpit). Every email Auth sends in a local or CI stack lands here
 * instead of being delivered. Set MAILPIT_URL to enable the email journeys.
 */
export const mailpitUrl = process.env.MAILPIT_URL;

interface Summary { ID: string; Subject: string; Created: string }

/** Waits for the newest email to `address` received after `since`, and returns its first link to `match`. */
export async function linkFromLatestEmail(address: string, since: Date, match: RegExp): Promise<{ subject: string; link: string }> {
  if (!mailpitUrl) throw new Error('MAILPIT_URL is not set');
  let found: Summary | undefined;
  await expect.poll(async () => {
    const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const { messages } = (await res.json()) as { messages: Summary[] };
    found = messages.find((m) => new Date(m.Created) >= since);
    return !!found;
  }, { message: `email to ${address}`, timeout: 30_000 }).toBe(true);

  const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${found!.ID}`)).json()) as { HTML: string };
  const hrefs = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));
  const link = hrefs.find((h) => match.test(h));
  if (!link) throw new Error(`No link matching ${match} in "${found!.Subject}"`);
  return { subject: found!.Subject, link };
}
