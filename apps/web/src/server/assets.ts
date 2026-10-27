import 'server-only';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/**
 * Assets and system access. RLS: asset managers see the inventory and every register; a system's owner sees its
 * access register; employees see what they hold or have held.
 */

export const ASSET_STATUSES = ['in_stock', 'assigned', 'in_repair', 'retired', 'lost'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export async function listAssets(orgId: string, filter: { status?: AssetStatus; q?: string } = {}) {
  const supabase = await createClient();
  let q = supabase.from('assets')
    .select('id, tag, name, category, category_id, serial_number, status, condition, location_id, purchased_on, purchase_cost, warranty_until, created_at')
    .eq('organization_id', orgId);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.q) {
    const term = filter.q.replace(/[%,()*"\\]/g, ' ').trim();
    if (term) q = q.or(`tag.ilike.%${term}%,name.ilike.%${term}%,serial_number.ilike.%${term}%,category.ilike.%${term}%`);
  }
  const [assets, open] = await Promise.all([
    allRows((a, b) => q.order('tag').order('id').range(a, b)),
    allRows((a, b) => supabase.from('asset_assignments').select('id, asset_id, employee_id, due_back_on, acknowledged_at')
      .eq('organization_id', orgId).is('returned_at', null).order('id').range(a, b)),
  ]);
  if (!assets.data || !open.data) throw new Error('Failed to load assets');
  const holder = new Map(open.data.map((a) => [a.asset_id, a]));
  return assets.data.map((a) => ({
    ...a, category_id: a.category_id ?? '', purchase_cost: a.purchase_cost === null ? null : Number(a.purchase_cost), issue: holder.get(a.id) ?? null,
  }));
}
export type AssetRow = Awaited<ReturnType<typeof listAssets>>[number];

/** How many assets are in each status, for the summary tiles. */
export async function assetCounts(orgId: string): Promise<Record<AssetStatus, number>> {
  const supabase = await createClient();
  const { data, error } = await allRows((a, b) => supabase.from('assets').select('status').eq('organization_id', orgId).order('id').range(a, b));
  if (error || !data) throw new Error(`Failed to count assets (${error?.code})`);
  const counts = Object.fromEntries(ASSET_STATUSES.map((s) => [s, 0])) as Record<AssetStatus, number>;
  for (const r of data) counts[r.status] += 1;
  return counts;
}

export async function getAsset(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('assets').select('*').eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load the asset (${error.code})`);
  return data;
}

/** Every issue of an asset, newest first; the open one (if any) is first. */
export async function assetHistory(orgId: string, assetId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('asset_assignments')
    .select('id, employee_id, assigned_at, due_back_on, condition_out, acknowledged_at, returned_at, condition_in, recovery_amount, recovery_note, recovery_status, recovery_settled_at')
    .eq('organization_id', orgId).eq('asset_id', assetId).order('assigned_at', { ascending: false });
  if (error) throw new Error(`Failed to load the asset’s history (${error.code})`);
  return data;
}

/** The assets an employee holds or has held. */
export async function employeeAssets(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const issues = await supabase.from('asset_assignments')
    .select('id, asset_id, assigned_at, due_back_on, condition_out, acknowledged_at, returned_at, recovery_amount, recovery_note, recovery_status')
    .eq('organization_id', orgId).eq('employee_id', employeeId).order('assigned_at', { ascending: false }).limit(100);
  if (issues.error) throw new Error(`Failed to load your assets (${issues.error.code})`);
  if (issues.data.length === 0) return [];
  const assets = await supabase.from('assets').select('id, tag, name, category, serial_number')
    .eq('organization_id', orgId).in('id', [...new Set(issues.data.map((i) => i.asset_id))]);
  if (assets.error) throw new Error(`Failed to load your assets (${assets.error.code})`);
  const byId = new Map(assets.data.map((a) => [a.id, a]));
  return issues.data.flatMap((i) => {
    const asset = byId.get(i.asset_id);
    return asset ? [{ ...i, asset }] : [];
  });
}

export async function listSystems(orgId: string, includeInactive = false) {
  const supabase = await createClient();
  let q = supabase.from('access_systems').select('id, name, owner_employee_id, is_active').eq('organization_id', orgId);
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q.order('name');
  if (error) throw new Error(`Failed to load systems (${error.code})`);
  return data;
}

/** Access records the caller may see: all (asset.manage), a system owner's own systems, or their own. */
export async function listAccess(orgId: string, filter: { employeeId?: string; systemId?: string; active?: boolean } = {}) {
  const supabase = await createClient();
  let q = supabase.from('access_grants')
    .select('id, employee_id, system_id, account, access_level, granted_at, revoked_at, revoke_note').eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  if (filter.systemId) q = q.eq('system_id', filter.systemId);
  if (filter.active) q = q.is('revoked_at', null);
  const { data, error } = await q.order('granted_at', { ascending: false }).limit(500);
  if (error) throw new Error(`Failed to load access (${error.code})`);
  return data;
}

/** What an employee still holds (open asset issues and active access): the offboarding clearance list. */
export async function employeeHoldings(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('employee_holdings', { p_employee: employeeId });
  if (error) throw new Error(`Failed to load holdings (${error.code})`);
  return data;
}

export async function assetCategories(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('asset_categories')
    .select('id, name, icon, description, useful_life_months, requestable').eq('organization_id', orgId).order('name');
  if (error) throw new Error(`Failed to load asset categories (${error.code})`);
  return data;
}
export type AssetCategory = Awaited<ReturnType<typeof assetCategories>>[number];

/** Asset requests: all (asset managers) or the caller's own (RLS), newest first. */
export async function assetRequests(orgId: string, employeeId?: string) {
  const supabase = await createClient();
  let q = supabase.from('asset_requests')
    .select('id, employee_id, category_id, reason, status, asset_id, decided_at, decision_note, created_at').eq('organization_id', orgId);
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(`Failed to load asset requests (${error.code})`);
  return data;
}

export async function assetRepairs(orgId: string, assetId?: string) {
  const supabase = await createClient();
  let q = supabase.from('asset_repairs')
    .select('id, asset_id, vendor, issue, sent_on, expected_back_on, completed_on, cost, outcome, created_at').eq('organization_id', orgId);
  if (assetId) q = q.eq('asset_id', assetId);
  const { data, error } = await q.order('sent_on', { ascending: false }).limit(1000);
  if (error) throw new Error(`Failed to load repairs (${error.code})`);
  return data.map((r) => ({ ...r, cost: r.cost === null ? null : Number(r.cost) }));
}

/** Issues with dues recorded on them (pending first), and recent issue history for the activity feed. */
export async function assetIssues(orgId: string, opts: { dues?: boolean; limit?: number } = {}) {
  const supabase = await createClient();
  let q = supabase.from('asset_assignments')
    .select('id, asset_id, employee_id, assigned_at, returned_at, acknowledged_at, recovery_amount, recovery_note, recovery_status, recovery_settled_at')
    .eq('organization_id', orgId);
  if (opts.dues) q = q.not('recovery_status', 'is', null);
  const { data, error } = await q.order('assigned_at', { ascending: false }).limit(opts.limit ?? 500);
  if (error) throw new Error(`Failed to load asset issues (${error.code})`);
  return data.map((x) => ({ ...x, recovery_amount: x.recovery_amount === null ? null : Number(x.recovery_amount) }));
}
