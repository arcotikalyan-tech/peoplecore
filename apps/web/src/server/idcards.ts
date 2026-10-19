import 'server-only';
import QRCode from 'qrcode';
import type { CardDesign, CardPerson } from '@/lib/id-cards';
import { signImageUrl } from './document-storage';
import { getStructure } from './structure';
import { createClient } from './supabase';

/** ID Studio data: designs, and the people on cards — read with the viewer's own rights (RLS). */

export async function cardDesigns(orgId: string): Promise<CardDesign[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('id_card_designs')
    .select('id, name, template, orientation, fields, primary_color, accent_color, text_color, show_logo, show_photo, show_qr, qr_content, back_text, logo_path, is_default')
    .eq('organization_id', orgId).order('is_default', { ascending: false }).order('created_at');
  if (error) throw new Error(`Failed to load card designs (${error.code})`);
  return data;
}

export async function cardPeople(orgId: string, filter: { ids?: string[]; departmentId?: string } = {}): Promise<CardPerson[]> {
  const supabase = await createClient();
  let q = supabase.from('employees').select('id, employee_code, first_name, last_name, work_email, work_phone, date_of_joining, department_id, designation_id, location_id, job_title')
    .eq('organization_id', orgId).in('status', ['active', 'on_notice', 'pre_joining']);
  if (filter.ids) q = q.in('id', filter.ids.length ? filter.ids : ['00000000-0000-0000-0000-000000000000']);
  if (filter.departmentId) q = q.eq('department_id', filter.departmentId);
  const { data: emps, error } = await q.order('employee_code').limit(1000);
  if (error) throw new Error(`Failed to load employees (${error.code})`);
  const ids = emps.map((e) => e.id);
  const [structure, personal, emergency] = await Promise.all([
    getStructure(orgId),
    ids.length ? supabase.from('employee_personal').select('employee_id, blood_group').in('employee_id', ids).then((r) => r.data ?? []) : Promise.resolve([]),
    ids.length ? supabase.from('emergency_contacts').select('employee_id, name, phone').in('employee_id', ids).order('created_at').then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const blood = new Map(personal.map((p) => [p.employee_id, p.blood_group]));
  const sos = new Map<string, string>();
  for (const c of emergency) if (!sos.has(c.employee_id)) sos.set(c.employee_id, `${c.name} · ${c.phone}`);
  return emps.map((e) => ({
    id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(' '), code: e.employee_code,
    designation: (e.designation_id ? desig.get(e.designation_id) : null) ?? e.job_title ?? null, department: e.department_id ? dept.get(e.department_id) ?? null : null,
    location: e.location_id ? loc.get(e.location_id) ?? null : null, date_of_joining: e.date_of_joining, blood_group: blood.get(e.id) ?? null,
    phone: e.work_phone, work_email: e.work_email, emergency_contact: sos.get(e.id) ?? null,
  }));
}

export async function cardCompany(orgId: string, orgName: string, design: CardDesign | null) {
  const supabase = await createClient();
  const { data } = await supabase.from('company_profiles').select('legal_name, brand_name, website').eq('organization_id', orgId).maybeSingle();
  return {
    name: data?.brand_name ?? data?.legal_name ?? orgName,
    website: data?.website ?? null,
    logoUrl: design?.show_logo && design.logo_path ? await signImageUrl(design.logo_path) : null,
  };
}

/** The QR on a card: a vCard (name, title, company, work contact) or just the employee ID. */
export async function cardQr(design: CardDesign, p: CardPerson, company: string): Promise<string | null> {
  if (!design.show_qr) return null;
  const text = design.qr_content === 'employee_code' ? p.code : [
    'BEGIN:VCARD', 'VERSION:3.0', `FN:${p.name}`, `ORG:${company}`, p.designation && `TITLE:${p.designation}`,
    p.work_email && `EMAIL;TYPE=WORK:${p.work_email}`, p.phone && `TEL;TYPE=WORK:${p.phone}`, `NOTE:${p.code}`, 'END:VCARD',
  ].filter(Boolean).join('\n');
  return QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}
