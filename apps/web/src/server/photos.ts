import 'server-only';
import { signImageUrls } from './document-storage';
import { createClient } from './supabase';

/** Profile photo links for people on a page (employee id → a link valid for an hour); members see colleagues' photos. */
export async function photoUrls(orgId: string, employeeIds: string[]): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.rpc('employee_photos', { p_org: orgId, p_ids: employeeIds.slice(0, 200) });
  const rows = data ?? [];
  const urls = await signImageUrls(rows.map((r) => r.photo_path));
  return new Map(rows.flatMap((r) => { const u = urls.get(r.photo_path); return u ? [[r.employee_id, u] as [string, string]] : []; }));
}
