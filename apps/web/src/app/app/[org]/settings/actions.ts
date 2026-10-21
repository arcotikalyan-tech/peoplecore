'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
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
  }).eq('organization_id', ctx.org.id);
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, 'Controls saved.');
}

/** Owners only: whether owner, HR, payroll and auditor roles need two-step sign-in in this organization. */
export async function setRequireMfaAction(slug: string, on: boolean): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('role.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_org_require_mfa', { p_org: ctx.org.id, p_on: on });
  if (error) return { ok: false, message: toUserMessage(error) };
  return done(slug, on ? 'Two-step sign-in is required again.' : 'Two-step sign-in is now optional.');
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
