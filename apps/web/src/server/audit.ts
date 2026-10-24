import 'server-only';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { addDays, startOfDayIn } from '@peoplecore/shared';
import { readAuditArchive } from './document-storage';
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

/** The daily archive so far: how many days are recorded and the latest (audit.read; RLS decides). */
export async function auditArchiveSummary(orgId: string) {
  const supabase = await createClient();
  const { data, count, error } = await supabase.from('audit_archives').select('day, created_at', { count: 'exact' })
    .eq('organization_id', orgId).order('day', { ascending: false }).limit(1);
  if (error) throw new Error(`Failed to load the archive (${error.code})`);
  return { days: count ?? 0, latest: data[0]?.day ?? null, at: data[0]?.created_at ?? null };
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/**
 * Checks the last `days` archived days: each file still holds what was hashed, each chain hash follows from the day
 * before (migration 20261025000400, app.audit_chain), and the log still has as many entries for the day as were
 * archived. Returns what doesn't match, in plain words.
 */
export async function verifyAuditArchive(orgId: string, days = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('audit_archive_check', { p_org: orgId, p_days: days });
  if (error) throw new Error(`Failed to load the archive (${error.code})`);
  const rows = [...data].reverse(); // oldest first
  const problems: string[] = [];
  let before: string | null = null;
  for (const r of rows) {
    if (before !== null && r.prev_chain !== before) problems.push(`${r.day}: doesn’t follow the day before (a day was removed or replaced).`);
    if (sha256(`${r.prev_chain ?? ''}\n${r.day}\n${r.row_count}\n${r.sha256}`) !== r.chain) problems.push(`${r.day}: its record was altered.`);
    if (r.rows_now !== r.row_count) problems.push(`${r.day}: the log now has ${r.rows_now} entries for this day, ${r.row_count} were archived.`);
    if (r.path) {
      const file = await readAuditArchive(r.path);
      if (!file) problems.push(`${r.day}: its file is missing.`);
      else {
        let text: Buffer | null = null;
        try { text = gunzipSync(file); } catch { text = null; }
        if (!text || sha256(text) !== r.sha256) problems.push(`${r.day}: its file was changed.`);
      }
    } else if (r.row_count !== 0 || r.sha256 !== sha256('')) problems.push(`${r.day}: its file is missing.`);
    before = r.chain;
  }
  return { checked: rows.length, from: rows[0]?.day ?? null, to: rows.at(-1)?.day ?? null, problems };
}
