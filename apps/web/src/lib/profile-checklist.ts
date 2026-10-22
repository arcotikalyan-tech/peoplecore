/** What makes an employee profile complete, and where each part is filled in (my_profile_completeness, migration 20261022001000). */
export interface Completeness { employee_id: string; personal: boolean; blood_group: boolean; address: boolean; emergency: boolean; identity: boolean; bank: boolean }
export type ProfileItem = Exclude<keyof Completeness, 'employee_id'>;

export const PROFILE_ITEMS: ReadonlyArray<readonly [ProfileItem, string, string, string]> = [
  ['personal', 'Personal details', 'Date of birth, gender and phone', 'personal'],
  ['blood_group', 'Blood group', 'For emergencies and your ID card', 'personal'],
  ['address', 'Address', 'Where you live', 'personal'],
  ['emergency', 'Emergency contact', 'Someone to call if you need help', 'family'],
  ['identity', 'PAN', 'Needed for salary and tax (TDS)', 'documents'],
  ['bank', 'Bank account', 'Where your salary is paid', 'payroll'],
];

export function profileProgress(c: Completeness) {
  const done = PROFILE_ITEMS.filter(([k]) => c[k]).length;
  return { done, total: PROFILE_ITEMS.length, percent: Math.round((done * 100) / PROFILE_ITEMS.length), complete: done === PROFILE_ITEMS.length };
}
