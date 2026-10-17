import 'server-only';
import { createClient } from './supabase';

/**
 * Personal details come from RLS tables. Identity numbers and bank accounts come only from audited
 * database functions and are masked here; full values are fetched on explicit request (see actions).
 */

export async function getPersonalDetails(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const [personal, contacts] = await Promise.all([
    supabase.from('employee_personal').select('*').eq('organization_id', orgId).eq('employee_id', employeeId).maybeSingle(),
    supabase
      .from('emergency_contacts')
      .select('id, name, relationship, phone')
      .eq('organization_id', orgId)
      .eq('employee_id', employeeId)
      .order('created_at'),
  ]);
  if (personal.error || contacts.error) throw new Error('Failed to load personal details');
  return { personal: personal.data, contacts: contacts.data };
}

export async function getIdentitySummary(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('employee_identity_summary', { p_employee: employeeId });
  if (error) throw new Error(`Failed to load identity details (${error.code})`);
  return data[0]!;
}

export async function getBankSummary(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('employee_bank_summary', { p_employee: employeeId });
  if (error) throw new Error(`Failed to load bank details (${error.code})`);
  return data[0]!;
}

export type IdentitySummary = Awaited<ReturnType<typeof getIdentitySummary>>;
export type BankSummary = Awaited<ReturnType<typeof getBankSummary>>;
