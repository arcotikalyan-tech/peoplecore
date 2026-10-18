import 'server-only';
import { createClient } from './supabase';

/**
 * Grievance cases. Visibility is decided in the database (reporter, case managers not named in the case, chosen
 * investigators). What was written is read only through `grievance_case`, which records a handler's read.
 */

export async function listGrievances(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('grievances')
    .select('id, number, reporter_id, category, subject, status, created_at, updated_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load cases (${error.code})`);
  return data;
}

/** The case with its description and outcome, or null without access. Each handler's call is audited. */
export async function getGrievance(caseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grievance_case', { p_case: caseId });
  if (error) throw new Error(`Failed to load the case (${error.code})`);
  return data[0] ?? null;
}

export async function grievanceThread(caseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grievance_thread', { p_case: caseId });
  if (error) throw new Error(`Failed to load messages (${error.code})`);
  return data;
}

export async function grievancePeople(caseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grievance_people', { p_case: caseId });
  if (error) throw new Error(`Failed to load the people on the case (${error.code})`);
  return data;
}

export async function investigatorOptions(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grievance_investigator_options', { p_org: orgId });
  if (error) throw new Error(`Failed to load investigators (${error.code})`);
  return data;
}
