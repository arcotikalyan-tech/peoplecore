import 'server-only';
import type { ApplicationStage } from '@peoplecore/shared';
import { createClient } from './supabase';

/** Recruitment reads. RLS decides visibility (org-wide recruiters/HR; managers for their line's requisitions). */

export async function listRequisitions(orgId: string) {
  const supabase = await createClient();
  const [reqs, apps] = await Promise.all([
    supabase.from('job_requisitions')
      .select('id, code, title, status, openings, department_id, hiring_manager_employee_id, created_at')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(500),
    supabase.from('applications').select('requisition_id, stage').eq('organization_id', orgId).limit(20_000),
  ]);
  if (reqs.error || apps.error) throw new Error('Failed to load requisitions');
  const counts = new Map<string, { active: number; hired: number }>();
  for (const a of apps.data) {
    const c = counts.get(a.requisition_id) ?? { active: 0, hired: 0 };
    if (a.stage === 'hired') c.hired++;
    else if (a.stage !== 'rejected' && a.stage !== 'withdrawn') c.active++;
    counts.set(a.requisition_id, c);
  }
  return reqs.data.map((r) => ({ ...r, ...(counts.get(r.id) ?? { active: 0, hired: 0 }) }));
}

export async function getRequisition(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('job_requisitions').select('*').eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load requisition (${error.code})`);
  return data;
}

export interface PipelineEntry {
  id: string;
  stage: ApplicationStage;
  stageChangedAt: string;
  note: string | null;
  employeeId: string | null;
  candidate: { id: string; name: string; email: string | null; phone: string | null; source: string; company: string | null };
}

export async function getPipeline(orgId: string, requisitionId: string): Promise<PipelineEntry[]> {
  const supabase = await createClient();
  const { data: apps, error } = await supabase.from('applications')
    .select('id, stage, stage_changed_at, outcome_note, converted_employee_id, candidate_id')
    .eq('organization_id', orgId).eq('requisition_id', requisitionId).order('created_at');
  if (error) throw new Error(`Failed to load applications (${error.code})`);
  if (apps.length === 0) return [];
  const { data: people, error: peopleError } = await supabase.from('candidates')
    .select('id, first_name, last_name, email, phone, source, current_company')
    .eq('organization_id', orgId).in('id', apps.map((a) => a.candidate_id));
  if (peopleError) throw new Error(`Failed to load candidates (${peopleError.code})`);
  const byId = new Map(people.map((p) => [p.id, p]));
  return apps.flatMap((a) => {
    const p = byId.get(a.candidate_id);
    if (!p) return [];
    return [{
      id: a.id, stage: a.stage, stageChangedAt: a.stage_changed_at, note: a.outcome_note, employeeId: a.converted_employee_id,
      candidate: { id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), email: p.email, phone: p.phone, source: p.source, company: p.current_company },
    }];
  });
}

export interface OfferView {
  id: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn';
  version: number;
  annualCtc: number;
  currency: string;
  joiningDate: string;
  expiresOn: string;
  designationId: string | null;
  terms: string | null;
}

/** Offers (current version) for the given applications, keyed by application id. RLS applies. */
export async function getOffers(orgId: string, applicationIds: string[]): Promise<Map<string, OfferView>> {
  if (applicationIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data: offers, error } = await supabase.from('offers').select('id, application_id, status, current_version')
    .eq('organization_id', orgId).in('application_id', applicationIds);
  if (error) throw new Error(`Failed to load offers (${error.code})`);
  if (offers.length === 0) return new Map();
  const { data: versions, error: vError } = await supabase.from('offer_versions')
    .select('offer_id, version, annual_ctc, currency, joining_date, expires_on, designation_id, terms')
    .eq('organization_id', orgId).in('offer_id', offers.map((o) => o.id));
  if (vError) throw new Error(`Failed to load offers (${vError.code})`);
  return new Map(offers.flatMap((o) => {
    const v = versions.find((x) => x.offer_id === o.id && x.version === o.current_version);
    return v ? [[o.application_id, {
      id: o.id, status: o.status, version: o.current_version, annualCtc: Number(v.annual_ctc), currency: v.currency,
      joiningDate: v.joining_date, expiresOn: v.expires_on, designationId: v.designation_id, terms: v.terms,
    }]] : [];
  }));
}

export interface InterviewView {
  id: string;
  applicationId: string;
  round: string;
  scheduledAt: string;
  mode: string;
  status: string;
  panel: Array<{ employeeId: string; recommendation: string | null }>;
}

/** Interviews with their panel and (where the viewer may see them) each panelist's recommendation. */
export async function getInterviews(orgId: string, applicationIds: string[]): Promise<InterviewView[]> {
  if (applicationIds.length === 0) return [];
  const supabase = await createClient();
  const { data: interviews, error } = await supabase.from('interviews').select('id, application_id, round_name, scheduled_at, mode, status')
    .eq('organization_id', orgId).in('application_id', applicationIds).order('scheduled_at');
  if (error) throw new Error(`Failed to load interviews (${error.code})`);
  if (interviews.length === 0) return [];
  const ids = interviews.map((i) => i.id);
  const [panel, cards] = await Promise.all([
    supabase.from('interview_panelists').select('interview_id, employee_id').in('interview_id', ids),
    supabase.from('scorecards').select('interview_id, panelist_employee_id, recommendation').in('interview_id', ids),
  ]);
  if (panel.error || cards.error) throw new Error('Failed to load interview panels');
  return interviews.map((i) => ({
    id: i.id, applicationId: i.application_id, round: i.round_name, scheduledAt: i.scheduled_at, mode: i.mode, status: i.status,
    panel: panel.data.filter((p) => p.interview_id === i.id).map((p) => ({
      employeeId: p.employee_id,
      recommendation: cards.data.find((c) => c.interview_id === i.id && c.panelist_employee_id === p.employee_id)?.recommendation ?? null,
    })),
  }));
}

export async function getMyInterviews(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_interviews', { p_org: orgId });
  if (error) throw new Error(`Failed to load your interviews (${error.code})`);
  return data;
}

/** Candidate consent expiry (T15): the organization's period, and who the daily job erases within 30 days. */
export async function candidateRetention(orgId: string) {
  const supabase = await createClient();
  const [setting, due] = await Promise.all([
    supabase.from('recruitment_settings').select('candidate_retention_days').eq('organization_id', orgId).maybeSingle(),
    supabase.rpc('candidates_due_for_erasure', { p_org: orgId, p_days: 30 }),
  ]);
  if (setting.error || due.error) throw new Error('Failed to load candidate retention');
  return { days: setting.data?.candidate_retention_days ?? 365, due: due.data };
}
