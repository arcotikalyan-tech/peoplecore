import 'server-only';
import { createClient } from './supabase';

/** Expense reads (RLS: own claims, claims you approve, or all with expense.manage). */

export async function getCategories(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('expense_categories').select('id, code, name, requires_receipt, max_per_item, is_active')
    .eq('organization_id', orgId).eq('is_active', true).order('name');
  if (error) throw new Error(`Failed to load expense categories (${error.code})`);
  return data;
}

export async function listClaims(orgId: string, filter: { employeeId?: string } = {}) {
  const supabase = await createClient();
  let q = supabase.from('expense_claims').select('id, employee_id, title, status, total, submitted_at, decided_at, created_at').eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load expense claims (${error.code})`);
  return data;
}

export async function getClaim(orgId: string, claimId: string) {
  const supabase = await createClient();
  const [claim, items] = await Promise.all([
    supabase.from('expense_claims').select('*').eq('organization_id', orgId).eq('id', claimId).maybeSingle(),
    supabase.from('expense_items').select('id, category_id, expense_date, merchant, description, amount, receipt_path, receipt_name, duplicate_note')
      .eq('organization_id', orgId).eq('claim_id', claimId).order('expense_date'),
  ]);
  if (claim.error || items.error) throw new Error('Failed to load the claim');
  return claim.data ? { ...claim.data, items: items.data } : null;
}
