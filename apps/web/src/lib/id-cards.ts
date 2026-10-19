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
] as const;
export type CardField = (typeof CARD_FIELDS)[number][0];

export interface CardDesign {
  id: string; name: string; template: string; orientation: string; fields: string[]; primary_color: string; accent_color: string; text_color: string;
  show_logo: boolean; show_photo: boolean; show_qr: boolean; qr_content: string; back_text: string | null; logo_path: string | null; is_default: boolean;
}

export interface CardPerson {
  id: string; name: string; code: string; designation: string | null; department: string | null; location: string | null; date_of_joining: string;
  blood_group: string | null; phone: string | null; work_email: string | null; emergency_contact: string | null;
}
