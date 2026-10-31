import 'server-only';
import type { Invitation } from './admin-users';
import type { OrgContext } from './context';
import { createClient } from './supabase';

/** The organization and the inviter's name (from their employee record, if they have one), for an invitation email. */
export async function invitationFrom(ctx: OrgContext): Promise<Invitation> {
  const supabase = await createClient();
  const { data } = await supabase.from('employees').select('first_name, last_name')
    .eq('organization_id', ctx.org.id).eq('user_id', ctx.user.id).maybeSingle();
  const name = data ? [data.first_name, data.last_name].filter(Boolean).join(' ').trim() : '';
  return { organization: ctx.org.name, inviter: name || null };
}
