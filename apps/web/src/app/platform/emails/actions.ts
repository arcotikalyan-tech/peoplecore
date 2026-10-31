'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  ACCOUNT_EMAILS, accountEmail, isAccountEmailKey, layoutProblems, templateProblems, type AccountEmailText, type EmailLayout,
} from '@peoplecore/shared';
import { formValues, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getSessionUser, isVerifiedPlatformAdmin } from '@/server/context';
import { forgetCachedEmailTemplates } from '@/server/email-templates';
import { appUrl, EmailNotConfigured, sendEmail } from '@/server/mailer';
import { createClient } from '@/server/supabase';
import { sampleMessage, sampleValues } from './samples';

const DENIED: ActionState = { ok: false, message: 'Only platform administrators can change email templates.' };
const str = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === 'string' ? v : '';
};

function layoutFrom(formData: FormData): EmailLayout {
  return {
    brandName: str(formData, 'brandName').trim(),
    accentColor: str(formData, 'accentColor').trim(),
    logoUrl: str(formData, 'logoUrl').trim() || null,
    showBrandName: formData.get('showBrandName') === 'on',
    footerText: str(formData, 'footerText').trim(),
    supportEmail: str(formData, 'supportEmail').trim() || null,
    address: str(formData, 'address').trim() || null,
  };
}

function textFrom(formData: FormData, link: boolean): AccountEmailText {
  return {
    subject: str(formData, 'subject'),
    heading: str(formData, 'heading'),
    body: str(formData, 'body'),
    button: link ? str(formData, 'button') : null,
    note: str(formData, 'note').trim() || null,
  };
}

export async function saveEmailLayoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const l = layoutFrom(formData);
  const problems = layoutProblems(l);
  if (Object.keys(problems).length) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: problems, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_set_email_layout', {
    p_brand_name: l.brandName, p_accent_color: l.accentColor, p_logo_url: l.logoUrl ?? '', p_show_brand_name: l.showBrandName,
    p_footer_text: l.footerText, p_support_email: l.supportEmail ?? '', p_address: l.address ?? '',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  forgetCachedEmailTemplates();
  revalidatePath('/platform/emails');
  return { ok: true, message: 'Layout saved. Every email from now on uses it.' };
}

export async function saveEmailTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const key = str(formData, 'key');
  if (!isAccountEmailKey(key)) return { ok: false, message: 'There is no such email.' };
  const t = textFrom(formData, ACCOUNT_EMAILS[key].link);
  const problems = templateProblems(key, t);
  if (Object.keys(problems).length) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: problems, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_set_email_template', {
    p_key: key, p_subject: t.subject, p_heading: t.heading, p_body: t.body, p_button_label: t.button ?? '', p_note: t.note ?? '',
  });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  forgetCachedEmailTemplates();
  revalidatePath('/platform/emails');
  return { ok: true, message: `${ACCOUNT_EMAILS[key].label} saved.` };
}

export async function resetEmailTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const key = str(formData, 'key');
  if (!isAccountEmailKey(key)) return { ok: false, message: 'There is no such email.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_reset_email_template', { p_key: key });
  if (error) return { ok: false, message: toUserMessage(error) };
  forgetCachedEmailTemplates();
  revalidatePath('/platform/emails');
  return { ok: true, message: `${ACCOUNT_EMAILS[key].label} is back to the standard text.` };
}

/**
 * Sends what is on screen (the layout and the chosen email, saved or not) to the administrator's own address, with
 * example values. Never to anyone else.
 */
export async function sendTestEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const user = await getSessionUser();
  if (!user?.email) return { ok: false, message: 'Your account has no email address to send to.' };
  const layout = layoutFrom(formData);
  if (Object.keys(layoutProblems(layout)).length) return { ok: false, message: 'Fix the layout first (see the highlighted fields).' };
  const key = str(formData, 'key');
  const origin = appUrl() ?? (await headers()).get('origin') ?? '';
  let message;
  if (isAccountEmailKey(key)) {
    const t = textFrom(formData, ACCOUNT_EMAILS[key].link);
    if (Object.keys(templateProblems(key, t)).length) return { ok: false, message: 'Fix the highlighted fields first.' };
    const s = sampleValues(key, user.email, layout.brandName, origin);
    message = accountEmail(key, t, s.values, s);
  } else {
    message = sampleMessage(layout.brandName, origin);
  }
  try {
    await sendEmail(user.email, layout, { ...message, subject: `[Test] ${message.subject}` });
  } catch (err) {
    if (err instanceof EmailNotConfigured) return { ok: false, message: err.message };
    return { ok: false, message: `The mail server refused it: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, message: `Test email sent to ${user.email}. The link in it doesn’t work; it only shows how the email looks.` };
}
