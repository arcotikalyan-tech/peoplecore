import 'server-only';
import type { ApplicationStage } from '@peoplecore/shared';
import { getInterviews, getOffers, type InterviewView, type OfferView } from './recruitment';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/** Hiring OS reads across all of the organization's jobs. RLS decides what each person sees. */

export interface HiringApplication {
  id: string; stage: ApplicationStage; stageChangedAt: string; createdAt: string; createdBy: string | null; requisitionId: string; employeeId: string | null;
  candidate: { id: string; name: string; firstName: string; email: string | null; phone: string | null; source: string; company: string | null; createdAt: string };
}
export interface HiringJob { id: string; code: string; title: string; status: 'open' | 'on_hold' | 'closed'; openings: number; department_id: string | null; hiring_manager_employee_id: string | null; is_published: boolean; created_at: string }

export async function hiringData(orgId: string) {
  const supabase = await createClient();
  const [jobs, apps] = await Promise.all([
    supabase.from('job_requisitions').select('id, code, title, status, openings, department_id, hiring_manager_employee_id, is_published, created_at')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(1000),
    allRows((a, b) => supabase.from('applications').select('id, stage, stage_changed_at, created_at, created_by, requisition_id, candidate_id, converted_employee_id')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).order('id').range(a, b)),
  ]);
  if (jobs.error || apps.error) throw new Error('Failed to load hiring data');
  const candidateIds = [...new Set(apps.data.map((a) => a.candidate_id))];
  const people = new Map<string, { id: string; first_name: string; last_name: string | null; email: string | null; phone: string | null; source: string; current_company: string | null; created_at: string }>();
  for (let i = 0; i < candidateIds.length; i += 500) {
    const { data } = await supabase.from('candidates').select('id, first_name, last_name, email, phone, source, current_company, created_at')
      .eq('organization_id', orgId).in('id', candidateIds.slice(i, i + 500));
    for (const c of data ?? []) people.set(c.id, c);
  }
  const applications: HiringApplication[] = apps.data.flatMap((a) => {
    const c = people.get(a.candidate_id);
    if (!c) return [];
    return [{
      id: a.id, stage: a.stage, stageChangedAt: a.stage_changed_at, createdAt: a.created_at, createdBy: a.created_by, requisitionId: a.requisition_id,
      employeeId: a.converted_employee_id,
      candidate: { id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' '), firstName: c.first_name, email: c.email, phone: c.phone, source: c.source, company: c.current_company, createdAt: c.created_at },
    }];
  });
  return { jobs: jobs.data as HiringJob[], applications };
}

export async function hiringInterviewsAndOffers(orgId: string, applicationIds: string[]): Promise<{ interviews: InterviewView[]; offers: Map<string, OfferView> }> {
  const ids = applicationIds.slice(0, 2000);
  const [interviews, offers] = await Promise.all([getInterviews(orgId, ids), getOffers(orgId, ids)]);
  return { interviews, offers };
}

export async function hiringPlans(orgId: string) {
  const supabase = await createClient();
  const [plans, lines] = await Promise.all([
    supabase.from('hiring_plans').select('id, name, period_kind, period_start, note, created_at').eq('organization_id', orgId).order('period_start', { ascending: false }),
    supabase.from('hiring_plan_lines').select('id, plan_id, department_id, headcount, budget').eq('organization_id', orgId),
  ]);
  return (plans.data ?? []).map((p) => ({ ...p, lines: (lines.data ?? []).filter((l) => l.plan_id === p.id).map((l) => ({ ...l, budget: l.budget === null ? null : Number(l.budget) })) }));
}

export async function talentPools(orgId: string) {
  const supabase = await createClient();
  const [pools, members] = await Promise.all([
    supabase.from('talent_pools').select('id, name, description, created_at').eq('organization_id', orgId).order('name'),
    supabase.from('talent_pool_members').select('pool_id, candidate_id, note, added_at').eq('organization_id', orgId),
  ]);
  return (pools.data ?? []).map((p) => ({ ...p, members: (members.data ?? []).filter((m) => m.pool_id === p.id) }));
}

export async function emailTemplates(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('recruiting_email_templates').select('id, name, kind, subject, body, updated_at').eq('organization_id', orgId).order('name');
  return data ?? [];
}

export async function recruitingSpend(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('recruiting_spend').select('id, source, month, amount, note').eq('organization_id', orgId).order('month', { ascending: false });
  return (data ?? []).map((s) => ({ ...s, amount: Number(s.amount) }));
}

export async function recruitingSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('recruitment_settings').select('stall_days, notify_hiring_manager, candidate_retention_days').eq('organization_id', orgId).maybeSingle();
  return { stall_days: data?.stall_days ?? 7, notify_hiring_manager: data?.notify_hiring_manager ?? true, candidate_retention_days: data?.candidate_retention_days ?? 365 };
}

export async function recruitingActivity(orgId: string, limit = 200) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recruiting_activity', { p_org: orgId, p_limit: limit });
  return error ? [] : data;
}

export async function recruitingTeam(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recruiting_team', { p_org: orgId });
  return error ? [] : data;
}

/** Fills a template's {{variables}}. Unknown variables are left as they are. */
export function fillTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}
export const TEMPLATE_VARIABLES = ['candidate_name', 'candidate_first_name', 'job_title', 'company', 'recruiter_name', 'interview_time'] as const;
