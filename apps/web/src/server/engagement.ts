import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase';

/** Announcements, kudos and the colleague directory. RLS decides who sees which announcement. */

export async function listAnnouncements(orgId: string, employeeId: string | null) {
  const supabase = await createClient();
  const [list, acks] = await Promise.all([
    supabase.from('announcements').select('id, title, body, image_path, department_id, location_id, requires_ack, published_at, expires_at')
      .eq('organization_id', orgId).order('published_at', { ascending: false }).limit(50),
    employeeId
      ? supabase.from('announcement_acknowledgements').select('announcement_id, acknowledged_at').eq('employee_id', employeeId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (list.error || acks.error) throw new Error('Failed to load announcements');
  const acked = new Map(acks.data.map((a) => [a.announcement_id, a.acknowledged_at]));
  return list.data.map((a) => ({ ...a, acknowledgedAt: acked.get(a.id) ?? null }));
}

/** Who has acknowledged each announcement (announcement.manage only; RLS returns nothing otherwise). */
export async function acknowledgementCounts(orgId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.from('announcement_acknowledgements').select('announcement_id')
    .eq('organization_id', orgId).in('announcement_id', ids);
  if (error) throw new Error('Failed to load acknowledgements');
  const counts = new Map<string, number>();
  for (const r of data) counts.set(r.announcement_id, (counts.get(r.announcement_id) ?? 0) + 1);
  return counts;
}

export async function kudosFeed(orgId: string, limit = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('kudos_feed', { p_org: orgId, p_limit: limit });
  if (error) throw new Error(`Failed to load kudos (${error.code})`);
  return data;
}

/** Current colleagues (name, department, designation); every member may read this projection. Capped at 500. */
export const colleagueDirectory = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('colleague_directory', { p_org: orgId, p_limit: 500 });
  if (error) throw new Error(`Failed to load colleagues (${error.code})`);
  return data;
});

export async function colleagueOptions(orgId: string, excludeId?: string) {
  return (await colleagueDirectory(orgId)).filter((c) => c.id !== excludeId)
    .map((c) => ({ value: c.id, label: [c.name, c.designation ?? c.department].filter(Boolean).join(' · ') }));
}

export async function colleagueNames(orgId: string): Promise<Map<string, string>> {
  return new Map((await colleagueDirectory(orgId)).map((c) => [c.id, c.name]));
}
