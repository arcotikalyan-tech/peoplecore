import 'server-only';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/** My Profile reads. Everything goes through RLS (or own-only functions), so a tab shows only what the viewer may see. */

export async function qualifications(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('employee_qualifications')
    .select('id, level, degree, specialization, institution, start_year, end_year, score')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('end_year', { ascending: false, nullsFirst: true });
  if (error) throw new Error(`Failed to load education (${error.code})`);
  return data;
}

export async function familyMembers(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('employee_family_members')
    .select('id, name, relationship, date_of_birth, gender, phone, occupation, is_dependent')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('created_at');
  if (error) throw new Error(`Failed to load family (${error.code})`);
  return data;
}

export async function profileDocuments(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('employee_documents')
    .select('id, category, title, file_name, size_bytes, uploaded_by, created_at, proves, verified_at')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load documents (${error.code})`);
  return data;
}

/** Published policies and whether this employee acknowledged each. */
export async function policiesFor(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const [policies, acks] = await Promise.all([
    supabase.from('policy_documents').select('id, title, version, requires_acknowledgement, published_at')
      .eq('organization_id', orgId).is('retired_at', null).order('title'),
    supabase.from('policy_acknowledgements').select('policy_id, acknowledged_at').eq('organization_id', orgId).eq('employee_id', employeeId),
  ]);
  const acked = new Map((acks.data ?? []).map((a) => [a.policy_id, a.acknowledged_at]));
  return (policies.data ?? []).map((p) => ({ ...p, acknowledged_at: acked.get(p.id) ?? null }));
}

export async function myFiles(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_file_activity', { p_org: orgId, p_limit: 200 });
  if (error) throw new Error(`Failed to load your files (${error.code})`);
  return data;
}

/** Punches on one local date (the window is padded; the page filters to the date in the org's time zone). */
export async function punchesOn(orgId: string, employeeId: string, date: string) {
  const supabase = await createClient();
  const from = new Date(`${date}T00:00:00Z`); from.setUTCHours(-14);
  const to = new Date(`${date}T00:00:00Z`); to.setUTCHours(38);
  const { data, error } = await supabase.from('attendance_punches').select('id, punched_at, method, latitude, longitude, selfie_path')
    .eq('organization_id', orgId).eq('employee_id', employeeId).gte('punched_at', from.toISOString()).lt('punched_at', to.toISOString()).order('punched_at');
  if (error) throw new Error(`Failed to load punches (${error.code})`);
  return data;
}

export async function reviewsFor(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data: reviews } = await supabase.from('reviews').select('id, cycle_id, status, final_rating').eq('organization_id', orgId).eq('employee_id', employeeId);
  const ids = (reviews ?? []).map((r) => r.cycle_id);
  const { data: cycles } = ids.length
    ? await supabase.from('review_cycles').select('id, name, period_start, period_end').in('id', ids)
    : { data: [] as Array<{ id: string; name: string; period_start: string; period_end: string }> };
  const byId = new Map((cycles ?? []).map((c) => [c.id, c]));
  return (reviews ?? []).map((r) => ({ ...r, cycle: byId.get(r.cycle_id) ?? null }))
    .sort((a, b) => (b.cycle?.period_start ?? '').localeCompare(a.cycle?.period_start ?? ''));
}

export async function separationFor(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('separations')
    .select('id, type, status, submitted_on, notice_days, last_working_day')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

export async function noticeDaysFor(orgId: string, employmentType: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('notice_periods').select('employment_type, notice_days').eq('organization_id', orgId);
  return (data ?? []).find((n) => n.employment_type === employmentType)?.notice_days ?? 30;
}

/** A colleague's name from the directory (for people who can't read the colleague's record, e.g. their manager). */
export async function directoryName(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data } = await allRows((a, b) => supabase.rpc('people_directory', { p_org: orgId, p_limit: 100_000 }).range(a, b));
  return (data ?? []).find((r) => r.id === employeeId)?.name ?? null;
}
