'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createOrganizationSchema } from '@peoplecore/shared';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { findOrInviteUser } from '@/server/admin-users';
import { isPlatformAdmin } from '@/server/context';
import { createClient } from '@/server/supabase';

export async function createOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Authorization BEFORE any service-role use. The RPC re-checks platform-admin status in the database.
  if (!(await isPlatformAdmin())) return { ok: false, message: 'Only platform administrators can create organizations.' };

  const parsed = createOrganizationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const { name, slug, ownerEmail } = parsed.data;

  const supabase = await createClient();
  // Check the slug before inviting anyone, so a taken URL doesn't leave a stray invitation behind.
  const { data: existing, error: lookupError } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle();
  if (lookupError) return { ok: false, message: toUserMessage(lookupError), values: formValues(formData) };
  if (existing) return { ok: false, fieldErrors: { slug: 'That URL is already taken.' }, values: formValues(formData) };

  let ownerId: string | undefined;
  let invited = false;
  if (ownerEmail) {
    const origin = (await headers()).get('origin') ?? '';
    const owner = await findOrInviteUser(ownerEmail, `${origin}/auth/callback?next=/app`);
    if (!owner.ok) return { ok: false, message: owner.message, values: formValues(formData) };
    ownerId = owner.userId;
    invited = owner.invited;
  }

  const { error } = await supabase.rpc('create_organization', { p_name: name, p_slug: slug, p_owner_user_id: ownerId });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };

  revalidatePath('/platform');
  const ownerNote = ownerId ? (invited ? ' An invitation was sent to the owner.' : ' The existing user was added as owner.') : '';
  return { ok: true, message: `Organization “${name}” created.${ownerNote}` };
}
