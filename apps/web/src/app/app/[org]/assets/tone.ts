import type { AssetStatus } from '@/server/assets';

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  in_stock: 'In stock',
  assigned: 'Issued',
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
  { value: 'in_stock', label: 'In stock' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
];
