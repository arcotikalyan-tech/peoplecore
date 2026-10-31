import { supabase } from './supabase';

export interface MyProfile {
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  manager: string | null;
  joinedOn: string;
  employmentType: string;
  status: string;
  workEmail: string | null;
  workPhone: string | null;
}

export type Completeness = Record<'personal' | 'blood_group' | 'address' | 'emergency' | 'identity' | 'bank', boolean>;
export const PROFILE_PARTS: Array<{ key: keyof Completeness; label: string }> = [
  { key: 'personal', label: 'Personal details' }, { key: 'blood_group', label: 'Blood group' }, { key: 'address', label: 'Address' },
  { key: 'emergency', label: 'Emergency contact' }, { key: 'identity', label: 'PAN' }, { key: 'bank', label: 'Bank account' },
];

const name = (e: { first_name: string; last_name: string | null }) => [e.first_name, e.last_name].filter(Boolean).join(' ');

/**
 * The person's own employee record, with the names of their designation, department, office and manager (each read
 * as them: a manager they may not see is left out).
 */
export async function loadProfile(orgId: string, employeeId: string): Promise<MyProfile | null> {
  const { data: e, error } = await supabase.from('employees')
    .select('employee_code, first_name, last_name, designation_id, department_id, location_id, manager_employee_id, date_of_joining, employment_type, status, work_email, work_phone, job_title')
    .eq('organization_id', orgId).eq('id', employeeId).maybeSingle();
  if (error) throw error;
  if (!e) return null;
  const pick = async (table: 'designations' | 'departments' | 'locations', id: string | null, column: 'title' | 'name') => {
    if (!id) return null;
    const { data } = await supabase.from(table).select(column).eq('organization_id', orgId).eq('id', id).maybeSingle();
    return ((data as Record<string, string> | null)?.[column]) ?? null;
  };
  const [designation, department, location, manager] = await Promise.all([
    pick('designations', e.designation_id, 'title'),
    pick('departments', e.department_id, 'name'),
    pick('locations', e.location_id, 'name'),
    e.manager_employee_id
      ? supabase.from('employees').select('first_name, last_name').eq('organization_id', orgId).eq('id', e.manager_employee_id).maybeSingle().then((r) => (r.data ? name(r.data) : null))
      : null,
  ]);
  return {
    code: e.employee_code, name: name(e), designation: designation ?? e.job_title ?? null, department, location, manager,
    joinedOn: e.date_of_joining, employmentType: e.employment_type, status: e.status, workEmail: e.work_email, workPhone: e.work_phone,
  };
}

export async function loadCompleteness(orgId: string): Promise<Completeness | null> {
  const { data } = await supabase.rpc('my_profile_completeness', { p_org: orgId });
  return (data as Completeness | null) ?? null;
}
