import 'server-only';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/** PeopleXP reads. RLS decides: posts by audience, wallets and pulse answers only for their owner (and admins for wallets). */

export interface PxpSettings {
  points_enabled: boolean; daily_recognition_limit: number; daily_points_limit: number; high_value_threshold: number;
  require_approval: boolean; notify_recipient: boolean; notify_manager: boolean;
}
export const PXP_DEFAULTS: PxpSettings = {
  points_enabled: true, daily_recognition_limit: 5, daily_points_limit: 500, high_value_threshold: 100, require_approval: true, notify_recipient: true, notify_manager: true,
};
export const MOODS = [
  { mood: 5, emoji: '😄', label: 'Great' }, { mood: 4, emoji: '🙂', label: 'Good' }, { mood: 3, emoji: '😐', label: 'Okay' },
  { mood: 2, emoji: '😟', label: 'Stressed' }, { mood: 1, emoji: '😫', label: 'Burnt out' },
] as const;

export async function pxpBasics(orgId: string) {
  const supabase = await createClient();
  const [settings, values, badges, rewards] = await Promise.all([
    supabase.from('pxp_settings').select('*').eq('organization_id', orgId).maybeSingle(),
    supabase.from('pxp_values').select('id, name, emoji, description, archived_at').eq('organization_id', orgId).order('name'),
    supabase.from('pxp_badges').select('id, name, emoji, points, value_id, active').eq('organization_id', orgId).order('points'),
    supabase.from('pxp_rewards').select('id, name, description, cost, stock, active').eq('organization_id', orgId).order('cost'),
  ]);
  return {
    settings: settings.data ? { ...PXP_DEFAULTS, ...(settings.data as unknown as Partial<PxpSettings>) } : PXP_DEFAULTS,
    values: values.data ?? [], badges: badges.data ?? [], rewards: rewards.data ?? [],
  };
}

export interface Recognition { id: string; post_id: string; from_employee_id: string; badge_id: string; points: number; message: string; status: string; created_at: string; recipients: string[] }

export async function recognitions(orgId: string, sinceIso: string): Promise<Recognition[]> {
  const supabase = await createClient();
  const { data } = await allRows((a, b) => supabase.from('pxp_recognitions').select('id, post_id, from_employee_id, badge_id, points, message, status, created_at')
    .eq('organization_id', orgId).gte('created_at', sinceIso).order('created_at', { ascending: false }).order('id').range(a, b));
  const ids = (data ?? []).map((r) => r.id);
  const recips: Array<{ recognition_id: string; employee_id: string }> = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data: rr } = await supabase.from('pxp_recognition_recipients').select('recognition_id, employee_id').in('recognition_id', ids.slice(i, i + 500));
    recips.push(...(rr ?? []));
  }
  return (data ?? []).map((r) => ({ ...r, recipients: recips.filter((x) => x.recognition_id === r.id).map((x) => x.employee_id) }));
}

export async function feed(orgId: string, limit = 40) {
  const supabase = await createClient();
  const { data: posts } = await supabase.from('pxp_posts').select('id, author_employee_id, kind, body, audience, visible, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(limit);
  const ids = (posts ?? []).map((p) => p.id);
  if (ids.length === 0) return [];
  const [reactions, comments] = await Promise.all([
    supabase.from('pxp_reactions').select('post_id, employee_id, emoji').in('post_id', ids),
    supabase.from('pxp_comments').select('id, post_id, employee_id, body, created_at').in('post_id', ids).order('created_at'),
  ]);
  return (posts ?? []).map((p) => ({
    ...p,
    reactions: (reactions.data ?? []).filter((r) => r.post_id === p.id),
    comments: (comments.data ?? []).filter((c) => c.post_id === p.id),
  }));
}

export async function myWallet(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const [ledger, redemptions] = await Promise.all([
    supabase.from('pxp_ledger').select('id, delta, kind, note, created_at').eq('organization_id', orgId).eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(200),
    supabase.from('pxp_redemptions').select('id, reward_id, points, status, note, created_at').eq('organization_id', orgId).eq('employee_id', employeeId).order('created_at', { ascending: false }),
  ]);
  const rows = ledger.data ?? [];
  return {
    ledger: rows, redemptions: redemptions.data ?? [],
    balance: rows.reduce((s, r) => s + r.delta, 0),
    earned: rows.filter((r) => r.kind === 'received' || (r.kind === 'adjustment' && r.delta > 0)).reduce((s, r) => s + r.delta, 0),
    redeemed: -rows.filter((r) => r.kind === 'redeemed').reduce((s, r) => s + r.delta, 0) - rows.filter((r) => r.kind === 'refund').reduce((s, r) => s + r.delta, 0),
  };
}

export async function allRedemptions(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('pxp_redemptions').select('id, employee_id, reward_id, points, status, note, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(500);
  return data ?? [];
}

export async function myPulseToday(orgId: string, employeeId: string, today: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('pxp_pulse').select('mood').eq('organization_id', orgId).eq('employee_id', employeeId).eq('day', today).maybeSingle();
  return data?.mood ?? null;
}

export async function pulseSummary(orgId: string, from: string, to: string, departmentId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pxp_pulse_summary', { p_org: orgId, p_from: from, p_to: to, p_department: departmentId });
  return error ? [] : data;
}

export async function nominations(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('pxp_nominations').select('id, nominee_employee_id, nominator_employee_id, value_id, month, reason, status, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(500);
  return data ?? [];
}

export async function okrs(orgId: string, quarter: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('pxp_okrs').select('id, title, value_id, quarter, owner_employee_id, target, current, unit').eq('organization_id', orgId).eq('quarter', quarter).order('created_at');
  return (data ?? []).map((o) => ({ ...o, target: Number(o.target), current: Number(o.current) }));
}
