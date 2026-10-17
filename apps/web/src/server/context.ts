import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { hasGrant, type Grant, type PermissionKey, type PermissionScope } from '@peoplecore/shared';
import type { Tables } from '@peoplecore/db/types';
import { createClient } from './supabase';

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Verified identity from the JWT (getClaims validates the signature; getSession alone would not). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export type Organization = Pick<Tables<'organizations'>, 'id' | 'name' | 'slug' | 'is_demo' | 'timezone' | 'status'>;

export interface OrgContext {
  user: SessionUser;
  org: Organization;
  grants: Grant[];
  /** Holds the permission at any scope (org, team or self). For UI gating only — RLS enforces. */
  can(key: PermissionKey, scope?: PermissionScope): boolean;
}

/**
 * Resolves the organization from the URL slug *through RLS*: a slug the user isn't a member of
 * returns nothing and becomes a 404, so URLs can't be used to probe other tenants.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name, slug, is_demo, timezone, status')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error('Failed to load organization');
  if (!org) notFound();

  const { data: grants, error: grantsError } = await supabase.rpc('my_permissions', { p_org: org.id });
  if (grantsError) throw new Error('Failed to load permissions');
  // Platform admins can see the organization row but are not members: no grants → no tenant access.
  if (!grants || grants.length === 0) notFound();

  return { user, org, grants, can: (key, scope) => hasGrant(grants, key, scope) };
});

export async function requirePermission(slug: string, key: PermissionKey, scope?: PermissionScope): Promise<OrgContext> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can(key, scope)) notFound();
  return ctx;
}

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return Boolean(data);
});
