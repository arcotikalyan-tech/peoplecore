import 'server-only';
import { createClient } from './supabase';

/** Expense reads (RLS: own claims, claims you approve, or all with expense.manage). */

export async function getCategories(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('expense_categories').select('id, code, name, requires_receipt, max_per_item, is_active, subcategories, description')
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
    supabase.from('expense_items').select('id, category_id, subcategory, expense_date, merchant, description, amount, receipt_path, receipt_name, duplicate_note')
      .eq('organization_id', orgId).eq('claim_id', claimId).order('expense_date'),
  ]);
  if (claim.error || items.error) throw new Error('Failed to load the claim');
  return claim.data ? { ...claim.data, items: items.data } : null;
}

export async function allCategories(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('expense_categories').select('id, code, name, requires_receipt, max_per_item, is_active, subcategories, description')
    .eq('organization_id', orgId).order('is_active', { ascending: false }).order('name');
  if (error) throw new Error(`Failed to load expense categories (${error.code})`);
  return data;
}

export async function expenseSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('expense_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return data ?? { organization_id: orgId, receipt_reading: true, multi_level: true, threshold: null, auto_finalize: false, finance_only: false, allow_skip: false, escalation_days: 3, mileage_enabled: true, mileage_rate: 12, updated_at: '' };
}

/**
 * Claims with what the lists show: first category, merchant, whether every item has a receipt, item count.
 * RLS: the caller's own claims, claims they approve, or all with expense.manage. Drafts of others never appear.
 */
export async function claimRows(orgId: string, filter: { employeeId?: string; excludeDrafts?: boolean } = {}) {
  const supabase = await createClient();
  const claims: Array<{ id: string; employee_id: string; title: string; status: string; total: number; submitted_at: string | null; decided_at: string | null;
    paid_at: string | null; payout_mode: string | null; payout_reference: string | null; held_at: string | null; recorded_by_finance: boolean; created_at: string; paid_run_id: string | null }> = [];
  for (let from = 0; from < 20000; from += 1000) {
    let q = supabase.from('expense_claims').select('id, employee_id, title, status, total, submitted_at, decided_at, paid_at, payout_mode, payout_reference, held_at, recorded_by_finance, created_at, paid_run_id')
      .eq('organization_id', orgId);
    if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
    if (filter.excludeDrafts) q = q.neq('status', 'draft');
    const { data, error } = await q.order('created_at', { ascending: false }).range(from, from + 999);
    if (error) throw new Error(`Failed to load expense claims (${error.code})`);
    claims.push(...data.map((c) => ({ ...c, total: Number(c.total) })));
    if (data.length < 1000) break;
  }
  const items: Array<{ claim_id: string; category_id: string; merchant: string | null; receipt_path: string | null; expense_date: string }> = [];
  const ids = claims.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('expense_items').select('claim_id, category_id, merchant, receipt_path, expense_date').in('claim_id', ids.slice(i, i + 200));
    items.push(...(data ?? []));
  }
  const by = new Map<string, typeof items>();
  for (const it of items) by.set(it.claim_id, [...(by.get(it.claim_id) ?? []), it]);
  return claims.map((c) => {
    const its = by.get(c.id) ?? [];
    return {
      ...c,
      categoryIds: [...new Set(its.map((i) => i.category_id))],
      merchant: its.find((i) => i.merchant)?.merchant ?? null,
      items: its.length,
      receipts: its.filter((i) => i.receipt_path).length,
      expenseDate: its.map((i) => i.expense_date).sort()[0] ?? null,
    };
  });
}
export type ClaimRow = Awaited<ReturnType<typeof claimRows>>[number];
