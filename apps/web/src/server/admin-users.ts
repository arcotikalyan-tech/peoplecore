import 'server-only';
import { createAdminClient } from './admin';

/** How long to wait for Supabase to send an invitation email before telling the person to try again. */
const INVITE_WAIT_MS = 20_000;

export type FindOrInviteResult = { ok: true; userId: string; invited: boolean } | { ok: false; message: string };

/**
 * Finds an auth user by email, or sends a Supabase invitation. Uses the service-role client.
 *
 * AUTHORIZATION: the caller must already have verified the actor is a platform administrator.
 */
export async function findOrInviteUser(email: string, redirectTo: string): Promise<FindOrInviteResult> {
  const admin = createAdminClient();
  const target = email.toLowerCase();

  // The admin API has no lookup-by-email; page through users (bounded so a huge project can't hang the request).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { ok: false, message: 'Could not look up existing users. Try again.' };
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return { ok: true, userId: hit.id, invited: false };
    if (data.users.length < 1000) break;
  }

  // Supabase sends the invitation over SMTP before it answers, so a slow mail server would hold the page; give up
  // waiting after a while. If the email does go out later, inviting again finds the new user and just adds them.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((resolve) => { timer = setTimeout(() => resolve('slow'), INVITE_WAIT_MS); });
  const result = await Promise.race([admin.auth.admin.inviteUserByEmail(target, { redirectTo }), slow]).finally(() => clearTimeout(timer));
  if (result === 'slow') {
    return { ok: false, message: 'The email server is taking too long to answer. Wait a minute, then invite them again: if the first invitation went out, they’re simply added.' };
  }
  const { data, error } = result;
  if (error || !data.user) {
    return { ok: false, message: 'Could not send the invitation. Check the Supabase Auth email settings.' };
  }
  return { ok: true, userId: data.user.id, invited: true };
}
