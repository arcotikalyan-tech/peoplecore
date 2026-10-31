'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { organizationSlug, requiredText } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { MODULES } from '@/lib/modules';
import { cleanSlug, slugify } from '@/lib/slug';
import { findOrInviteUser } from '@/server/admin-users';
import { isPlatformAdmin, isVerifiedPlatformAdmin } from '@/server/context';
import { flash } from '@/server/flash';
import { platformToday } from '@/server/platform';
import { createClient } from '@/server/supabase';

/** Platform console actions. Each checks the caller first; the database functions check again and audit. */

const DENIED: ActionState = { ok: false, message: 'Only platform administrators (with two-step done, where it’s required) can do this.' };

/** Every console page shows plans, counts and the activity log, so a change refreshes the whole console. */
const refresh = () => revalidatePath('/platform', 'layout');

const blankToUndefined = (v: unknown) => (v === '' || v == null ? undefined : v);
const optionalInt = (max: number) => z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(max).optional());
const optionalMoney = z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1_000_000).optional());
const optionalEmail = z.preprocess(blankToUndefined, z.email('Enter a valid email').optional());
const optionalDate = z.preprocess(blankToUndefined, z.iso.date().optional());
/** RPC arguments without a default must be sent: supabase-js drops undefined ones, so a blank goes as null. */
const nullable = <T>(v: T | undefined) => (v ?? null) as T;

async function inviteRedirect() {
  const origin = (await headers()).get('origin') ?? '';
  return `${origin}/auth/callback?next=/app`;
}

// ─── Organizations ──────────────────────────────────────────────────────────

const createSchema = z.object({
  name: requiredText(200, 'Organization name'),
  slug: organizationSlug,
  ownerEmail: optionalEmail,
  plan: z.string().min(1, 'Choose a plan'),
  trialDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(365).optional()),
  billingEmail: optionalEmail,
  requestId: z.preprocess(blankToUndefined, z.uuid().optional()),
});

export async function createOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Authorization BEFORE any secret-key use (inviting the owner). The database function checks again.
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const raw = Object.fromEntries(formData);
  const typed = cleanSlug(String(raw.slug ?? '')).replace(/-+$/, '');
  // Filled in from the name (left as suggested, or blank): a taken URL gets a number instead of an error.
  const auto = !typed || (raw.slugAuto === '1' && typed === slugify(String(raw.name ?? '')));
  const parsed = createSchema.safeParse({ ...raw, slug: typed || slugify(String(raw.name ?? '')) });
  if (!parsed.success) return invalid(parsed.error, formData);
  const { name, ownerEmail, plan, trialDays, billingEmail, requestId } = parsed.data;

  const supabase = await createClient();
  // A free URL before inviting anyone, so a taken URL doesn't leave a stray invitation. A URL made from the name
  // gets a number when it's taken; one typed by hand is the admin's choice, so they're asked for another.
  let slug = parsed.data.slug;
  for (let n = 2; ; n++) {
    const { data: existing, error } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle();
    if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
    if (!existing) break;
    if (!auto || n > 20) return { ok: false, fieldErrors: { slug: 'That URL is already taken. Choose another.' }, values: formValues(formData) };
    slug = `${parsed.data.slug.slice(0, 47)}-${n}`;
  }

  let ownerId: string | undefined;
  let invited = false;
  if (ownerEmail) {
    const owner = await findOrInviteUser(ownerEmail, await inviteRedirect());
    if (!owner.ok) return { ok: false, message: owner.message, values: formValues(formData) };
    ownerId = owner.userId;
    invited = owner.invited;
  }

  const { data: orgId, error } = await supabase.rpc('platform_create_organization', {
    p_name: name, p_slug: slug, p_owner_user_id: nullable(ownerId), p_plan: plan,
    p_trial_days: nullable(trialDays), p_billing_email: nullable(billingEmail ?? ownerEmail),
  });
  if (error || !orgId) return { ok: false, message: error ? toUserMessage(error) : 'The organization wasn’t created. Try again.', values: formValues(formData) };

  if (requestId) {
    const { data: claims } = await supabase.auth.getClaims();
    await supabase.from('access_requests')
      .update({ status: 'onboarded', reviewed_by: claims?.claims.sub ?? null, reviewed_at: new Date().toISOString() })
      .eq('id', requestId);
  }
  refresh();
  await flash(`Organization “${name}” created at /app/${slug}.${ownerEmail
    ? (invited ? ` ${ownerEmail} was emailed an invitation to choose a password, and a welcome email.` : ` ${ownerEmail} already had an account: they’re the owner and were emailed.`)
    : ' Add an owner below so someone can sign in.'}`);
  redirect(`/platform/organizations/${orgId}`);
}

