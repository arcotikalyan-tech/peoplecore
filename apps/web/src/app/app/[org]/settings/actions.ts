'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { EMAIL_AUDIENCES, EMAIL_EVENTS, PERSON_EMAIL_RULES } from '@/lib/email-rules';
import { MODULES, NOTIFICATION_CATEGORIES } from '@/lib/modules';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Organization settings. RLS decides who may write: org.manage for modules, controls and notifications; owners (role.manage) for roles and support access. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const done = (slug: string, message: string): ActionState => { revalidatePath(`/app/${slug}`, 'layout'); return { ok: true, message }; };

export async function saveModulesAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org')) return DENIED;
  const on = new Set(formData.getAll('module').map(String));
  const rows = MODULES.map((m) => ({ organization_id: ctx.org.id, module: m.key, enabled: on.has(m.key), updated_at: new Date().toISOString() }));
  const supabase = await createClient();
  const { error } = await supabase.from('org_modules').upsert(rows);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, `Saved. ${rows.filter((r) => !r.enabled).length} module${rows.filter((r) => !r.enabled).length === 1 ? '' : 's'} switched off.`);
}

export async function saveControlsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.from('org_controls').update({
    block_self_edit: formData.get('blockSelfEdit') === 'on', salary_history_visible: formData.get('salaryHistory') === 'on', birthdays_visible: formData.get('birthdays') === 'on',
    notify_data_changes: formData.get('notifyChanges') === 'on',
  }).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, 'Controls saved.');
}

/**
 * Kredily's payroll access switches, as shortcuts over the role matrix (owners only): HR administrators approve and
 * lock payroll runs (payroll.approve), reporting managers see their team's salaries (compensation.read, team).
 */
const PAYROLL_SHORTCUTS = {
  hr_payroll_lock: { role: 'hr_admin', permission: 'payroll.approve', scope: 'org' },
  manager_pay_view: { role: 'manager', permission: 'compensation.read', scope: 'team' },
} as const;

export async function setPayrollShortcutAction(slug: string, key: 'hr_payroll_lock' | 'manager_pay_view', on: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const s = PAYROLL_SHORTCUTS[key];
  const supabase = await createClient();
  const { data: role } = await supabase.from('roles').select('id').eq('organization_id', ctx.org.id).eq('key', s.role).maybeSingle();
  if (!role) return { ok: false, message: 'That role no longer exists.' };
  const { error } = on
    ? await supabase.from('role_permissions').upsert({ organization_id: ctx.org.id, role_id: role.id, permission_key: s.permission, scope: s.scope })
    : await supabase.from('role_permissions').delete().eq('role_id', role.id).eq('permission_key', s.permission);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, on ? 'Switched on.' : 'Switched off.');
}

/** Owners: give or take an HR administrator's vendor payout access (the Vendor payout admin role). */
export async function setVendorAccessAction(slug: string, memberId: string, on: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org') || !z.uuid().safeParse(memberId).success) return DENIED;
  const supabase = await createClient();
  const [{ data: members, error }, { data: role }] = await Promise.all([
    supabase.rpc('org_members', { p_org: ctx.org.id }),
    supabase.from('roles').select('id').eq('organization_id', ctx.org.id).eq('key', 'vendor_admin').maybeSingle(),
  ]);
  const member = members?.find((m) => m.member_id === memberId);
  if (error || !member || !role) return { ok: false, message: 'That member or role no longer exists.' };
  const roles = on ? [...new Set([...member.role_ids, role.id])] : member.role_ids.filter((r) => r !== role.id);
  const { error: e2 } = await supabase.rpc('set_member_roles', { p_member: memberId, p_role_ids: roles });
  if (e2) return { ok: false, message: toUserMessage(e2) };
  return done(slug, on ? 'Vendor payout access given.' : 'Vendor payout access removed.');
}

/** Owners: close the company 30 days from today (typing its name), or cancel that. */
export async function requestClosureAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('request_org_closure', { p_org: ctx.org.id, p_confirm_name: String(formData.get('confirmName') ?? '') });
  if (error) return { ok: false, message: toUserMessage(error), fieldErrors: error.code === '22023' ? { confirmName: error.message } : undefined };
  return done(slug, `The company will close on ${data}. You can cancel until then.`);
}

export async function cancelClosureAction(slug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_org_closure', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  await flash('Closing the company is cancelled.');
  return done(slug, 'Closing the company is cancelled.');
}

/** Owners only: whether everyone in this organization needs two-step sign-in (turning it on needs a two-step session). */
export async function setRequireMfaAction(slug: string, on: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_org_require_mfa', { p_org: ctx.org.id, p_on: on });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, on ? 'Two-step sign-in is on for everyone. Each person sets it up at their next sign-in.' : 'Two-step sign-in is off. People who set it up for themselves keep it.');
}

