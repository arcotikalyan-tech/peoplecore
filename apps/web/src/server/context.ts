import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { hasGrant, type Grant, type PermissionKey, type PermissionScope } from '@peoplecore/shared';
import type { Tables } from '@peoplecore/db/types';
import { createClient } from './supabase';

export interface SessionUser {
  id: string;
  email: string | null;
  /** 'aal2' once the user completed a second factor (TOTP) in this session. */
  aal: 'aal1' | 'aal2';
}

/** Verified identity from the JWT (getClaims validates the signature; getSession alone would not). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** Whether somewhere the user belongs requires two-step sign-in (an organization's switch in Settings › Controls, or the platform's for admins). */
export const needsMfa = cache(async (): Promise<boolean> => {
  const known = requestShell().needsMfa;
  if (known !== undefined) return known;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_mfa_requirement');
  if (error) throw new Error('Failed to check two-factor requirement');
  return data;
});

/**
 * Sends people to /mfa until they complete it for this session when their organization (or the platform, for admins)
 * requires two-step, or they turned it on for themselves. UX only: the database already withholds permissions from
 * password-only (aal1) sessions where two-step is required.
 */
export async function requireMfaIfNeeded(user: SessionUser, nextPath: string) {
  if (user.aal !== 'aal2' && ((await needsMfa()) || (await hasOwnAuthenticator()))) redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
}

/**
 * The person turned two-step on for themselves (a verified authenticator), even where nothing requires it: then we
 * always ask for the code. Read from the session (no network call).
 */
export const hasOwnAuthenticator = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
});

export type Organization = Pick<Tables<'organizations'>, 'id' | 'name' | 'slug' | 'is_demo' | 'timezone' | 'status'>;

export interface OrgContext {
  user: SessionUser;
  org: Organization;
  grants: Grant[];
  /** Holds the permission at any scope (org, team or self). For UI gating only — RLS enforces. */
  can(key: PermissionKey, scope?: PermissionScope): boolean;
}

interface ShellBundle {
  org: Organization | null;
  grants: Grant[];
  platform_admin: boolean;
  needs_mfa: boolean;
  /** No password yet (invited, or email links only): they choose one before anything else. */
  needs_password?: boolean;
  disabled_modules: string[];
}

/** What getOrgContext already learned this request, so isPlatformAdmin / disabledModules / needsMfa skip their own queries. */
export const requestShell = cache(() => ({ platformAdmin: undefined as boolean | undefined, needsMfa: undefined as boolean | undefined, disabled: new Map<string, Set<string>>() }));

/**
 * Resolves the organization from the URL slug *through RLS*: a slug the user isn't a member of
 * returns nothing and becomes a 404, so URLs can't be used to probe other tenants. One round trip
 * (my_org_context) brings the organization, permissions, platform-admin flag, two-factor requirement
 * and switched-off modules.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_org_context', { p_slug: slug });
  if (error || !data) throw new Error('Failed to load organization');
  const bundle = data as unknown as ShellBundle;
  const shell = requestShell();
  shell.platformAdmin = bundle.platform_admin;
  shell.needsMfa = bundle.needs_mfa;
  // A password first (they need it to sign in again), then two-step where it is switched on.
  if (bundle.needs_password) redirect(`/set-password?next=${encodeURIComponent(`/app/${slug}`)}`);
  // Where the organization requires two-step the database withholds grants at aal1; send them to /mfa before anything renders.
  await requireMfaIfNeeded(user, `/app/${slug}`);
  const org = bundle.org;
  if (!org) {
    // Explain suspension, but only for the caller's own memberships; anything else stays a plain 404.
    const { data: mine } = await supabase.rpc('my_organizations');
    if (mine?.some((o) => o.slug === slug && o.status !== 'active')) redirect(`/app?suspended=${encodeURIComponent(slug)}`);
    notFound();
  }
  shell.disabled.set(org.id, new Set(bundle.disabled_modules));

  const grants = bundle.grants;
  // Platform admins can see the organization row but are not members: no grants → no tenant access.
  if (grants.length === 0) notFound();

  return { user, org, grants, can: (key, scope) => hasGrant(grants, key, scope) };
});

/** Sends people without a password (invited, or email links only) to choose one before anything else. */
export async function requirePasswordSet(nextPath: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_needs_password');
  if (data) redirect(`/set-password?next=${encodeURIComponent(nextPath)}`);
}

export async function requirePermission(slug: string, key: PermissionKey, scope?: PermissionScope): Promise<OrgContext> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can(key, scope)) notFound();
  return ctx;
}

/**
 * Platform admin whose powers apply in this session (two-step done, or not required): the database's rule (app.is_platform_admin).
 * Use this before any secret-key operation; isPlatformAdmin alone is for navigation.
 */
export async function isVerifiedPlatformAdmin(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin())) return false;
  if (user.aal === 'aal2') return true;
  // Two-step is a platform setting (off unless switched on); the database applies the same rule (app.platform_mfa_ok).
  const supabase = await createClient();
  const { data, error } = await supabase.from('platform_settings').select('require_mfa_for_admins').maybeSingle();
  if (error) return false;
  return !data?.require_mfa_for_admins;
}

/** Listed as a platform admin (UI/navigation only; powers also need two-step when the platform switch is on). */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getSessionUser();
  if (!user) return false;
  const known = requestShell().platformAdmin;
  if (known !== undefined) return known;
  const supabase = await createClient();
  const { data } = await supabase.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return Boolean(data);
});
