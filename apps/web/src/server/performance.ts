import 'server-only';
import { createClient } from './supabase';

/** Performance reads. Review contents come through review_view, which hides what the viewer may not see yet. */

export async function getGoals(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('goals').select('id, title, description, weight, progress, status, cycle_id, parent_goal_id')
    .eq('organization_id', orgId).eq('employee_id', employeeId).neq('status', 'dropped').order('created_at');
  if (error) throw new Error(`Failed to load goals (${error.code})`);
  return data;
}

export async function getMyReviews(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_reviews', { p_org: orgId });
  if (error) throw new Error(`Failed to load your reviews (${error.code})`);
  return data;
}

export async function reviewView(reviewId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('review_view', { p_review: reviewId }).maybeSingle();
  if (error) throw new Error(`Failed to load the review (${error.code})`);
  return data;
}

export async function myFeedback(reviewId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_feedback', { p_review: reviewId });
  return data ?? [];
}

/** Reviews of other people the caller can see (their line; everyone for HR). */
export async function getTeamReviews(orgId: string, myEmployeeId: string | null) {
  const supabase = await createClient();
  let q = supabase.from('reviews').select('id, cycle_id, employee_id, status, manager_employee_id, self_rating, manager_rating, final_rating').eq('organization_id', orgId);
  if (myEmployeeId) q = q.neq('employee_id', myEmployeeId);
  const { data, error } = await q.limit(500);
  if (error) throw new Error(`Failed to load reviews (${error.code})`);
  return data;
}

export async function getCycles(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('review_cycles').select('*').eq('organization_id', orgId).order('period_end', { ascending: false });
  if (error) throw new Error(`Failed to load review cycles (${error.code})`);
  return data;
}

export async function getPendingFeedback(orgId: string, myEmployeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('feedback_requests').select('id, review_id, question, created_at')
    .eq('organization_id', orgId).eq('from_employee_id', myEmployeeId).is('responded_at', null);
  if (error) throw new Error(`Failed to load feedback requests (${error.code})`);
  return data;
}
