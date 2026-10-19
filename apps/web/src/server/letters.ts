import 'server-only';
import { legalName } from '@peoplecore/shared';
import { formatDate } from '@/lib/format';
import { signImageUrl } from './document-storage';
import { createClient } from './supabase';

/** Letters reads. RLS: HR (letter.manage) sees everything; employees see self-serve templates, their own released letters and requests. */

export async function letterSettings(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('letter_settings').select('*').eq('organization_id', orgId).maybeSingle();
  return data;
}

export async function letterTemplates(orgId: string, opts: { includeArchived?: boolean } = {}) {
  const supabase = await createClient();
  let q = supabase.from('letter_templates').select('id, letter_type, name, body, signatory_id, self_serve, archived_at, updated_at').eq('organization_id', orgId);
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q.order('letter_type').order('name');
  if (error) throw new Error(`Failed to load letter templates (${error.code})`);
  return data;
}

export async function signatories(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('letter_signatories').select('id, name, designation, address, signature_path').eq('organization_id', orgId).order('name');
  return data ?? [];
}

export async function lettersList(orgId: string, filter: { employeeId?: string; status?: string; ids?: string[] } = {}) {
  const supabase = await createClient();
  let q = supabase.from('letters').select('id, employee_id, template_id, letter_type, status, request_id, created_at, released_at').eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.ids) q = q.in('id', filter.ids);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(`Failed to load letters (${error.code})`);
  return data;
}

export async function letterRequests(orgId: string, filter: { employeeId?: string } = {}) {
  const supabase = await createClient();
  let q = supabase.from('letter_requests').select('id, employee_id, template_id, letter_type, reason, status, requested_by, created_at, decided_at, decision_note, letter_id')
    .eq('organization_id', orgId);
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(`Failed to load letter requests (${error.code})`);
  return data;
}

export async function letterById(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('letters').select('*').eq('id', id).maybeSingle();
  return data;
}

