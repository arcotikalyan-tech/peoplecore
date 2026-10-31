import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { pushSupported } from './push';
import { useSession } from './session';
import { supabase } from './supabase';

interface Counts {
  /** Requests waiting for this person's decision. */
  approvals: number;
  /** Notifications not read yet. */
  unread: number;
  refresh(): Promise<void>;
}

const Ctx = createContext<Counts>({ approvals: 0, unread: 0, refresh: async () => undefined });

/**
 * The numbers on the Inbox tab and the bell: read when the workplace opens, when the app comes back to the front,
 * when a notification arrives, and after anything that changes them (a decision, "Mark all read").
 */
export function CountsProvider({ children }: { children: ReactNode }) {
  const { workplace } = useSession();
  const [approvals, setApprovals] = useState(0);
  const [unread, setUnread] = useState(0);
  const orgId = workplace?.orgId;

  const refresh = useCallback(async () => {
    if (!orgId) { setApprovals(0); setUnread(0); return; }
    const [pending, notes] = await Promise.all([
      supabase.rpc('my_pending_approvals', { p_org: orgId }),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('read_at', null),
    ]);
    if (!pending.error) setApprovals((pending.data ?? []).length);
    if (!notes.error) setUnread(notes.count ?? 0);
  }, [orgId]);

  useEffect(() => {
    void refresh();
    const front = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    const arrived = pushSupported ? Notifications.addNotificationReceivedListener(() => void refresh()) : null;
    return () => { front.remove(); arrived?.remove(); };
  }, [refresh]);

  const value = useMemo(() => ({ approvals, unread, refresh }), [approvals, unread, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCounts = () => useContext(Ctx);
