import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase';

/** The signed-in user's inbox: approvals they can decide, their open tasks and their notifications. */

export async function unreadNotificationCount(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId).is('read_at', null);
  return error ? 0 : (count ?? 0); // the badge is a convenience; never break the page over it
}

/** The approvals the caller can decide, once per request (the leave page counts them and its hub lists them). */
export const myPendingApprovals = cache(async (orgId: string) => (await createClient()).rpc('my_pending_approvals', { p_org: orgId }));

export async function getInbox(orgId: string, myEmployeeId: string | null) {
  const supabase = await createClient();
  const [approvals, notifications, tasks] = await Promise.all([
    myPendingApprovals(orgId),
    supabase.from('notifications').select('id, kind, title, body, link, read_at, created_at')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
    myEmployeeId
      ? supabase.from('tasks').select('id, title, details, due_on, status, created_at, subject_type')
        .eq('organization_id', orgId).eq('assignee_employee_id', myEmployeeId).eq('status', 'open')
        .order('due_on', { ascending: true, nullsFirst: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (approvals.error || notifications.error || tasks.error) throw new Error('Failed to load your inbox');
  return { approvals: approvals.data, notifications: notifications.data, tasks: tasks.data ?? [] };
}
