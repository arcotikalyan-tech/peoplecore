import 'server-only';
import { cache } from 'react';
import { createClient } from './supabase';

/** Approval rules (flows and their escalation) and delegations. RLS: members read flows; delegations are their parties'. */

export const SUBJECT_LABEL: Record<string, string> = {
  leave_request: 'Leave requests',
  regularization: 'Attendance corrections',
  offer: 'Job offers',
  expense_claim: 'Expense claims (manager, then finance)',
  expense_claim_manager: 'Expense claims (manager only)',
  expense_claim_finance: 'Expense claims (finance only)',
};

export async function approvalFlows(orgId: string) {
  const supabase = await createClient();
  const [flows, steps] = await Promise.all([
    supabase.from('approval_flows').select('id, subject_type').eq('organization_id', orgId).eq('is_active', true).order('subject_type'),
    supabase.from('approval_flow_steps').select('id, flow_id, step_no, approver_rule, permission_key, label, escalate_after_hours')
      .eq('organization_id', orgId).order('step_no'),
  ]);
  if (flows.error || steps.error) throw new Error('Failed to load approval rules');
  return flows.data.map((f) => ({ ...f, steps: steps.data.filter((s) => s.flow_id === f.id) }));
}

/** Delegations the caller gave or received that haven't ended. */
export async function myDelegations(orgId: string, userId: string, today: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('approval_delegations')
    .select('id, delegator_user_id, delegate_user_id, starts_on, ends_on, note')
    .eq('organization_id', orgId).is('revoked_at', null).gte('ends_on', today)
    .or(`delegator_user_id.eq.${userId},delegate_user_id.eq.${userId}`)
    .order('starts_on');
  if (error) throw new Error(`Failed to load delegations (${error.code})`);
  return data;
}

/** Active members with names, for choosing a delegate. */
export const memberDirectory = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('member_directory', { p_org: orgId });
  if (error) throw new Error(`Failed to load members (${error.code})`);
  return data;
});
