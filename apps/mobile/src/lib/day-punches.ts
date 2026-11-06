import { addDays, startOfDayIn } from '@peoplecore/shared/dates';
import { punchLabels, punchPlace, type PunchKind, type PunchPlace } from '@peoplecore/shared/punches';
import { SITE_URL } from './site';
import { supabase } from './supabase';
import { within } from './timeout';

export interface DayPunch {
  id: string;
  label: string;
  at: string;
  hasPhoto: boolean;
  place: PunchPlace | null;
}

interface PunchRow {
  id: string; punched_at: string; kind: PunchKind | null; latitude: number | null; longitude: number | null; accuracy_m: number | null; selfie_path: string | null;
}

/** One person's punches on a local date. RLS decides who gets them: yourself, your team, or everyone for HR. */
export async function loadDayPunches(orgId: string, employeeId: string, date: string, timeZone: string): Promise<DayPunch[]> {
  const { data, error } = await supabase.from('attendance_punches').select('id, punched_at, kind, latitude, longitude, accuracy_m, selfie_path')
    .eq('organization_id', orgId).eq('employee_id', employeeId)
    .gte('punched_at', startOfDayIn(date, timeZone).toISOString()).lt('punched_at', startOfDayIn(addDays(date, 1), timeZone).toISOString())
    .order('punched_at');
  if (error) throw error;
  const rows = (data ?? []) as PunchRow[];
  const labels = punchLabels(rows);
  return rows.map((p, i) => ({ id: p.id, label: labels[i]!, at: p.punched_at, hasPhoto: !!p.selfie_path, place: punchPlace(p) }));
}

/** A short-lived link to a punch's photo, from the app server, which checks who may see it; null if it can't be had. */
export function punchPhotoUrl(punchId: string): Promise<string | null> {
  const ask = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${SITE_URL}/api/mobile/punch-photo?punch=${encodeURIComponent(punchId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return ((await res.json()) as { url?: string }).url ?? null;
  };
  return within(ask().catch(() => null), 15_000, null);
}
