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
