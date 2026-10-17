import 'server-only';
import { createClient } from './supabase';

export const AUDIT_PAGE_SIZE = 50;

export async function listAuditEvents(orgId: string, page: number) {
  const supabase = await createClient();
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from('audit_events')
    .select('id, occurred_at, actor_user_id, action, entity_type, entity_id, changes', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1);
  if (error?.code === 'PGRST103') return { rows: [], total: 0 };
  if (error) throw new Error(`Failed to load audit log (${error.code})`);
  return { rows: data, total: count ?? 0 };
}

/**
 * Activity for one employee: their own row, their history rows (by id, for entries recorded before
 * metadata.employee_id existed) and everything tagged with their employee id (personal, identity, bank…).
 */
export async function activityForEmployee(orgId: string, employeeId: string, relatedIds: readonly string[], limit = 30) {
  const supabase = await createClient();
  const ids = [employeeId, ...relatedIds].join(',');
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, occurred_at, actor_user_id, action, entity_type, entity_id, changes')
    .eq('organization_id', orgId)
    .or(`entity_id.in.(${ids}),metadata->>employee_id.eq.${employeeId}`)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load activity (${error.code})`);
  return data;
}

export type AuditEvent = Awaited<ReturnType<typeof activityForEmployee>>[number];