const editSchema = z.object({
  name: requiredText(200, 'Organization name'),
  slug: organizationSlug,
  timezone: z.string().min(1, 'Choose a time zone'),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
});

export async function updateOrganizationAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const parsed = editSchema.safeParse({ ...Object.fromEntries(formData), slug: cleanSlug(String(formData.get('slug') ?? '')).replace(/-+$/, '') });
  if (!parsed.success) return invalid(parsed.error, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_update_organization', {
    p_org: orgId, p_name: parsed.data.name, p_slug: parsed.data.slug, p_timezone: parsed.data.timezone, p_country_code: parsed.data.countryCode,
  });
  if (error) {
    const message = toUserMessage(error);
    return error.code === '23505' ? { ok: false, fieldErrors: { slug: message }, values: formValues(formData) } : { ok: false, message, values: formValues(formData) };
  }
  refresh();
  return { ok: true, message: 'Organization details saved.' };
}

const statusSchema = z.object({ orgId: z.uuid(), status: z.enum(['active', 'suspended']) });

/** Suspends or reactivates a tenant. The RPC re-checks platform-admin status and the change is audited. */
export async function setOrganizationStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_organization_status', { p_org: parsed.data.orgId, p_status: parsed.data.status });
  if (error) return { ok: false, message: toUserMessage(error) };

  refresh();
  return { ok: true, message: parsed.data.status === 'suspended' ? 'Organization suspended.' : 'Organization reactivated.' };
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

const subscriptionSchema = z.object({
  plan: z.string().min(1, 'Choose a plan'),
  status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
  billingCycle: z.enum(['monthly', 'annual']),
  employeeLimit: optionalInt(1_000_000),
  pricePerEmployee: optionalMoney,
  trialEndsAt: optionalDate,
  paidUntil: optionalDate,
  billingEmail: optionalEmail,
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters').optional(),
}).refine((s) => s.status !== 'trialing' || s.trialEndsAt, { path: ['trialEndsAt'], message: 'A trial needs an end date' });

type SubscriptionInput = z.infer<typeof subscriptionSchema>;

async function saveSubscription(orgId: string, s: SubscriptionInput) {
  const supabase = await createClient();
  return supabase.rpc('platform_set_subscription', {
    p_org: orgId, p_plan: s.plan, p_status: s.status, p_billing_cycle: s.billingCycle,
    p_employee_limit: nullable(s.employeeLimit), p_price_per_employee: nullable(s.pricePerEmployee),
    p_trial_ends_at: nullable(s.trialEndsAt), p_paid_until: nullable(s.paidUntil),
    p_billing_email: nullable(s.billingEmail), p_notes: nullable(s.notes || undefined),
  });
}

export async function setSubscriptionAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const parsed = subscriptionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const { error } = await saveSubscription(orgId, parsed.data);
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  refresh();
  return { ok: true, message: 'Plan and billing saved.' };
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** One-click changes: extend a trial by 14 days, or record a payment for the next month or year. */
export async function quickSubscriptionAction(formData: FormData): Promise<void> {
  const orgId = z.uuid().safeParse(formData.get('orgId'));
  const op = formData.get('op');
  if (!orgId.success || !(await isVerifiedPlatformAdmin())) return;
  const supabase = await createClient();
  const { data: s } = await supabase.from('organization_subscriptions').select('*').eq('organization_id', orgId.data).maybeSingle();
  if (!s) return;
  const today = platformToday();
  const later = (d: string | null) => (d && d > today ? d : today);
  const next: SubscriptionInput = {
    plan: s.plan_code, status: s.status, billingCycle: s.billing_cycle, employeeLimit: s.employee_limit ?? undefined,
    pricePerEmployee: s.price_per_employee ?? undefined, trialEndsAt: s.trial_ends_at ?? undefined, paidUntil: s.paid_until ?? undefined,
    billingEmail: s.billing_email ?? undefined, notes: s.notes ?? undefined,
  };
  if (op === 'extend_trial') Object.assign(next, { status: 'trialing', trialEndsAt: addDays(later(s.trial_ends_at), 14) });
  else if (op === 'record_payment') Object.assign(next, { status: 'active', paidUntil: addMonths(later(s.paid_until), s.billing_cycle === 'annual' ? 12 : 1) });
  else return;
  const { error } = await saveSubscription(orgId.data, next);
  if (!error) {
    refresh();
    await flash(op === 'extend_trial' ? `Trial extended to ${next.trialEndsAt}.` : `Payment recorded: paid until ${next.paidUntil}.`);
  }
}

