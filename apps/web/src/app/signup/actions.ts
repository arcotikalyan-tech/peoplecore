'use server';

import { z } from 'zod';
import { formValues, invalid, sqlNull, type ActionState } from '@/lib/action-state';
import { createClient } from '@/server/supabase';

const schema = z.object({
  company: z.string().trim().min(2, 'Enter your company name.').max(120),
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.email('Enter a valid work email.').max(254),
  phone: z.string().trim().max(30).optional(),
  headcount: z.enum(['1-25', '26-100', '101-500', '501-2000', '2000+']).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional(),
});

/** The website's "Sign up": records a request for a workspace (public, through the reviewed request_access RPC). */
export async function requestAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_access', {
    p_company: d.company, p_name: d.name, p_email: d.email,
    p_phone: sqlNull(d.phone || null), p_headcount: sqlNull(d.headcount || null), p_message: sqlNull(d.message || null),
  });
  if (error) return { ok: false, message: 'We couldn’t send that just now. Please try again in a minute.', values: formValues(formData) };
  // The same answer whether or not this email has asked before.
  return { ok: true, message: `Thanks, ${d.name.split(' ')[0]}! We’ve got your request and will email ${d.email} to set up your workspace.` };
}
