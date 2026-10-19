import type { AssetStatus } from '@/server/assets';

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  in_stock: 'Available',
  assigned: 'Assigned',
  in_repair: 'In repair',
  retired: 'Retired',
  lost: 'Lost',
};

export const ASSET_TONE: Record<AssetStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  in_stock: 'success',
  assigned: 'primary',
  in_repair: 'warning',
  retired: 'neutral',
  lost: 'danger',
};

/** Where a returned asset goes, and the statuses an unissued asset can be moved between. */
export const RETURN_OPTIONS = [
  { value: 'in_stock', label: 'Back in stock' },
  { value: 'in_repair', label: 'Send for repair' },
  { value: 'retired', label: 'Retire' },
  { value: 'lost', label: 'Record as lost' },
];
export const IDLE_OPTIONS = [
  { value: 'in_stock', label: 'Available' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
];

export const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
];
export const CONDITION_LABEL: Record<string, string> = Object.fromEntries(CONDITIONS.map((c) => [c.value, c.label]));

export const REQUEST_LABEL: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', fulfilled: 'Fulfilled', rejected: 'Rejected', cancelled: 'Cancelled',
};
export const REQUEST_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning', approved: 'primary', fulfilled: 'success', rejected: 'danger', cancelled: 'neutral',
};
export const DUES_LABEL: Record<string, string> = { pending: 'Pending', recovered: 'Recovered', waived: 'Waived', payroll: 'Payroll deduction' };

/** Straight-line book value: cost spread over the category's useful life from the purchase date (never below zero). */
export function bookValue(cost: number | null, purchasedOn: string | null, lifeMonths: number | null | undefined, today: string): number {
  if (cost === null) return 0;
  if (!purchasedOn || !lifeMonths) return cost;
  const [y1, m1, d1] = purchasedOn.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number];
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  return Math.max(0, Math.round(cost * (1 - months / lifeMonths) * 100) / 100);
}
