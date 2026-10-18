import 'server-only';
import { createClient } from './supabase';

/** Onboarding plans and their tasks, templates, and policies. RLS applies throughout. */

export async function getPlans(orgId: string, filter: { employeeId?: string; status?: 'in_progress' | 'completed' | 'cancelled' } = {}) {
  const supabase = await createClient();
  let q = supabase.from('onboarding_plans').select('id, employee_id, template_id, status, started_at, completed_at').eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  if (filter.status) q = q.eq('status', filter.status);
  const { data: plans, error } = await q.order('started_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load onboarding (${error.code})`);
  if (plans.length === 0) return [];
  const { data: tasks, error: tError } = await supabase.from('tasks')
    .select('id, subject_id, assignee_employee_id, title, due_on, status')
    .eq('organization_id', orgId).eq('subject_type', 'onboarding_plan').in('subject_id', plans.map((p) => p.id)).order('due_on');
  if (tError) throw new Error(`Failed to load onboarding tasks (${tError.code})`);
  return plans.map((p) => {
    const mine = tasks.filter((t) => t.subject_id === p.id);
    return { ...p, tasks: mine, done: mine.filter((t) => t.status !== 'open').length };
  });
}

export async function getTemplates(orgId: string) {
  const supabase = await createClient();
  const [templates, tasks] = await Promise.all([
    supabase.from('onboarding_templates').select('id, name, owner_employee_id, is_default, is_active').eq('organization_id', orgId).order('name'),
    supabase.from('onboarding_template_tasks').select('id, template_id, position, title, assignee, due_offset_days').eq('organization_id', orgId).order('position'),
  ]);
  if (templates.error || tasks.error) throw new Error('Failed to load onboarding templates');
  return templates.data.map((t) => ({ ...t, tasks: tasks.data.filter((x) => x.template_id === t.id) }));
}

export async function getPolicies(orgId: string, myEmployeeId: string | null) {
  const supabase = await createClient();
  const [policies, acks] = await Promise.all([
    supabase.from('policy_documents').select('id, title, version, body, requires_acknowledgement, published_at')
      .eq('organization_id', orgId).is('retired_at', null).order('published_at', { ascending: false }),
    myEmployeeId
      ? supabase.from('policy_acknowledgements').select('policy_id, acknowledged_at').eq('employee_id', myEmployeeId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (policies.error || acks.error) throw new Error('Failed to load policies');
  const acked = new Map((acks.data ?? []).map((a) => [a.policy_id, a.acknowledged_at]));
  return policies.data.map((p) => ({ ...p, acknowledgedAt: acked.get(p.id) ?? null }));
}

export async function getAcknowledgementStatus(policyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('policy_acknowledgement_status', { p_policy: policyId });
  if (error) throw new Error(`Failed to load acknowledgements (${error.code})`);
  return data;
}
