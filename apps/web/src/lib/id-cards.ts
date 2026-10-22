/** ID Studio: the 15 card templates (layout presets) and the fields a card can show. */

export interface CardTemplate {
  key: string;
  name: string;
  header: 'band' | 'full' | 'side' | 'none' | 'wave';
  photo: 'circle' | 'square' | 'rounded';
  align: 'center' | 'left';
  tint: boolean;
}

export const TEMPLATES: CardTemplate[] = [
  { key: 'classic', name: 'Classic', header: 'band', photo: 'circle', align: 'center', tint: false },
  { key: 'bold', name: 'Bold', header: 'full', photo: 'circle', align: 'center', tint: false },
  { key: 'minimal', name: 'Minimal', header: 'none', photo: 'rounded', align: 'center', tint: false },
  { key: 'corporate', name: 'Corporate', header: 'band', photo: 'square', align: 'left', tint: false },
  { key: 'sidebar', name: 'Sidebar', header: 'side', photo: 'rounded', align: 'left', tint: false },
  { key: 'wave', name: 'Wave', header: 'wave', photo: 'circle', align: 'center', tint: false },
  { key: 'tinted', name: 'Tinted', header: 'band', photo: 'circle', align: 'center', tint: true },
  { key: 'modern', name: 'Modern', header: 'full', photo: 'rounded', align: 'left', tint: false },
  { key: 'stripe', name: 'Stripe', header: 'side', photo: 'circle', align: 'center', tint: true },
  { key: 'frame', name: 'Frame', header: 'none', photo: 'square', align: 'center', tint: true },
  { key: 'ribbon', name: 'Ribbon', header: 'wave', photo: 'rounded', align: 'left', tint: true },
  { key: 'studio', name: 'Studio', header: 'full', photo: 'square', align: 'center', tint: true },
  { key: 'clean', name: 'Clean', header: 'none', photo: 'circle', align: 'left', tint: false },
  { key: 'duo', name: 'Duo', header: 'band', photo: 'rounded', align: 'left', tint: true },
  { key: 'pastel', name: 'Pastel', header: 'wave', photo: 'square', align: 'center', tint: true },
];
export const templateFor = (key: string) => TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0]!;

export const CARD_FIELDS = [
  ['designation', 'Designation'], ['department', 'Department'], ['employee_code', 'Employee ID'], ['date_of_joining', 'Joined'],
  ['blood_group', 'Blood group'], ['phone', 'Phone'], ['work_email', 'Work email'], ['location', 'Location'], ['emergency_contact', 'Emergency contact'],
  ['office_address', 'Office address'], ['website', 'Website'],
] as const;
export type CardField = (typeof CARD_FIELDS)[number][0];

/** What each kind of card can show: ID cards carry identity details; visiting cards carry contact details. */
export const FIELDS_FOR: Record<CardType, readonly CardField[]> = {
  id: ['designation', 'department', 'employee_code', 'date_of_joining', 'blood_group', 'phone', 'work_email', 'location', 'emergency_contact', 'office_address'],
  visiting: ['designation', 'department', 'phone', 'work_email', 'office_address', 'website', 'location'],
};
export type CardType = 'id' | 'visiting';
export const CARD_TYPE_LABELS: Record<CardType, string> = { id: 'ID card', visiting: 'Visiting card' };
export interface CustomLine { label: string; value: string }

export interface CardDesign {
  id: string; name: string; template: string; orientation: string; fields: string[]; primary_color: string; accent_color: string; text_color: string;
  show_logo: boolean; show_photo: boolean; show_qr: boolean; qr_content: string; back_text: string | null; logo_path: string | null; is_default: boolean;
  card_type: string; custom_fields: CustomLine[]; rolled_out_at: string | null;
}

export interface CardPerson {
  id: string; name: string; code: string; designation: string | null; department: string | null; location: string | null; date_of_joining: string;
  blood_group: string | null; phone: string | null; work_email: string | null; emergency_contact: string | null; office_address: string | null;
}

/** A field's value for a person (the website is the company's). */
export function cardValue(k: string, p: CardPerson, website: string | null): string | null {
  switch (k) {
    case 'designation': return p.designation;
    case 'department': return p.department;
    case 'employee_code': return p.code;
    case 'date_of_joining': return p.date_of_joining;
    case 'blood_group': return p.blood_group;
    case 'phone': return p.phone;
    case 'work_email': return p.work_email;
    case 'location': return p.location;
    case 'emergency_contact': return p.emergency_contact;
    case 'office_address': return p.office_address;
    case 'website': return website;
    default: return null;
  }
}
