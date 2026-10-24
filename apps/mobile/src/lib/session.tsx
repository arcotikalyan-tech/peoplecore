import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { forgetPhone } from './push';
import { supabase } from './supabase';
import { codeNeeded } from './two-step-rules';
import { pickWorkplace, type OrgChoice } from './workplace-choice';

export interface Workplace {
  orgId: string;
  orgName: string;
  slug: string;
  timezone: string;
  employeeId: string | null;
  employeeName: string | null;
}

interface SessionState {
  loading: boolean;
  session: Session | null;
  workplace: Workplace | null;
  /** Every active organization the person belongs to (more than one: Account settings offers a switch). */
  workplaces: OrgChoice[];
  /** Opens the app in another of the person's organizations (by id or slug); remembered on this phone. */
  switchWorkplace(org: string): Promise<void>;
  /**
   * A two-step code is needed before the app opens: the organization requires two-step for everyone, or the person
   * turned it on for themselves (the same rule as the website).
   */
  needsCode: boolean;
  /** The person has an authenticator (they enter its code); without one, a required two-step is set up first. */
  hasAuthenticator: boolean;
  /** The organization (or the platform) requires two-step sign-in. */
  twoStepRequired: boolean;
  /** Reloads the session's two-step state and workplace (after setting up or turning off two-step). */
  reload(): Promise<void>;
  signIn(email: string, password: string): Promise<string | null>;
  verifyCode(code: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

const CHOSEN = 'workplace.org';

async function loadWorkplace(): Promise<{ workplace: Workplace | null; workplaces: OrgChoice[] }> {
  const { data } = await supabase.rpc('my_organizations');
  const orgs = (data as OrgChoice[] | null) ?? [];
  const workplaces = orgs.filter((o) => o.status === 'active');
  const org = pickWorkplace(orgs, await AsyncStorage.getItem(CHOSEN).catch(() => null));
  return { workplace: org ? await workplaceIn(org) : null, workplaces };
}

async function workplaceIn(org: OrgChoice): Promise<Workplace> {
  const [{ data: details }, { data: user }] = await Promise.all([
    supabase.from('organizations').select('timezone').eq('id', org.id).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  const { data: me } = user.user
    ? await supabase.from('employees').select('id, first_name, last_name').eq('organization_id', org.id).eq('user_id', user.user.id).maybeSingle()
    : { data: null };
  return {
    orgId: org.id, orgName: org.name, slug: org.slug, timezone: (details?.timezone as string | undefined) ?? 'Asia/Kolkata',
    employeeId: me?.id ?? null, employeeName: me ? [me.first_name, me.last_name].filter(Boolean).join(' ') : null,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [workplaces, setWorkplaces] = useState<OrgChoice[]>([]);
  const [needsCode, setNeedsCode] = useState(false);
  const [hasAuthenticator, setHasAuthenticator] = useState(false);
  const [twoStepRequired, setTwoStepRequired] = useState(false);

  const refresh = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setWorkplace(null);
      setWorkplaces([]);
      setNeedsCode(false);
      setHasAuthenticator(false);
      setTwoStepRequired(false);
      return;
    }
    const [{ data: aal }, { data: required }, { data: factors }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.rpc('my_mfa_requirement'),
      supabase.auth.mfa.listFactors(),
    ]);
    const has = (factors?.totp ?? []).length > 0;
    setHasAuthenticator(has);
    setTwoStepRequired(Boolean(required));
    setNeedsCode(codeNeeded({ currentLevel: aal?.currentLevel, required: Boolean(required), hasAuthenticator: has }));
    const loaded = await loadWorkplace();
    setWorkplace(loaded.workplace);
    setWorkplaces(loaded.workplaces);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => refresh(data.session)).finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => { void refresh(s); });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo<SessionState>(() => ({
    loading, session, workplace, workplaces, needsCode, hasAuthenticator, twoStepRequired,
    async switchWorkplace(org) {
      const next = workplaces.find((o) => o.id === org || o.slug === org);
      if (!next || next.id === workplace?.orgId) return;
      await AsyncStorage.setItem(CHOSEN, next.id).catch(() => undefined);
      setWorkplace(await workplaceIn(next));
    },
    async reload() {
      await refresh((await supabase.auth.getSession()).data.session);
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? 'That email and password don’t match.' : null;
    },
    async verifyCode(code) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (!totp) return 'Set up two-step sign-in first.';
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim() });
      if (error) return 'That code didn’t work. Try the current one.';
      await refresh((await supabase.auth.getSession()).data.session);
      return null;
    },
    async signOut() {
      await forgetPhone().catch(() => undefined); // offline: the server forgets it once pushes to it fail
      await AsyncStorage.removeItem(CHOSEN).catch(() => undefined);
      await supabase.auth.signOut();
    },
  }), [loading, session, workplace, workplaces, needsCode, hasAuthenticator, twoStepRequired, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
