import 'server-only';
import { createClient } from './supabase';

/**
 * Grievance cases. Visibility is decided in the database (reporter, case managers not named in the case, chosen
 * investigators). What was written is read only through `grievance_case`, which records a handler's read.
 */

/** The cases the caller can see, and which they raised (`mine`): who raised a case isn't readable from the table. */
export async function listGrievances(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grievance_list', { p_org: orgId });
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

/** Files on a case (the reporter: not handlers' internal files). On an anonymous case the reporter's files say "Person who raised it". */
export async function grievanceFiles(caseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grievance_files', { p_case: caseId });
  if (error) throw new Error(`Failed to load the case's files (${error.code})`);
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

// ─── POSH ────────────────────────────────────────────────────────────────────

/** Who is on the Internal Committee today (names and roles), for every member of the organization. */
export async function poshCommittee(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('posh_committee', { p_org: orgId });
  if (error) throw new Error(`Failed to load the Internal Committee (${error.code})`);
  return data;
}

/** The committee register with past and future terms (case managers only; RLS decides). */
export async function poshRegister(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('posh_committee_members')
    .select('id, role, employee_id, external_name, external_org, woman, term_from, term_until')
    .eq('organization_id', orgId).order('term_until', { ascending: false }).order('role');
  if (error) throw new Error(`Failed to load the committee register (${error.code})`);
  return data;
}

/** A POSH case's recorded steps (its handlers only), or null before any is recorded. */
export async function poshSteps(caseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('posh_case_steps')
    .select('filing_extended_on, conciliation_requested_on, conciliation_settled_on, notice_sent_on, reply_received_on, inquiry_completed_on, report_sent_on, action_taken_on, action_kind')
    .eq('grievance_id', caseId).maybeSingle();
  if (error) throw new Error(`Failed to load the case's steps (${error.code})`);
  return data;
}

export async function poshSessions(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('posh_sessions').select('id, held_on, audience, title, attendees')
    .eq('organization_id', orgId).order('held_on', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load sessions (${error.code})`);
  return data;
}

export interface PoshAnnualReport {
  year: number; received: number; disposed: number; pending_over_90_days: number; workshops: number; committee_sessions: number; actions: Record<string, number>;
}

/** The figures for the committee's annual report (section 21, rule 14): counts only. */
export async function poshAnnualReport(orgId: string, year: number): Promise<PoshAnnualReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('posh_annual_report', { p_org: orgId, p_year: year });
  if (error) throw new Error(`Failed to build the annual report (${error.code})`);
  return data as unknown as PoshAnnualReport;
}