// ─── Owners ─────────────────────────────────────────────────────────────────

export async function addOwnerAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const email = z.email().safeParse(String(formData.get('email') ?? '').trim());
  if (!email.success) return { ok: false, fieldErrors: { email: 'Enter a valid email' }, values: formValues(formData) };
  const account = await findOrInviteUser(email.data, await inviteRedirect());
  if (!account.ok) return { ok: false, message: account.message, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_add_owner', { p_org: orgId, p_user: account.userId });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  refresh();
  return {
    ok: true,
    message: account.invited
      ? `${email.data} is now an owner. They were emailed an invitation to choose a password, and told they’re an owner.`
      : `${email.data} is now an owner and was emailed.`,
  };
}

export async function removeOwnerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const parsed = z.object({ orgId: z.uuid(), userId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_remove_owner', { p_org: parsed.data.orgId, p_user: parsed.data.userId });
  if (error) return { ok: false, message: toUserMessage(error) };
  refresh();
  return { ok: true, message: 'Owner removed. They keep any other roles they have.' };
}

// ─── Sign-up requests ───────────────────────────────────────────────────────

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
  refresh();
}

// ─── Plans ──────────────────────────────────────────────────────────────────

const MODULE_KEYS = new Set<string>(MODULES.map((m) => m.key));

const planSchema = z.object({
  name: requiredText(60, 'Plan name'),
  description: z.string().trim().max(300, 'Keep it under 300 characters').optional(),
  pricePerEmployee: optionalMoney,
  basePrice: optionalMoney,
  annualDiscount: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(90).optional()),
  maxEmployees: optionalInt(1_000_000),
  trialDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(90).optional()),
  sortOrder: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(1000).optional()),
});

export async function savePlanAction(existingCode: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const parsed = planSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const p = parsed.data;
  const allModules = formData.get('allModules') === 'on';
  const modules = formData.getAll('module').map(String).filter((k) => MODULE_KEYS.has(k));
  const row = {
    name: p.name, description: p.description || null, price_per_employee: p.pricePerEmployee ?? null, base_price: p.basePrice ?? 0,
    annual_discount_pct: p.annualDiscount ?? 0, max_employees: p.maxEmployees ?? null, modules: allModules ? null : modules,
    trial_days: p.trialDays ?? 0, sort_order: p.sortOrder ?? 0, is_active: formData.get('isActive') === 'on',
  };
  const supabase = await createClient();
  if (existingCode) {
    const { error } = await supabase.from('platform_plans').update(row).eq('code', existingCode);
    if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
    refresh();
    return { ok: true, message: `${p.name} saved. Organizations on it get the change straight away.` };
  }
  const code = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,29}$/).safeParse(String(formData.get('code') ?? '').trim().toLowerCase());
  if (!code.success) return { ok: false, fieldErrors: { code: 'Use 2–30 lowercase letters, digits, hyphens or underscores' }, values: formValues(formData) };
  const { error } = await supabase.from('platform_plans').insert({ code: code.data, ...row });
  if (error) {
    const message = error.code === '23505' ? 'A plan with this code or name already exists.' : toUserMessage(error);
    return { ok: false, message, values: formValues(formData) };
  }
  refresh();
  await flash(`Plan “${p.name}” added.`);
  redirect('/platform/plans');
}

// ─── Platform settings and administrators ───────────────────────────────────

/** Platform admins: whether platform administrators need two-step sign-in (off unless switched on; on needs a two-step session). */
export async function setPlatformRequireMfaAction(formData: FormData): Promise<void> {
  if (!(await isPlatformAdmin())) return;
  const supabase = await createClient();
  await supabase.rpc('set_platform_require_mfa', { p_on: formData.get('on') === 'true' });
  refresh();
}

export async function setDefaultPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_platform_default_plan', { p_plan: String(formData.get('plan') ?? '') });
  if (error) return { ok: false, message: toUserMessage(error) };
  refresh();
  return { ok: true, message: 'Default plan saved.' };
}

export async function addPlatformAdminAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const email = z.email().safeParse(String(formData.get('email') ?? '').trim());
  if (!email.success) return { ok: false, fieldErrors: { email: 'Enter a valid email' }, values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_add_admin', { p_email: email.data });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  refresh();
  return { ok: true, message: `${email.data} is now a platform administrator and was emailed.` };
}

export async function removePlatformAdminAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isVerifiedPlatformAdmin())) return DENIED;
  const userId = z.uuid().safeParse(formData.get('userId'));
  if (!userId.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('platform_remove_admin', { p_user: userId.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  refresh();
  return { ok: true, message: 'Platform administrator removed.' };
}
