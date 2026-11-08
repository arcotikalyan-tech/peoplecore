import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { clearDeviceFiles } from './device-files';
import { queue } from './punches';
import { forgetPhone } from './push';
import { forgetWorkplace, rememberedWorkplace, rememberWorkplace } from './offline-memory';
import { savedSession, supabase } from './supabase';
import { within } from './timeout';
import { codeNeeded, signInProblem } from './two-step-rules';
import { pickWorkplace, sameWorkplace, type OrgChoice } from './workplace-choice';

export interface Workplace {
  orgId: string;
  orgName: string;
  slug: string;
  timezone: string;
  employeeId: string | null;
  employeeName: string | null;
  /** Modules the organization switched off (Settings › Module selector): their tabs and shortcuts are hidden. */
  off: string[];
}

interface SessionState {
  loading: boolean;
  session: Session | null;
  workplace: Workplace | null;
  /** Every active organization the person belongs to (more than one: Me offers a switch). */
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
  /**
   * Re-reads the workplace: an employee record HR added after sign-in, modules switched on or off. Also done whenever the
   * app comes back to the front. Keeps what it has if a read fails (offline, the phone still checks in).
   */
  refreshWorkplace(): Promise<void>;
  signIn(email: string, password: string): Promise<string | null>;
  verifyCode(code: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

const CHOSEN = 'workplace.org';
/** How long each step of opening the app waits on the network before going on with what the phone remembers. */
const START_LIMIT_MS = 8000;
/** A token is renewed in about a second with a connection. Longer than this, the app opens from what it remembers. */
const TOKEN_LIMIT_MS = 4000;

/** The workplace, and whether every read succeeded (a refresh keeps what it had when one failed). */
async function loadWorkplace(): Promise<{ workplace: Workplace | null; workplaces: OrgChoice[]; complete: boolean }> {
  const { data, error } = await supabase.rpc('my_organizations');
  const orgs = (data as OrgChoice[] | null) ?? [];
  const workplaces = orgs.filter((o) => o.status === 'active');
  const org = pickWorkplace(orgs, await AsyncStorage.getItem(CHOSEN).catch(() => null));
  const inOrg = org ? await workplaceIn(org) : null;
  return { workplace: inOrg?.workplace ?? null, workplaces, complete: !error && (inOrg?.complete ?? true) };
}

async function workplaceIn(org: OrgChoice): Promise<{ workplace: Workplace; complete: boolean }> {
  const [{ data: details, error: detailsError }, { data: user, error: userError }, { data: modules, error: modulesError }] = await Promise.all([
    supabase.from('organizations').select('timezone').eq('id', org.id).maybeSingle(),
    supabase.auth.getUser(),
    supabase.from('org_modules').select('module, enabled').eq('organization_id', org.id),
  ]);
  const { data: me, error: meError } = user.user
    ? await supabase.from('employees').select('id, first_name, last_name').eq('organization_id', org.id).eq('user_id', user.user.id).maybeSingle()
    : { data: null, error: null };
  return {
    workplace: {
      orgId: org.id, orgName: org.name, slug: org.slug, timezone: (details?.timezone as string | undefined) ?? 'Asia/Kolkata',
      employeeId: me?.id ?? null, employeeName: me ? [me.first_name, me.last_name].filter(Boolean).join(' ') : null,
      off: ((modules ?? []) as Array<{ module: string; enabled: boolean }>).filter((m) => !m.enabled).map((m) => m.module),
    },
    complete: !detailsError && !userError && !modulesError && !meError,
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
    // No signal, or one that has stalled: the app still opens, within a few seconds. Two-step is enforced by the server.
    const steps = await within(Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.rpc('my_mfa_requirement'),
      supabase.auth.mfa.listFactors(),
    ]), START_LIMIT_MS, null);
    if (steps) {
      const [{ data: aal }, { data: required }, { data: factors }] = steps;
      const has = (factors?.totp ?? []).length > 0;
      setHasAuthenticator(has);
      setTwoStepRequired(Boolean(required));
      setNeedsCode(codeNeeded({ currentLevel: aal?.currentLevel, required: Boolean(required), hasAuthenticator: has }));
    }
    const loaded = await within(loadWorkplace(), START_LIMIT_MS, { workplace: null, workplaces: [], complete: false });
    if (loaded.complete) {
      if (loaded.workplace) void rememberWorkplace(AsyncStorage, s.user.id, loaded.workplace);
      // Unchanged, it stays the same object: a signed-in session refreshing itself doesn't reload every screen.
      setWorkplace((had) => (sameWorkplace(had, loaded.workplace) ? had : loaded.workplace));
      setWorkplaces(loaded.workplaces);
    } else {
      // The read failed: keep what's open, or what was last known, so someone with no signal can still check in.
      const known = await rememberedWorkplace<Workplace>(AsyncStorage, s.user.id);
      setWorkplace((had) => had ?? known ?? loaded.workplace);
    }
  }, []);

  const refreshWorkplace = useCallback(async () => {
    if (!(await supabase.auth.getSession()).data.session) return;
    const loaded = await loadWorkplace();
    if (!loaded.complete) return;
    setWorkplace((had) => (sameWorkplace(had, loaded.workplace) ? had : loaded.workplace));
    setWorkplaces((had) => (JSON.stringify(had) === JSON.stringify(loaded.workplaces) ? had : loaded.workplaces));
  }, []);

  useEffect(() => {
    const start = async () => {
      const found = await within(supabase.auth.getSession(), TOKEN_LIMIT_MS, null);
      if (found && !isAuthRetryableFetchError(found.error)) return refresh(found.data.session);
      // An expired token can't be renewed with no signal, and Supabase keeps trying for 30 seconds. The session is still
      // saved: open with what the phone remembers now, and it's renewed once there's a connection.
      const saved = await savedSession();
      if (saved) {
        const known = await rememberedWorkplace<Workplace>(AsyncStorage, saved.user.id);
        setSession(saved);
        setWorkplace((had) => had ?? known);
      }
      setLoading(false);
      return refresh(saved);
    };
    void start().finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // At start-up this says "nobody" when an expired token couldn't be renewed; start() above has the real answer.
      if (event !== 'INITIAL_SESSION') void refresh(s);
    });
    // A record HR added (or a module switched) while the app sat in the background shows when it comes back.
    const front = AppState.addEventListener('change', (state) => { if (state === 'active') void refreshWorkplace(); });
    return () => { data.subscription.unsubscribe(); front.remove(); };
  }, [refresh, refreshWorkplace]);

  const value = useMemo<SessionState>(() => ({
    loading, session, workplace, workplaces, needsCode, hasAuthenticator, twoStepRequired,
    async switchWorkplace(org) {
      const next = workplaces.find((o) => o.id === org || o.slug === org);
      if (!next || next.id === workplace?.orgId) return;
      await AsyncStorage.setItem(CHOSEN, next.id).catch(() => undefined);
      setWorkplace((await workplaceIn(next)).workplace);
    },
    async reload() {
      await refresh((await supabase.auth.getSession()).data.session);
    },
    refreshWorkplace,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return signInProblem(error);
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
      // Payslips and punch photos don't stay on the phone; a punch still waiting to be sent keeps its photo.
      const waiting = await queue.all().catch(() => []);
      await clearDeviceFiles(waiting.flatMap((p) => (p.photoUri ? [p.photoUri] : [])), { payslips: true, photos: true }).catch(() => undefined);
      await AsyncStorage.removeItem(CHOSEN).catch(() => undefined);
      if (session) await forgetWorkplace(AsyncStorage, session.user.id);
      await supabase.auth.signOut();
    },
  }), [loading, session, workplace, workplaces, needsCode, hasAuthenticator, twoStepRequired, refresh, refreshWorkplace]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
