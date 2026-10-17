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