/** Employees HR can generate letters for (current and recently exited). */
export async function letterPeople(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('employees').select('id, employee_code, first_name, middle_name, last_name, status, department_id, designation_id')
    .eq('organization_id', orgId).in('status', ['active', 'on_notice', 'pre_joining', 'exited']).order('first_name').limit(5000);
  return (data ?? []).map((e) => ({ id: e.id, code: e.employee_code, name: legalName(e), status: e.status }));
}

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const months = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`); const b = new Date(`${to}T00:00:00Z`);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth());
};

/**
 * Merge values for one employee as the caller can see them (RLS): profile, placement, address (with personal
 * read), notice periods and, only for callers who may read compensation, salary. Anything missing is filled in at
 * generate time.
 */
export async function mergeValues(orgId: string, employeeId: string, today: string): Promise<Record<string, string>> {
  const supabase = await createClient();
  const [{ data: e }, { data: personal }, { data: company }, { data: notice }] = await Promise.all([
    supabase.from('employees').select('*').eq('organization_id', orgId).eq('id', employeeId).maybeSingle(),
    supabase.from('employee_personal').select('gender, address_line1, address_line2, city, state_code, postal_code').eq('employee_id', employeeId).maybeSingle(),
    supabase.from('company_profiles').select('legal_name, brand_name').eq('organization_id', orgId).maybeSingle(),
    supabase.from('notice_periods').select('employment_type, notice_days').eq('organization_id', orgId),
  ]);
  if (!e) return {};
  const [dept, desig, loc] = await Promise.all([
    e.department_id ? supabase.from('departments').select('name').eq('id', e.department_id).maybeSingle() : Promise.resolve({ data: null }),
    e.designation_id ? supabase.from('designations').select('title').eq('id', e.designation_id).maybeSingle() : Promise.resolve({ data: null }),
    e.location_id ? supabase.from('locations').select('name, city, state_code').eq('id', e.location_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const g = personal?.gender;
  const v: Record<string, string> = {
    'date': formatDate(today),
    'salutation': g === 'female' ? 'Ms' : g === 'male' ? 'Mr' : 'Mx',
    'full name': legalName(e),
    'first name': e.first_name,
    'employee id': e.employee_code,
    'gender template': g === 'female' ? 'her' : g === 'male' ? 'his' : 'their',
    'gender template 2': g === 'female' ? 'she' : g === 'male' ? 'he' : 'they',
    'gender template 3': g === 'female' ? 'her' : g === 'male' ? 'him' : 'them',
    'date of joining': formatDate(e.date_of_joining),
    'company name': company?.legal_name ?? company?.brand_name ?? '',
    'new joinee company name': company?.legal_name ?? company?.brand_name ?? '',
  };
  if (desig.data?.title) v.designation = desig.data.title;
  if (dept.data?.name) v.department = dept.data.name;
  if (loc.data) {
    const l = loc.data as { name: string; city: string | null; state_code: string | null };
    v.location = l.name; v['posting location'] = l.name;
    if (l.city) v['posting city'] = l.city;
    if (l.state_code) v['posting state'] = l.state_code;
  }
  if (personal) {
    const parts = [personal.address_line1, personal.address_line2, personal.city, personal.state_code, personal.postal_code].filter(Boolean) as string[];
    if (parts.length) { v.address = parts.join(', '); v['current address'] = parts.join(', '); }
    if (personal.address_line1) v['address line 1'] = personal.address_line1;
    if (personal.address_line2) v['address line 2'] = personal.address_line2;
    if (personal.city) v.city = personal.city;
    if (personal.state_code) v.state = personal.state_code;
    if (personal.postal_code) v.pincode = personal.postal_code;
  }
  if (e.confirmed_on) v['confirmation date'] = formatDate(e.confirmed_on);
  if (e.date_of_exit) v['termination date'] = formatDate(e.date_of_exit);
  if (e.probation_end_date) v['probation period in months'] = String(months(e.date_of_joining, e.probation_end_date));
  const days = (notice ?? []).find((n) => n.employment_type === e.employment_type)?.notice_days;
  if (days) { v['confirmation notice period'] = `${days} days`; v['probation notice period'] = `${days} days`; }

  // Salary: only visible to callers who may read compensation (RLS returns nothing otherwise).
  const { data: rec } = await supabase.from('compensation_records').select('id, annual_ctc').eq('employee_id', employeeId)
    .lte('effective_from', today).order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (rec) {
    const [{ data: lines }, { data: comps }] = await Promise.all([
      supabase.from('compensation_lines').select('component_id, monthly_amount').eq('record_id', rec.id),
      supabase.from('salary_components').select('id, code').eq('organization_id', orgId),
    ]);
    const code = new Map((comps ?? []).map((c) => [c.id, c.code]));
    const by = (c: string) => (lines ?? []).filter((l) => code.get(l.component_id) === c).reduce((a, l) => a + Number(l.monthly_amount), 0);
    const fixed = (lines ?? []).reduce((a, l) => a + Number(l.monthly_amount), 0);
    const basic = by('BASIC');
    const pf = Math.round(Math.min(basic, 15000) * 0.12);
    const put = (k: string, monthly: number) => { v[`monthly ${k}`] = inr(monthly); v[`annual ${k}`] = inr(monthly * 12); };
    v['annual ctc'] = inr(Number(rec.annual_ctc)); v['monthly ctc'] = inr(Math.round(Number(rec.annual_ctc) / 12));
    put('basic', basic); put('hra', by('HRA')); put('spa', by('SPECIAL')); put('fixed', fixed); put('pf', pf);
  }
  return v;
}

/** The organization's letterhead with short-lived image links (only for callers who may read the letter it frames). */
export async function letterhead(orgId: string, orgName: string) {
  const supabase = await createClient();
  const [settings, company, address] = await Promise.all([
    letterSettings(orgId),
    supabase.from('company_profiles').select('legal_name, brand_name').eq('organization_id', orgId).maybeSingle(),
    supabase.from('company_addresses').select('line1, line2, city, state, pincode').eq('organization_id', orgId).eq('kind', 'registered').maybeSingle(),
  ]);
  const a = address.data;
  return {
    headerStyle: settings?.header_style ?? 'classic',
    footerStyle: settings?.footer_style ?? 'band',
    headerUrl: settings?.header_path ? await signImageUrl(settings.header_path) : null,
    footerUrl: settings?.footer_path ? await signImageUrl(settings.footer_path) : null,
    company: company.data?.legal_name ?? company.data?.brand_name ?? orgName,
    address: a ? [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') : null,
  };
}
