import 'server-only';
import { createClient } from './supabase';

/** Org-structure master data (visible to all members via RLS; small tables, loaded whole). */
export async function getStructure(orgId: string) {
  const supabase = await createClient();
  const [departments, designations, locations, legalEntities] = await Promise.all([
    supabase.from('departments').select('id, code, name, parent_id').eq('organization_id', orgId).is('archived_at', null).order('name'),
    supabase.from('designations').select('id, title, level').eq('organization_id', orgId).is('archived_at', null).order('title'),
    supabase.from('locations').select('id, code, name, city, state_code').eq('organization_id', orgId).is('archived_at', null).order('name'),
    supabase.from('legal_entities').select('id, name').eq('organization_id', orgId).is('archived_at', null).order('name'),
  ]);
  for (const r of [departments, designations, locations, legalEntities]) {
    if (r.error) throw new Error(`Failed to load organization structure (${r.error.code})`);
  }
  return {
    departments: departments.data ?? [],
    designations: designations.data ?? [],
    locations: locations.data ?? [],
    legalEntities: legalEntities.data ?? [],
  };
}

export type Structure = Awaited<ReturnType<typeof getStructure>>;

export function structureOptions(s: Structure) {
  return {
    departments: s.departments.map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })),
    designations: s.designations.map((d) => ({ value: d.id, label: d.title })),
    locations: s.locations.map((l) => ({ value: l.id, label: l.city ? `${l.name}, ${l.city}` : l.name })),
    legalEntities: s.legalEntities.map((l) => ({ value: l.id, label: l.name })),
  };
}

/**
 * The structure page's view: active and archived items, with how many current employees use each.
 * Counts come from `structure_usage`, which runs under the caller's RLS, so they never exceed what the
 * viewer could see in the directory.
 */
export async function getStructureOverview(orgId: string) {
  const supabase = await createClient();
  const [departments, designations, locations, usage] = await Promise.all([
    supabase.from('departments').select('id, code, name, parent_id, archived_at').eq('organization_id', orgId).order('name'),
    supabase.from('designations').select('id, title, level, archived_at').eq('organization_id', orgId).order('title'),
    supabase.from('locations').select('id, code, name, city, state_code, archived_at').eq('organization_id', orgId).order('name'),
    supabase.rpc('structure_usage', { p_org: orgId }),
  ]);
  for (const r of [departments, designations, locations, usage]) {
    if (r.error) throw new Error(`Failed to load organization structure (${r.error.code})`);
  }
  const counts = new Map((usage.data ?? []).map((u) => [`${u.kind}:${u.item_id}`, Number(u.current_employees)]));
  const used = (kind: string, id: string) => counts.get(`${kind}:${id}`) ?? 0;
  return {
    departments: (departments.data ?? []).map((d) => ({ ...d, employees: used('department', d.id) })),
    designations: (designations.data ?? []).map((d) => ({ ...d, employees: used('designation', d.id) })),
    locations: (locations.data ?? []).map((l) => ({ ...l, employees: used('location', l.id) })),
  };
}

export type StructureOverview = Awaited<ReturnType<typeof getStructureOverview>>;
