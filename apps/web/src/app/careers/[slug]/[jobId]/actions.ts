'use server';

import { publicApplicationSchema } from '@peoplecore/shared';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { createClient } from '@/server/supabase';

/** Public application. The database validates again, throttles, and never reveals whether someone is on file. */
export async function applyAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = publicApplicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_public_application', {
    p_org_slug: slug, p_requisition: v.requisitionId, p_first_name: v.firstName, p_last_name: sqlNull(v.lastName),
    p_email: v.email, p_phone: sqlNull(v.phone), p_consent: true,
  });
  if (error) {
    return { ok: false, message: error.code === '22023' ? error.message : 'Something went wrong. Please try again.', values: formValues(formData) };
  }
  return { ok: true, message: 'Thank you. We have received your application and will be in touch.' };
}
