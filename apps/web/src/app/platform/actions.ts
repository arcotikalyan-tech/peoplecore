'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createOrganizationSchema } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { findOrInviteUser } from '@/server/admin-users';
import { isVerifiedPlatformAdmin } from '@/server/context';
import { createClient } from '@/server/supabase';

export async function createOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Authorization BEFORE any service-role use (two-factor included). The RPC re-checks in the database.
  if (!(await isVerifiedPlatformAdmin())) return { ok: false, message: 'Only platform administrators who completed two-step verification can create organizations.' };

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

const statusSchema = z.object({ orgId: z.uuid(), status: z.enum(['active', 'suspended']) });

/** Suspends or reactivates a tenant. The RPC re-checks platform-admin status and the change is audited. */
export async function setOrganizationStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return { ok: false, message: 'Only platform administrators who completed two-step verification can change an organization’s status.' };
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_organization_status', { p_org: parsed.data.orgId, p_status: parsed.data.status });
  if (error) return { ok: false, message: toUserMessage(error) };

  revalidatePath('/platform');
  return { ok: true, message: parsed.data.status === 'suspended' ? 'Organization suspended.' : 'Organization reactivated.' };
}

const accessRequestSchema = z.object({ id: z.uuid(), status: z.enum(['new', 'contacted', 'onboarded', 'declined']) });

/** Marks a website sign-up request as contacted, onboarded or declined (platform admins only, through RLS). */
export async function setAccessRequestStatusAction(formData: FormData): Promise<void> {
  const parsed = accessRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !(await isVerifiedPlatformAdmin())) return;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  await supabase.from('access_requests')
    .update({ status: parsed.data.status, reviewed_by: claims?.claims.sub ?? null, reviewed_at: new Date().toISOString() })
    .eq('id', parsed.data.id);
  revalidatePath('/platform');
}
