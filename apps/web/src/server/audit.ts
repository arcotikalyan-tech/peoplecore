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

export async function auditForEntities(orgId: string, entityIds: readonly string[], limit = 25) {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, occurred_at, actor_user_id, action, entity_type, entity_id, changes')
    .eq('organization_id', orgId)
    .in('entity_id', [...entityIds])
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load activity (${error.code})`);
  return data;
}

export type AuditEvent = Awaited<ReturnType<typeof auditForEntities>>[number];
