/** Group health insurance helpers shared by the Insurance pages and the endorsement export (a plain module). */

/** Insurers to pick from, by current name. A policy saved under an older name keeps it. */
export const INSURERS = [
  'Acko General Insurance', 'Aditya Birla Health Insurance', 'Bajaj Allianz General Insurance', 'Care Health Insurance',
  'Cholamandalam MS General Insurance', 'Galaxy Health and Allied Insurance', 'Generali Central Insurance (formerly Future Generali)',
  'Go Digit General Insurance', 'HDFC ERGO General Insurance', 'ICICI Lombard General Insurance', 'IFFCO Tokio General Insurance',
  'Kotak Mahindra General Insurance', 'Liberty General Insurance', 'Magma General Insurance (formerly Magma HDI)', 'ManipalCigna Health Insurance',
  'Narayana Health Insurance', 'National Insurance', 'Navi General Insurance', 'Niva Bupa Health Insurance', 'Prudential HCL Health Insurance',
  'Raheja QBE General Insurance', 'Reliance General Insurance', 'Royal Sundaram General Insurance', 'SBI General Insurance',
  'Shriram General Insurance', 'Star Health and Allied Insurance', 'Tata AIG General Insurance', 'The New India Assurance',
  'The Oriental Insurance', 'United India Insurance', 'Universal Sompo General Insurance', 'Zuno General Insurance (formerly Edelweiss)',
];

/** Entries in the CD (cash deposit) account the insurer keeps: money in, endorsement charges out. */
export const CD_KINDS = { deposit: 'Deposit', endorsement: 'Endorsement charge', refund: 'Refund', adjustment: 'Adjustment' } as const;
export type CdKind = keyof typeof CD_KINDS;

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Why a member is in the endorsement, from the kind of change and the relationship (dates as YYYY-MM-DD). */
export function endorsementReason(r: { change: string; relationship: string; date_of_birth: string | null }, firstSync: boolean, today: string): string {
  if (r.change === 'deletion') return r.relationship === 'self' ? 'Exit or cover ended' : 'Dependant removed';
  if (firstSync) return 'Initial roster';
  if (r.relationship === 'self') return 'New joiner or newly covered';
  if (r.relationship === 'spouse') return 'Spouse added';
  if (r.relationship === 'child') return r.date_of_birth && days(r.date_of_birth, today) <= 90 ? 'Newborn' : 'Child added';
  return 'Parent added';
}

/**
 * A guide to an endorsement charge: the annual premium per life for the lives added, pro rata for the days left in
 * the policy period (insurers' short-period scales differ, so HR enters the amount on the insurer's debit note).
 * The full annual premium when the policy dates aren't set; null when there's nothing to estimate.
 */
export function endorsementEstimate(perLife: number | null, lives: number, validFrom: string | null, validTo: string | null, onDate: string): number | null {
  if (!perLife || lives <= 0) return null;
  if (!validFrom || !validTo) return Math.round(perLife * lives);
  const total = days(validFrom, validTo) + 1;
  const left = days(onDate < validFrom ? validFrom : onDate, validTo) + 1;
  if (total <= 0 || left <= 0) return null;
  return Math.round((perLife * lives * Math.min(left, total)) / total);
}

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Roster keys (employee or family member ids) from a comma-separated list or repeated form fields; junk is dropped. */
export function rosterKeys(values: string[]): string[] {
  return [...new Set(values.flatMap((v) => v.split(',')).map((k) => k.trim().toLowerCase()).filter((k) => KEY.test(k)))].slice(0, 10_000);
}
