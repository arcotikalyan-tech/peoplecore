import 'server-only';
import { addDays, startOfDayIn } from '@peoplecore/shared';
import { createClient } from './supabase';

export const AUDIT_PAGE_SIZE = 50;
/** The most rows one export holds; a longer period is exported in parts. */
export const AUDIT_EXPORT_MAX = 50_000;

/** Days in the organization's time zone, both included (YYYY-MM-DD; either may be missing). */
export interface AuditRange { from?: string; to?: string }

type Client = Awaited<ReturnType<typeof createClient>>;

// The builder itself is awaitable (awaiting it runs the query), so this stays synchronous.
function auditQuery(supabase: Client, orgId: string, range: AuditRange, timeZone: string, count?: 'exact') {
  let q = supabase
    .from('audit_events')
    .select('id, occurred_at, actor_user_id, action, entity_type, entity_id, changes', count ? { count } : undefined)
    .eq('organization_id', orgId);
  if (range.from) q = q.gte('occurred_at', startOfDayIn(range.from, timeZone).toISOString());
  if (range.to) q = q.lt('occurred_at', startOfDayIn(addDays(range.to, 1), timeZone).toISOString());
  return q.order('occurred_at', { ascending: false }).order('id', { ascending: false });
}

export async function listAuditEvents(orgId: string, page: number, range: AuditRange = {}, timeZone = 'UTC') {
  const supabase = await createClient();
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  const { data, count, error } = await auditQuery(supabase, orgId, range, timeZone, 'exact').range(from, from + AUDIT_PAGE_SIZE - 1);
  if (error?.code === 'PGRST103') return { rows: [], total: 0 };
  if (error) throw new Error(`Failed to load audit log (${error.code})`);
  return { rows: data, total: count ?? 0 };
}

/** Every event in the period, newest first, for the CSV export (at most AUDIT_EXPORT_MAX; `more` when there were more). */
export async function auditEventsForExport(orgId: string, range: AuditRange, timeZone: string) {
  const supabase = await createClient();
  const rows = [];
  for (let from = 0; from <= AUDIT_EXPORT_MAX; from += 1000) {
    const { data, error } = await auditQuery(supabase, orgId, range, timeZone).range(from, Math.min(from + 1000, AUDIT_EXPORT_MAX + 1) - 1);
    if (error?.code === 'PGRST103') break;
    if (error) throw new Error(`Failed to export audit log (${error.code})`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return { rows: rows.slice(0, AUDIT_EXPORT_MAX), more: rows.length > AUDIT_EXPORT_MAX };
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