export async function saveNotificationsAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org')) return DENIED;
  const on = new Set(formData.getAll('category').map(String));
  const supabase = await createClient();
  const { error } = await supabase.from('notification_settings').upsert(NOTIFICATION_CATEGORIES.map(([k]) => ({ organization_id: ctx.org.id, category: k, enabled: on.has(k) })));
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, 'Notification settings saved.');
}

/** Which events email which audiences: every combination is saved, on or off. */
export async function saveEmailRulesAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org')) return DENIED;
  const on = new Set(formData.getAll('rule').map(String));
  const rows: Array<{ organization_id: string; event: string; audience: string; enabled: boolean }> = [
    ...EMAIL_EVENTS.flatMap(([event]) => EMAIL_AUDIENCES.map(([audience]) => ({ organization_id: ctx.org.id, event, audience, enabled: on.has(`${event}:${audience}`) }))),
    ...PERSON_EMAIL_RULES.map(([event, audience]) => ({ organization_id: ctx.org.id, event, audience, enabled: on.has(`${event}:${audience}`) })),
  ];
  const supabase = await createClient();
  const { error } = await supabase.from('notification_email_rules').upsert(rows, { onConflict: 'organization_id,event,audience' });
  if (error) return { ok: false, message: toUserMessage(error) };
  const n = rows.filter((r) => r.enabled).length;
  return done(slug, n ? `Email notifications saved: ${n} switched on.` : 'Email notifications saved: all off.');
}

export async function grantSupportAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const parsed = z.object({ hours: z.coerce.number().int().min(1).max(168), reason: z.string().trim().min(5, 'Say what support is helping with').max(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Say what support is helping with.', fieldErrors: { reason: 'At least 5 characters' } };
  const supabase = await createClient();
  const { error } = await supabase.rpc('grant_support_access', { p_org: ctx.org.id, p_hours: parsed.data.hours, p_reason: parsed.data.reason });
  if (error) return { ok: false, message: toUserMessage(error) };
  const message = `Support access is open for ${parsed.data.hours} hour${parsed.data.hours === 1 ? '' : 's'}.`;
  await flash(message);
  return done(slug, message);
}

export async function revokeSupportAction(slug: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_support_access', { p_org: ctx.org.id });
  if (error) return { ok: false, message: toUserMessage(error) };
  await flash('Support access closed.');
  return done(slug, 'Support access closed.');
}

/** A custom role, optionally starting from another role's permissions. Custom roles require two-step sign-in. */
export async function createRoleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const parsed = z.object({
    name: z.string().trim().min(3, 'Name the role').max(60), description: z.string().trim().max(200).optional(),
    copyFrom: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Name the role.', fieldErrors: { name: 'At least 3 characters' } };
  const key = `custom_${parsed.data.name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)}`;
  const supabase = await createClient();
  const { data: role, error } = await supabase.from('roles')
    .insert({ organization_id: ctx.org.id, key, name: parsed.data.name, description: parsed.data.description || null, requires_mfa: true }).select('id').single();
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a role with that name.' : toUserMessage(error) };
  if (parsed.data.copyFrom) {
    const { data: perms } = await supabase.from('role_permissions').select('permission_key, scope').eq('role_id', parsed.data.copyFrom);
    if (perms?.length) {
      const { error: e2 } = await supabase.from('role_permissions').insert(perms.map((p) => ({ organization_id: ctx.org.id, role_id: role.id, permission_key: p.permission_key, scope: p.scope })));
      if (e2) return { ok: false, message: toUserMessage(e2) };
    }
  }
  return done(slug, `Role ${parsed.data.name} created. Assign it to people on the Members page.`);
}

export async function setRolePermissionAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const parsed = z.object({ roleId: z.uuid(), permission: z.string().regex(/^[a-z_.]{3,60}$/), scope: z.enum(['none', 'self', 'team', 'org']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Not found.' };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: role } = await supabase.from('roles').select('is_system').eq('id', v.roleId).eq('organization_id', ctx.org.id).single();
  if (!role || role.is_system) return { ok: false, message: 'Built-in roles can’t be changed. Create a custom role instead.' };
  const { error } = v.scope === 'none'
    ? await supabase.from('role_permissions').delete().eq('role_id', v.roleId).eq('permission_key', v.permission)
    : await supabase.from('role_permissions').upsert({ organization_id: ctx.org.id, role_id: v.roleId, permission_key: v.permission, scope: v.scope });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, 'Saved.');
}

export async function deleteRoleAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('roleId'));
  if (!id.success) return { ok: false, message: 'Role not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('roles').delete().eq('organization_id', ctx.org.id).eq('id', id.data).eq('is_system', false);
  if (error) return { ok: false, message: error.code === '23503' ? 'Someone still has this role. Remove it from them first.' : toUserMessage(error) };
  return done(slug, 'Role deleted.');
}
