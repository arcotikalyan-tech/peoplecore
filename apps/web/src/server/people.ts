import 'server-only';
import { legalName } from '@peoplecore/shared';
import { createClient } from './supabase';
import { allRows } from './all-rows';

/**
 * Data for the People workspace (Kredily's directory: overview, people, org chart, lifecycle, insights, settings).
 * HR and managers read employees through RLS (org or team); everyone else gets the colleague directory, which only
 * carries the fields the organization chose to show.
 */

export interface Person {
  id: string; code: string | null; name: string; status: 'pre_joining' | 'active' | 'on_notice' | 'exited';
  department: string | null; departmentId: string | null; designation: string | null; designationId: string | null;
  location: string | null; locationId: string | null; email: string | null; phone: string | null;
  joined: string | null; exited: string | null; probationEnd: string | null; confirmedOn: string | null;
  managerId: string | null; userId: string | null; employmentType: string | null; tenureYears: number;
  /** From the colleague directory, when the organization shows them: day and month only. */
  birthday?: string | null; maritalStatus?: string | null; social?: Array<[string, string]>;
}

const years = (from: string | null, today: string) => from ? Math.max(0, (Date.parse(today) - Date.parse(from)) / (365.25 * 864e5)) : 0;

/** Everyone the signed-in user may see as full employee records (RLS: org, team or self). */
export async function peopleRecords(orgId: string, today: string): Promise<Person[]> {
  const supabase = await createClient();
  const [emps, depts, desigs, locs] = await Promise.all([
    allRows((a, b) => supabase.from('employees').select('id, employee_code, first_name, middle_name, last_name, status, department_id, designation_id, location_id, work_email, work_phone, date_of_joining, date_of_exit, probation_end_date, confirmed_on, manager_employee_id, user_id, employment_type')
      .eq('organization_id', orgId).order('first_name').order('last_name').order('id').range(a, b)),
    supabase.from('departments').select('id, name').eq('organization_id', orgId),
    supabase.from('designations').select('id, title').eq('organization_id', orgId),
    supabase.from('locations').select('id, name').eq('organization_id', orgId),
  ]);
  if (emps.error) throw new Error(`Failed to load people (${emps.error.code})`);
  const d = new Map((depts.data ?? []).map((x) => [x.id, x.name]));
  const g = new Map((desigs.data ?? []).map((x) => [x.id, x.title]));
  const l = new Map((locs.data ?? []).map((x) => [x.id, x.name]));
  return (emps.data ?? []).map((e) => ({
    id: e.id, code: e.employee_code, name: legalName(e), status: e.status,
    department: e.department_id ? d.get(e.department_id) ?? null : null, departmentId: e.department_id,
    designation: e.designation_id ? g.get(e.designation_id) ?? null : null, designationId: e.designation_id,
    location: e.location_id ? l.get(e.location_id) ?? null : null, locationId: e.location_id,
    email: e.work_email, phone: e.work_phone, joined: e.date_of_joining, exited: e.date_of_exit, probationEnd: e.probation_end_date,
    confirmedOn: e.confirmed_on, managerId: e.manager_employee_id, userId: e.user_id, employmentType: e.employment_type,
    tenureYears: years(e.date_of_joining, today),
  }));
}

/** The colleague directory for any member (only the fields the organization shows). */
export async function directory(orgId: string, q?: string): Promise<Person[]> {
  const supabase = await createClient();
  const { data, error } = await allRows((a, b) => supabase.rpc('people_directory', { p_org: orgId, p_query: q || undefined, p_limit: 100_000 }).range(a, b));
  if (error) throw new Error(`Failed to load the directory (${error.code})`);
  return (data ?? []).map((r) => ({
    id: r.id, code: null, name: r.name, status: 'active', department: r.department, departmentId: null, designation: r.designation, designationId: null,
    location: r.location, locationId: null, email: r.work_email, phone: r.work_phone, joined: null, exited: null, probationEnd: null, confirmedOn: null,
    managerId: r.manager_id, userId: null, employmentType: null, tenureYears: Number(r.tenure_years),
    birthday: r.birthday, maritalStatus: r.marital_status,
    social: ([['LinkedIn', r.linkedin_url], ['X', r.twitter_url], ['Website', r.website_url]] as Array<[string, string | null]>).filter((x): x is [string, string] => Boolean(x[1])),
  }));
}

export async function directorySettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('directory_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return data ?? { access: 'everyone', show_department: true, show_designation: true, show_email: false, show_phone: false, show_location: true, show_birthday: false, show_marital_status: false, show_social: false };
}

/** Sign-in status of linked accounts (member.manage holders see members; others get nulls). */
export async function signInStats(orgId: string, people: Person[] | Promise<Person[]>) {
  const supabase = await createClient();
  // Read the members while the people list is still loading: neither needs the other until the counting.
  const [{ data }, list] = await Promise.all([supabase.from('organization_members').select('user_id, status').eq('organization_id', orgId), people]);
  if (!data) return null;
  people = list;
  const status = new Map(data.map((m) => [m.user_id, m.status]));
  const current = people.filter((p) => p.status === 'active' || p.status === 'on_notice');
  const signedIn = current.filter((p) => p.userId && status.get(p.userId) === 'active').length;
  return { signedIn, notSignedIn: current.length - signedIn, invited: current.filter((p) => p.userId && status.get(p.userId) === 'invited').length, total: current.length };
}

/** Gender mix for HR (employee_personal is HR-only through RLS); null when not readable. */
export async function genderMix(orgId: string, ids: string[]) {
  if (ids.length === 0) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('employee_personal').select('employee_id, gender').eq('organization_id', orgId).in('employee_id', ids.slice(0, 1000));
  if (error || !data || data.length === 0) return null;
  const counts = { female: 0, male: 0, transgender: 0, non_binary: 0, undisclosed: 0, unknown: ids.length - data.length };
  for (const r of data) counts[(r.gender ?? 'undisclosed') as keyof typeof counts] += 1;
  return counts;
}

/** Which identity and bank details are on file (yes/no only; employee.identity.read). Null when not readable. */
export async function profileGaps(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('people_profile_gaps', { p_org: orgId });
  if (error) return null;
  return new Map((data ?? []).map((r) => [r.employee_id, { pan: r.has_pan, uan: r.has_uan, aadhaar: r.has_aadhaar, bank: r.has_bank }]));
}

export async function upcomingBirthdays(orgId: string, days = 7) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('upcoming_birthdays', { p_org: orgId, p_days: days });
  return data ?? [];
}
