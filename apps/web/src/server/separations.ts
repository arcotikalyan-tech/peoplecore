import 'server-only';
import { createClient } from './supabase';

/**
 * Separations and clearance. RLS: the employee, their reporting line, HR; IT and finance once approved. Why someone
 * left and the exit interview come only from `separation_details` (the employee and HR).
 */

// One literal, so the typed client can read the columns.
const COLUMNS = 'id, employee_id, type, reason_category, initiated_by, submitted_on, requested_last_day, notice_days, notice_end, last_working_day, shortfall_days, shortfall_treatment, status, approval_request_id, decided_at, completed_at, rehire_eligible, alumni_opt_in, created_at';

export async function listSeparations(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('separations').select(COLUMNS)
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error(`Failed to load separations (${error.code})`);
  return data;
}

export async function getSeparation(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('separations').select(COLUMNS).eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load the separation (${error.code})`);
  return data;
}

export async function separationDetails(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('separation_details', { p_separation: id });
  if (error) throw new Error(`Failed to load the separation (${error.code})`);
  return data[0] ?? null;
}

/** Checklist items the caller can see, for some separations. */
export async function clearanceItems(orgId: string, separationIds: string[]) {
  if (separationIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('clearance_items')
    .select('id, separation_id, kind, ref_id, title, owner, status, note, cleared_at')
    .eq('organization_id', orgId).in('separation_id', separationIds).order('created_at');
  if (error) throw new Error(`Failed to load clearance (${error.code})`);
  return data;
}

export async function noticePeriods(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('notice_periods').select('employment_type, notice_days').eq('organization_id', orgId);
  if (error) throw new Error(`Failed to load notice periods (${error.code})`);
  return data;
}

export async function getSettlement(orgId: string, separationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('fnf_settlements')
    .select('id, status, inputs_hash, lines, earnings, deductions, net, engine_version, prepared_by, prepared_at, approved_by, approved_at')
    .eq('organization_id', orgId).eq('separation_id', separationId).maybeSingle();
  if (error) throw new Error(`Failed to load the settlement (${error.code})`);
  return data;
}

export async function retentionPolicies(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('retention_policies').select('record_class, retain_months').eq('organization_id', orgId).order('record_class');
  if (error) throw new Error(`Failed to load retention (${error.code})`);
  return data;
}
