import { supabase } from './supabase';

export interface Holiday { holiday_date: string; name: string; is_optional: boolean }

/**
 * Holidays on the person's own calendar (their office's, else the organization's default) from a date on, once each
 * (a holiday listed twice on one calendar shows once).
 */
export async function loadHolidays(orgId: string, from: string, to?: string, limit = 60): Promise<Holiday[]> {
  const { data: mine } = await supabase.rpc('my_holiday_calendar', { p_org: orgId });
  const calendar = (mine as string | null)
    ?? (await supabase.from('holiday_calendars').select('id').eq('organization_id', orgId).is('location_id', null).limit(1).maybeSingle()).data?.id;
  if (!calendar) return [];
  let q = supabase.from('holidays').select('holiday_date, name, is_optional').eq('organization_id', orgId).eq('calendar_id', calendar).gte('holiday_date', from);
  if (to) q = q.lte('holiday_date', to);
  const { data, error } = await q.order('holiday_date').limit(limit);
  if (error) throw error;
  const seen = new Set<string>();
  return ((data ?? []) as Holiday[]).filter((h) => !seen.has(h.holiday_date + h.name) && seen.add(h.holiday_date + h.name));
}
