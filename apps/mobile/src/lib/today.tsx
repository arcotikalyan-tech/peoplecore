import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { startOfDayIn, todayIn } from '@peoplecore/shared/dates';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { QueuedPunch } from './punch-queue';
import { currentPosition, newClientId, queue, sendPunch } from './punches';
import { takeSelfie } from './selfie';
import { selfieRequired } from './selfie-rule';
import { useSession } from './session';
import { supabase } from './supabase';
import type { PunchKind } from '@peoplecore/shared/punches';
import { DEFAULT_DAY, today as dayFrom, type Day } from './worked';

export interface Shift {
  name: string; start_time: string; end_time: string; verify_selfie: boolean;
  full_day_minutes: number; half_day_minutes: number; break_minutes: number;
}
export type PunchMessage = { tone: 'danger' | 'success' | 'muted'; text: string };

interface TodayState {
  /** Today's punches the server has, and those still on this phone. */
  punches: Array<{ id: string; punched_at: string; method: string; kind: PunchKind | null }>;
  pending: QueuedPunch[];
  refused: QueuedPunch[];
  day: Day;
  /** Today's punches have been read at least once: until then the day's state isn't known and nothing can be punched. */
  ready: boolean;
  shift: Shift | null;
  needsSelfie: boolean;
  busy: boolean;
  message: PunchMessage | null;
  /** Check in or out, start or end lunch or a break. */
  punch(kind: PunchKind): Promise<void>;
  sync(): Promise<void>;
  dismiss(clientId: string): Promise<void>;
}

const Ctx = createContext<TodayState | null>(null);

/**
 * Check-in and check-out, shared by Home and Attendance so both show the same day. A punch is saved on the phone
 * first and sent when there's a connection (lib/punch-queue); it's sent again whenever the phone comes back online or
 * the app to the front. The selfie rule is asked again before every punch, since HR can switch it on at any time.
 */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { workplace, session } = useSession();
  // On a shared phone each person sees and sends only their own saved punches.
  const userId = session?.user.id;
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const [punches, setPunches] = useState<TodayState['punches']>([]);
  const [queued, setQueued] = useState<QueuedPunch[]>([]);
  const [shift, setShift] = useState<Shift | null>(null);
  const [needsSelfie, setNeedsSelfie] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<PunchMessage | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // The worked time keeps counting while checked in.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const checkSelfie = useCallback(async () => {
    const employeeId = workplace?.employeeId;
    if (!employeeId) return false;
    const required = await selfieRequired(AsyncStorage, employeeId, async () => {
      const { data, error } = await supabase.rpc('attendance_rule_for', { p_employee: employeeId, p_date: todayIn(tz) });
      if (error) return null;
      const rule = (data as Shift[] | null)?.[0] ?? null;
      setShift(rule);
      return Boolean(rule?.verify_selfie);
    });
    setNeedsSelfie(required);
    return required;
  }, [workplace, tz]);

  const load = useCallback(async () => {
    setQueued(userId ? await queue.all(userId) : []);
    setNow(new Date());
    if (!workplace?.employeeId) { setPunches([]); setReady(true); return; }
    void checkSelfie();
    const start = startOfDayIn(todayIn(tz), tz).toISOString();
    const { data } = await supabase.from('attendance_punches').select('id, punched_at, method, kind')
      .eq('employee_id', workplace.employeeId).gte('punched_at', start).order('punched_at');
    setPunches(data ?? []);
    setReady(true);
  }, [workplace, tz, checkSelfie, userId]);

  const sync = useCallback(async () => {
    if (!userId) return;
    const r = await queue.sync(sendPunch, userId);
    if (r.sent) setMessage({ tone: 'success', text: r.sent === 1 ? 'Recorded.' : `${r.sent} punches recorded.` });
    // Saved either way; say why it didn't go (offline, or what the server said) so a stuck punch isn't a mystery.
    else if (r.waiting) setMessage({ tone: 'muted', text: r.reason && r.reason !== 'No connection.' ? `Saved on this phone, not sent yet: ${r.reason} Pull down to try again.` : 'Saved on this phone. It will be sent when you’re back online.' });
    await load();
  }, [load, userId]);

  useEffect(() => {
    setMessage(null);
    setReady(false);
    void sync();
    const net = NetInfo.addEventListener((state) => { if (state.isConnected) void sync(); });
    const front = AppState.addEventListener('change', (state) => { if (state === 'active') void sync(); });
    return () => { net(); front.remove(); };
  }, [sync]);

  const punch = useCallback(async (kind: PunchKind) => {
    if (!workplace || !ready) return;
    setBusy(true);
    setMessage(null);
    try {
      const selfie = await checkSelfie();
      const where = await currentPosition();
      if ('error' in where) return setMessage({ tone: 'danger', text: where.error });
      // The rule asks for a selfie with every punch (lunch and breaks too): the front camera first.
      let photoUri: string | undefined;
      if (selfie) {
        const shot = await takeSelfie();
        if (!shot || 'error' in shot) {
          return setMessage(shot ? { tone: 'danger', text: shot.error } : { tone: 'muted', text: 'Take a selfie to record the punch.' });
        }
        photoUri = shot.uri;
      }
      await queue.add({ clientId: newClientId(), userId, orgId: workplace.orgId, kind, ...where, ...(photoUri ? { photoUri } : {}) });
      await sync();
    } catch {
      setMessage({ tone: 'danger', text: 'Something went wrong. Try again.' });
    } finally {
      // Whatever happened, the button never keeps spinning.
      setBusy(false);
    }
  }, [workplace, ready, checkSelfie, sync, userId]);

  const dismiss = useCallback(async (clientId: string) => { await queue.dismiss(clientId); await load(); }, [load]);

  const value = useMemo<TodayState>(() => {
    const pending = queued.filter((q) => !q.refused);
    const refused = queued.filter((q) => q.refused);
    const rule = shift
      ? { fullDayMinutes: shift.full_day_minutes, halfDayMinutes: shift.half_day_minutes, breakMinutes: shift.break_minutes }
      : DEFAULT_DAY;
    const day = dayFrom([...punches, ...pending.map((p) => ({ punched_at: p.punchedAt, kind: p.kind ?? null }))], now, rule);
    return { punches, pending, refused, day, ready, shift, needsSelfie, busy, message, punch, sync, dismiss };
  }, [punches, queued, now, ready, shift, needsSelfie, busy, message, punch, sync, dismiss]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToday(): TodayState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToday outside TodayProvider');
  return v;
}
