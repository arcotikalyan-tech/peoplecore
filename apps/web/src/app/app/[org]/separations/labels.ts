import type { Database } from '@peoplecore/db/types';

export type SeparationType = Database['public']['Enums']['separation_type'];
export type SeparationStatus = Database['public']['Enums']['separation_status'];

export const TYPE_LABEL: Record<SeparationType, string> = {
  resignation: 'Resignation',
  termination: 'Termination',
  retirement: 'Retirement',
  contract_end: 'End of contract',
  other: 'Other',
};

export const STATUS_LABEL: Record<SeparationStatus, string> = {
  submitted: 'Awaiting approval',
  approved: 'On notice',
  completed: 'Left',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<SeparationStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  submitted: 'warning',
  approved: 'primary',
  completed: 'neutral',
  rejected: 'neutral',
  withdrawn: 'neutral',
  cancelled: 'neutral',
};

export const REASONS: Array<{ value: string; label: string }> = [
  { value: 'better_opportunity', label: 'A better opportunity' },
  { value: 'compensation', label: 'Pay and benefits' },
  { value: 'growth', label: 'Career growth' },
  { value: 'manager', label: 'Manager or team' },
  { value: 'relocation', label: 'Relocation' },
  { value: 'personal', label: 'Personal reasons' },
  { value: 'health', label: 'Health' },
  { value: 'studies', label: 'Further studies' },
  { value: 'performance', label: 'Performance' },
  { value: 'conduct', label: 'Conduct' },
  { value: 'restructuring', label: 'Restructuring' },
  { value: 'other', label: 'Other' },
];

export const OWNER_LABEL: Record<string, string> = { manager: 'Manager', hr: 'HR', it: 'IT', finance: 'Finance' };
