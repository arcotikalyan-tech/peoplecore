'use server';

import { escapeLikePattern, legalName } from '@peoplecore/shared';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

export interface PersonHit {
  id: string;
  name: string;
  code: string;
  status: string;
}

const Query = z.string().trim().min(2).max(60);

/** The ⌘K search: people the signed-in person may read (RLS decides), by name, code or email. */
export async function searchPeopleAction(slug: string, raw: string): Promise<PersonHit[]> {
  const q = Query.safeParse(raw);
  if (!q.success) return [];
  const ctx = await getOrgContext(slug);
  if (!ctx.can('employee.read')) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('employees')
    .select('id, first_name, middle_name, last_name, employee_code, status')
    .eq('organization_id', ctx.org.id)
    .ilike('search_text', `%${escapeLikePattern(q.data.toLowerCase())}%`)
    .order('first_name').limit(8);
  if (error) return [];
  return data.map((e) => ({ id: e.id, name: legalName(e), code: e.employee_code, status: e.status }));
}
